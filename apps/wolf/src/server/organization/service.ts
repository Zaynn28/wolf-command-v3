import { and, asc, eq, inArray } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { authorize } from "@wolf/shared";
import { filterCompaniesByOperatingGrant, organizationTaskGrant, readOperatingGrantEffect } from "../access/operating-grants";
import { evaluateModuleAccess } from "../access/matrix";
import { fingerprintEmail } from "../auth/crypto";
import { writeAudit } from "../auth/audit";
import { loadTrustedActor } from "../access/actor";
import { readSession } from "../auth/session";
import { visibleOperatorCompanyId } from "../companies/operator-list";
import { companies, departments, orgPeople, orgTaskEvents, orgTasks } from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { isHrCompany, offlineHrDirectory, type HrDirectorySource, type HrEmployeeLink, readSyncedHrLinks, resolveHrDirectories, syncHrLinks } from "./hr-directory";
import { createHttpHrStaffTaskClient, pushOrganizationTask, reconcileCompanyStaffTasks, staffTaskSyncAllowed } from "./hr-task-sync";
import { reasonRequired, taskActions, transitionTask, type TaskAction, type TaskStatus } from "./transitions";

const personFields = ["id", "displayName", "employeeCode", "employmentStatus", "isDemo", "companies"] as const;

export type OrgCompany = { id: string; name: string };

export type OrgPlacement = {
  companyId: string;
  companyName: string;
  departmentId: string;
  departmentName: string;
  positionId: string;
  positionTitle: string;
  managerPersonId: string | null;
  managerName: string | null;
};

export type OrgPerson = {
  id: string;
  displayName: string;
  employeeCode: string | null;
  employmentStatus: string;
  isDemo: boolean;
  companies: OrgPlacement[];
};

export type OrgTree = {
  companies: Array<{
    id: string;
    name: string;
    directory: "ready" | "unavailable";
    departments: Array<{
      id: string;
      name: string;
      isDemo: boolean;
      positions: Array<{ id: string; title: string; vacant: boolean; person: OrgPerson | null }>;
    }>;
  }>;
  vacant: Array<{ id: string; title: string; companyId: string; departmentName: string }>;
};

export type TaskEventView = {
  id: string;
  actorUserId: string | null;
  actorSource: string;
  previousStatus: string | null;
  nextStatus: string;
  reason: string | null;
  createdAt: string;
};

export type TaskView = {
  id: string;
  companyId: string;
  departmentId: string | null;
  title: string;
  description: string;
  priority: string;
  dueOn: string;
  completionCriteria: string;
  reviewRequired: boolean;
  status: TaskStatus;
  assigneePersonId: string | null;
  assigneeName: string | null;
  teamDepartmentId: string | null;
  evidenceUrl: string | null;
  isDemo: true;
  completedAt: string | null;
  allowedActions: TaskAction[];
  events: TaskEventView[];
};

export type TaskOverview = {
  active: number;
  overdue: number;
  blocked: number;
  inReview: number;
  completedInPeriod: number;
  byCompany: Array<{ companyId: string; active: number; blocked: number; inReview: number; completed: number }>;
  byDepartment: Array<{ companyId: string; departmentId: string; active: number; blocked: number; inReview: number; completed: number }>;
  tasks: TaskView[];
  scope: "owner" | "company" | "assigned";
};

export const staffTaskStatuses = ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "COMPLETED"] as const;

export type StaffTaskCounts = Record<(typeof staffTaskStatuses)[number], number> & { overdue: number };

export type StaffProgressTask = {
  id: string;
  title: string;
  status: TaskStatus;
  companyId: string;
  companyName: string;
  dueOn: string;
  overdue: boolean;
  teamDepartmentId: string | null;
  teamDepartmentName: string | null;
};

export type StaffProgressPerson = {
  id: string;
  displayName: string;
  employeeCode: string | null;
  employmentStatus: string;
  isDemo: boolean;
  companies: OrgPlacement[];
  counts: StaffTaskCounts;
  tasks: StaffProgressTask[];
};

export type StaffProgress = {
  scope: "owner" | "company";
  ownerView: boolean;
  companies: OrgCompany[];
  unavailableCompanyIds: string[];
  people: StaffProgressPerson[];
  unassigned: {
    title: "Unassigned team tasks";
    counts: StaffTaskCounts;
    tasks: StaffProgressTask[];
  };
};

export type OrgResult<T> = { status: number; body: T | { error: string } };

type Gate =
  | { status: 401 | 403; error: string }
  | { status: 200; actor: Actor; email: string };

export async function openOrganizationActor(db: AuthDatabase, token: string | null, now: Date): Promise<Gate> {
  const session = await readSession(db, token, now);
  if (!session) return { status: 401, error: "Sign in is required." };
  if (session.mustChangePassword) return { status: 403, error: "Change the Wolf password before opening Organization." };
  const actor = await loadTrustedActor(db, session.userId);
  if (!actor) return { status: 401, error: "Sign in is required." };
  return { status: 200, actor, email: session.email };
}

export function authorizedCompanyIds(actor: Actor): string[] {
  return [...new Set(actor.memberships.map((membership) => membership.companyId))].sort();
}

function companyAllowed(actor: Actor, companyId: string): boolean {
  return evaluateModuleAccess(actor, "organization", "read", { companyId }).outcome === "allow";
}

function isAdministrator(actor: Actor, companyId: string): boolean {
  return evaluateModuleAccess(actor, "organization", "create", { companyId }).outcome === "allow";
}

function canApprove(actor: Actor, companyId: string): boolean {
  return authorize({ actor, action: "approve", resource: { kind: "company", companyId } }).outcome === "allow";
}

function hasOwnerView(actor: Actor, companyId: string): boolean {
  return authorize({ actor, action: "read", resource: { kind: "owner_private", companyId } }).outcome === "allow";
}

function coversDepartment(actor: Actor, companyId: string, departmentId: string): boolean {
  return actor.memberships.some(
    (membership) =>
      membership.companyId === companyId &&
      (membership.departmentId === null || membership.departmentId === departmentId),
  );
}

export async function readOrganizationTree(
  db: AuthDatabase,
  actor: Actor,
  companyId: string | null,
  query: string,
  source: HrDirectorySource = { mode: "api" },
): Promise<OrgResult<{ companies: OrgCompany[]; tree: OrgTree }>> {
  const companiesAllowed = await filterCompaniesByOperatingGrant(
    db,
    actor,
    authorizedCompanyIds(actor).filter((id) => companyAllowed(actor, id)),
    "organization.board",
  );
  if (companyId && !companiesAllowed.includes(companyId)) {
    return { status: 403, body: { error: "Organization is not available for this company." } };
  }
  if (companiesAllowed.length === 0) {
    return { status: 403, body: { error: "Organization is not available for this account." } };
  }
  const selected = companyId ? [companyId] : companiesAllowed;
  const roster = await loadHrRoster(db, actor.userId, selected, source, actor);
  const tree = await loadTree(db, selected, query, roster.people, roster.unavailable);
  const companyRows = selected.length
    ? await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, selected))
    : [];
  return {
    status: 200,
    body: {
      companies: companyRows.map((row) => ({ id: row.id, name: row.name })),
      tree,
    },
  };
}

export async function readOrganizationPerson(
  db: AuthDatabase,
  actor: Actor,
  personId: string,
  source: HrDirectorySource = { mode: "api" },
): Promise<OrgResult<{ person: OrgPerson; tasks: Array<Pick<TaskView, "id" | "title" | "status" | "companyId" | "isDemo">> }>> {
  const allowed = await filterCompaniesByOperatingGrant(
    db,
    actor,
    authorizedCompanyIds(actor).filter((id) => companyAllowed(actor, id)),
    "organization.board",
  );
  const people = (await loadHrRoster(db, actor.userId, allowed, source, actor)).people;
  const person = people.find((item) => item.id === personId);
  if (!person) return { status: 403, body: { error: "That person is not available for this session." } };
  assertPersonShape(person);
  const visible = await visibleTasks(db, actor, person.companies.map((item) => item.companyId), "assigned-or-company");
  const tasks = visible
    .filter((task) => task.assigneePersonId === person.id)
    .map((task) => ({ id: task.id, title: task.title, status: task.status, companyId: task.companyId, isDemo: true as const }));
  return { status: 200, body: { person, tasks } };
}

export async function readTaskOverview(
  db: AuthDatabase,
  actor: Actor,
  input: { companyId: string | null; from: string; to: string; today: string; scope: "owner" | "company" | "assigned" },
  source: HrDirectorySource = offlineHrDirectory,
): Promise<OrgResult<TaskOverview & { companies: OrgCompany[] }>> {
  if (input.scope === "owner") {
    const owned = authorizedCompanyIds(actor).filter((id) => hasOwnerView(actor, id));
    if (input.companyId && !owned.includes(input.companyId)) {
      return { status: 403, body: { error: "Owner overview is not available for this company." } };
    }
    if (!input.companyId && owned.length === 0) {
      return { status: 403, body: { error: "Owner overview requires an explicit Owner Private grant." } };
    }
  } else if (input.companyId && !companyAllowed(actor, input.companyId)) {
    return { status: 403, body: { error: "Organization is not available for this company." } };
  }
  const companyIds = input.companyId
    ? [input.companyId]
    : authorizedCompanyIds(actor).filter((id) => (input.scope === "owner" ? hasOwnerView(actor, id) : companyAllowed(actor, id)));
  if (companyIds.length === 0) {
    return { status: 403, body: { error: "Organization is not available for this account." } };
  }
  await loadHrRoster(db, actor.userId, companyIds, source, actor);
  const tasks = await visibleTasks(db, actor, companyIds, input.scope);
  const overview = summarize(tasks, input.from, input.to, input.today, input.scope);
  const companyRows = companyIds.length
    ? await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, companyIds))
    : [];
  return { status: 200, body: { ...overview, companies: companyRows } };
}

export async function listReadableCompanies(db: AuthDatabase, actor: Actor): Promise<OrgCompany[]> {
  const ids = await filterCompaniesByOperatingGrant(
    db,
    actor,
    authorizedCompanyIds(actor).filter((id) => visibleOperatorCompanyId(id) && companyAllowed(actor, id)),
    "organization.board",
  );
  if (ids.length === 0) return [];
  const rows = await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, ids));
  return rows.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

export async function readStaffProgress(
  db: AuthDatabase,
  actor: Actor,
  input: { companyId: string | null; today: string },
  source: HrDirectorySource = { mode: "api" },
): Promise<OrgResult<StaffProgress>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.today)) {
    return { status: 400, body: { error: "The progress date is not valid." } };
  }
  const readable = await filterCompaniesByOperatingGrant(
    db,
    actor,
    authorizedCompanyIds(actor).filter((id) => companyAllowed(actor, id)),
    "organization.board",
  );
  const allowed = readable.filter((id) => isAdministrator(actor, id) || hasOwnerView(actor, id));
  if (input.companyId && !readable.includes(input.companyId)) {
    return { status: 403, body: { error: "Organization is not available for this company." } };
  }
  if (input.companyId && !allowed.includes(input.companyId)) {
    return { status: 403, body: { error: "Staff progress requires a company administrator membership or an Owner Private grant." } };
  }
  if (!input.companyId && allowed.length === 0) {
    return { status: 403, body: { error: "Staff progress requires a company administrator membership or an Owner Private grant." } };
  }
  const companyIds = input.companyId ? [input.companyId] : allowed;
  const ownerView = companyIds.length > 0 && companyIds.every((id) => hasOwnerView(actor, id));
  const roster = await loadHrRoster(db, actor.userId, companyIds, source, actor);
  const tasks = await visibleTasks(db, actor, companyIds, ownerView ? "owner" : "company");
  const people = roster.people;
  const companyRows = companyIds.length
    ? await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, companyIds))
    : [];
  const departmentRows = companyIds.length
    ? await db.select({ companyId: departments.companyId, id: departments.id, name: departments.name }).from(departments).where(inArray(departments.companyId, companyIds))
    : [];
  const companyName = new Map(companyRows.map((company) => [company.id, company.name]));
  const departmentName = new Map(departmentRows.map((department) => [`${department.companyId}:${department.id}`, department.name]));
  const byPerson = new Map<string, StaffProgressTask[]>();
  const unassignedTasks: StaffProgressTask[] = [];
  for (const task of tasks) {
    const line = toProgressTask(task, companyName, departmentName, input.today);
    if (!task.assigneePersonId) {
      unassignedTasks.push(line);
      continue;
    }
    const existing = byPerson.get(task.assigneePersonId);
    if (existing) existing.push(line);
    else if (people.some((person) => person.id === task.assigneePersonId)) byPerson.set(task.assigneePersonId, [line]);
  }
  const progressPeople = people
    .map((person) => {
      assertPersonShape(person);
      const personTasks = (byPerson.get(person.id) ?? []).sort(compareProgressTasks);
      return {
        id: person.id,
        displayName: person.displayName,
        employeeCode: person.employeeCode,
        employmentStatus: person.employmentStatus,
        isDemo: person.isDemo,
        companies: person.companies,
        counts: countProgressTasks(personTasks),
        tasks: personTasks,
      };
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id));
  unassignedTasks.sort(compareProgressTasks);
  return {
    status: 200,
    body: {
      scope: ownerView ? "owner" : "company",
      ownerView,
      companies: companyRows.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
      unavailableCompanyIds: [...roster.unavailable].sort(),
      people: progressPeople,
      unassigned: {
        title: "Unassigned team tasks",
        counts: countProgressTasks(unassignedTasks),
        tasks: unassignedTasks,
      },
    },
  };
}

export async function createOrganizationTask(
  db: AuthDatabase,
  actor: Actor,
  email: string,
  now: Date,
  input: {
    companyId: string;
    departmentId: string | null;
    title: string;
    description: string;
    priority: string;
    dueOn: string;
    completionCriteria: string;
    reviewRequired: boolean;
    assigneePersonId: string | null;
    teamDepartmentId: string | null;
  },
  source: HrDirectorySource = { mode: "api" },
): Promise<OrgResult<{ taskId: string }>> {
  const createGrant = await readOperatingGrantEffect(db, actor.userId, input.companyId, "organization.task.create");
  if (createGrant === "deny") return { status: 403, body: { error: "That action is not granted for this operating role." } };
  if (createGrant !== "allow" && !isAdministrator(actor, input.companyId)) {
    return { status: 403, body: { error: "Task creation requires a company administrator membership." } };
  }
  if (!input.assigneePersonId && !input.teamDepartmentId) {
    return { status: 400, body: { error: "Choose a person or a team." } };
  }
  if (!["low", "normal", "high"].includes(input.priority) || !/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) {
    return { status: 400, body: { error: "The task fields are not valid." } };
  }
  const title = input.title.trim();
  const description = input.description.trim();
  const criteria = input.completionCriteria.trim();
  if (title.length < 1 || title.length > 160 || description.length < 1 || criteria.length < 1) {
    return { status: 400, body: { error: "The task fields are not valid." } };
  }
  if (input.assigneePersonId) {
    const people = (await loadHrRoster(db, actor.userId, [input.companyId], source, actor)).people;
    if (!people.some((person) => person.id === input.assigneePersonId && person.isDemo === false)) {
      return { status: 403, body: { error: "That person is not an HR employee of this company." } };
    }
  }
  const id = `demo-task-${now.getTime().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  await db.insert(orgTasks).values({
    id,
    companyId: input.companyId,
    departmentId: input.departmentId,
    title,
    description,
    priority: input.priority,
    dueOn: input.dueOn,
    completionCriteria: criteria,
    reviewRequired: input.reviewRequired,
    status: "ASSIGNED",
    assigneePersonId: input.assigneePersonId,
    teamDepartmentId: input.teamDepartmentId,
    createdByUserId: actor.userId,
    isDemo: true,
    updatedAt: now,
  });
  await recordEvent(db, actor, email, now, id, input.companyId, null, "ASSIGNED", "Task assigned.");
  await pushLinkedStaffTask(db, actor, source, id);
  return { status: 201, body: { taskId: id } };
}

export async function transitionOrganizationTask(
  db: AuthDatabase,
  actor: Actor,
  email: string,
  now: Date,
  taskId: string,
  action: string,
  note: string,
  evidenceUrl: string | null,
  source: HrDirectorySource = offlineHrDirectory,
): Promise<OrgResult<{ status: TaskStatus }>> {
  if (!taskActions.includes(action as TaskAction)) return { status: 400, body: { error: "That task action is not valid." } };
  const taskAction = action as TaskAction;
  if (reasonRequired(taskAction) && note.trim().length < 3) {
    return { status: 400, body: { error: "A reason is required." } };
  }
  if (evidenceUrl && !/^https:\/\/.{1,280}$/.test(evidenceUrl)) {
    return { status: 400, body: { error: "Completion evidence must be an https link." } };
  }
  const rows = await db.select().from(orgTasks).where(eq(orgTasks.id, taskId)).limit(1);
  const task = rows[0];
  if (!task || !companyAllowed(actor, task.companyId)) {
    return { status: 403, body: { error: "That task is not available for this session." } };
  }
  const reviewerAction = taskAction === "approve" || taskAction === "return";
  const assignee = await isAssignee(db, actor, task);
  const reviewer = canApprove(actor, task.companyId) && task.submittedByUserId !== actor.userId;
  const taskGrant = organizationTaskGrant(taskAction);
  const taskEffect = taskGrant ? await readOperatingGrantEffect(db, actor.userId, task.companyId, taskGrant) : "unchanged";
  if (taskEffect === "deny") return { status: 403, body: { error: "That action is not granted for this operating role." } };
  if (taskEffect !== "allow" && reviewerAction && !reviewer) return { status: 403, body: { error: "Review requires an approval grant for this company." } };
  if (taskEffect !== "allow" && !reviewerAction && !assignee && !isAdministrator(actor, task.companyId)) {
    return { status: 403, body: { error: "This account cannot update that task." } };
  }
  const moved = transitionTask(
    { status: task.status as TaskStatus, reviewRequired: task.reviewRequired, submittedByUserId: task.submittedByUserId },
    taskAction,
    actor.userId,
  );
  if (!moved.ok) return { status: 403, body: { error: "That status change is not allowed." } };
  await db
    .update(orgTasks)
    .set({
      status: moved.status,
      submittedByUserId: moved.submits ? actor.userId : task.submittedByUserId,
      evidenceUrl: evidenceUrl ?? task.evidenceUrl,
      completedAt: moved.status === "COMPLETED" ? now : null,
      updatedAt: now,
    })
    .where(eq(orgTasks.id, task.id));
  await recordEvent(db, actor, email, now, task.id, task.companyId, task.status, moved.status, note.trim() || taskAction);
  await pushLinkedStaffTask(db, actor, source, task.id);
  return { status: 200, body: { status: moved.status } };
}

export async function reassignOrganizationTask(
  db: AuthDatabase,
  actor: Actor,
  email: string,
  now: Date,
  taskId: string,
  assigneePersonId: string | null,
  teamDepartmentId: string | null,
  note: string,
  source: HrDirectorySource = { mode: "api" },
): Promise<OrgResult<{ status: TaskStatus }>> {
  const rows = await db.select().from(orgTasks).where(eq(orgTasks.id, taskId)).limit(1);
  const task = rows[0];
  if (!task) return { status: 403, body: { error: "Reassignment requires a company administrator membership." } };
  const assignGrant = await readOperatingGrantEffect(db, actor.userId, task.companyId, "organization.task.assign");
  if (assignGrant === "deny") return { status: 403, body: { error: "That action is not granted for this operating role." } };
  if (assignGrant !== "allow" && !isAdministrator(actor, task.companyId)) {
    return { status: 403, body: { error: "Reassignment requires a company administrator membership." } };
  }
  if (task.status === "COMPLETED" || (!assigneePersonId && !teamDepartmentId)) {
    return { status: 400, body: { error: "That reassignment is not valid." } };
  }
  if (assigneePersonId) {
    const people = (await loadHrRoster(db, actor.userId, [task.companyId], source, actor)).people;
    if (!people.some((person) => person.id === assigneePersonId && person.companies.some((company) => company.companyId === task.companyId))) {
      return { status: 403, body: { error: "That person is not an HR employee of this company." } };
    }
  }
  if (teamDepartmentId) {
    const team = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.companyId, task.companyId), eq(departments.id, teamDepartmentId)))
      .limit(1);
    if (!team[0]) return { status: 403, body: { error: "That team is not available for this company." } };
  }
  const status = task.status as TaskStatus;
  await db
    .update(orgTasks)
    .set({
      assigneePersonId,
      teamDepartmentId,
      updatedAt: now,
    })
    .where(eq(orgTasks.id, task.id));
  await recordEvent(db, actor, email, now, task.id, task.companyId, status, status, note.trim() || "Reassigned.");
  await pushLinkedStaffTask(db, actor, source, task.id);
  return { status: 200, body: { status } };
}

async function isAssignee(db: AuthDatabase, actor: Actor, task: typeof orgTasks.$inferSelect): Promise<boolean> {
  if (!companyAllowed(actor, task.companyId)) return false;
  if (task.teamDepartmentId && coversDepartment(actor, task.companyId, task.teamDepartmentId)) return true;
  if (!task.assigneePersonId) return false;
  const rows = await db.select({ linkedUserId: orgPeople.linkedUserId }).from(orgPeople).where(eq(orgPeople.id, task.assigneePersonId)).limit(1);
  return rows[0]?.linkedUserId === actor.userId;
}

async function visibleTasks(
  db: AuthDatabase,
  actor: Actor,
  companyIds: string[],
  scope: "owner" | "company" | "assigned" | "assigned-or-company",
): Promise<TaskView[]> {
  if (companyIds.length === 0) return [];
  const rows = await db.select().from(orgTasks).where(inArray(orgTasks.companyId, companyIds)).orderBy(asc(orgTasks.dueOn));
  const names = await assigneeNames(db, rows.flatMap((row) => (row.assigneePersonId ? [row.assigneePersonId] : [])));
  const events = rows.length
    ? await db.select().from(orgTaskEvents).where(inArray(orgTaskEvents.taskId, rows.map((row) => row.id))).orderBy(asc(orgTaskEvents.createdAt))
    : [];
  const views: TaskView[] = [];
  for (const row of rows) {
    const assignee = await isAssignee(db, actor, row);
    const reviewer = canApprove(actor, row.companyId) && row.submittedByUserId !== actor.userId;
    const owner = scope === "owner" && hasOwnerView(actor, row.companyId);
    const admin = isAdministrator(actor, row.companyId);
    const assigned = assignee;
    const visible =
      scope === "owner" ? owner : scope === "assigned" ? assigned : scope === "company" ? admin || owner : assigned || admin || owner;
    if (!visible) continue;
    views.push({
      id: row.id,
      companyId: row.companyId,
      departmentId: row.departmentId,
      title: row.title,
      description: row.description,
      priority: row.priority,
      dueOn: row.dueOn,
      completionCriteria: row.completionCriteria,
      reviewRequired: row.reviewRequired,
      status: row.status as TaskStatus,
      assigneePersonId: row.assigneePersonId,
      assigneeName: row.assigneePersonId ? names.get(row.assigneePersonId) ?? null : null,
      teamDepartmentId: row.teamDepartmentId,
      evidenceUrl: row.evidenceUrl,
      isDemo: true,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      allowedActions: allowedActions(row, { assignee, reviewer, administrator: admin }),
      events: events
        .filter((event) => event.taskId === row.id)
        .map((event) => ({
          id: event.id,
          actorUserId: event.actorUserId,
          actorSource: event.actorSource,
          previousStatus: event.previousStatus,
          nextStatus: event.nextStatus,
          reason: event.reason,
          createdAt: event.createdAt.toISOString(),
        })),
    });
  }
  return views;
}

function allowedActions(
  task: typeof orgTasks.$inferSelect,
  role: { assignee: boolean; reviewer: boolean; administrator: boolean },
): TaskAction[] {
  return taskActions.filter((action) => {
    const reviewerAction = action === "approve" || action === "return";
    if (reviewerAction && !role.reviewer) return false;
    if (!reviewerAction && !role.assignee && !role.administrator) return false;
    return transitionTask(
      { status: task.status as TaskStatus, reviewRequired: task.reviewRequired, submittedByUserId: task.submittedByUserId },
      action,
      "actor",
    ).ok;
  });
}

function toProgressTask(
  task: TaskView,
  companyName: Map<string, string>,
  departmentName: Map<string, string>,
  today: string,
): StaffProgressTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    companyId: task.companyId,
    companyName: companyName.get(task.companyId) ?? task.companyId,
    dueOn: task.dueOn,
    overdue: task.status !== "COMPLETED" && task.dueOn < today,
    teamDepartmentId: task.teamDepartmentId,
    teamDepartmentName: task.teamDepartmentId ? departmentName.get(`${task.companyId}:${task.teamDepartmentId}`) ?? null : null,
  };
}

function countProgressTasks(tasks: StaffProgressTask[]): StaffTaskCounts {
  const counts = blankStaffCounts();
  for (const task of tasks) {
    counts[task.status] += 1;
    if (task.overdue) counts.overdue += 1;
  }
  return counts;
}

function blankStaffCounts(): StaffTaskCounts {
  return { ASSIGNED: 0, ACCEPTED: 0, IN_PROGRESS: 0, BLOCKED: 0, IN_REVIEW: 0, COMPLETED: 0, overdue: 0 };
}

function compareProgressTasks(left: StaffProgressTask, right: StaffProgressTask): number {
  return left.dueOn.localeCompare(right.dueOn) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}

function summarize(tasks: TaskView[], from: string, to: string, today: string, scope: TaskOverview["scope"]): TaskOverview {
  const activeRows = tasks.filter((task) => task.status !== "COMPLETED");
  const completed = tasks.filter((task) => task.status === "COMPLETED" && task.completedAt && task.completedAt.slice(0, 10) >= from && task.completedAt.slice(0, 10) <= to);
  const byCompany = group(tasks, (task) => task.companyId).map(([companyId, rows]) => countGroup(companyId, null, rows, from, to));
  const byDepartment = group(
    tasks.filter((task) => task.departmentId),
    (task) => `${task.companyId}:${task.departmentId}`,
  ).map(([key, rows]) => {
    const [companyId, departmentId] = key.split(":");
    return { ...countGroup(companyId, departmentId, rows, from, to), departmentId };
  });
  return {
    active: activeRows.length,
    overdue: activeRows.filter((task) => task.dueOn < today).length,
    blocked: tasks.filter((task) => task.status === "BLOCKED").length,
    inReview: tasks.filter((task) => task.status === "IN_REVIEW").length,
    completedInPeriod: completed.length,
    byCompany: byCompany.map((row) => ({ companyId: row.companyId, active: row.active, blocked: row.blocked, inReview: row.inReview, completed: row.completed })),
    byDepartment,
    tasks,
    scope,
  };
}

function countGroup(companyId: string, departmentId: string | null, rows: TaskView[], from: string, to: string) {
  return {
    companyId,
    departmentId: departmentId ?? "",
    active: rows.filter((task) => task.status !== "COMPLETED").length,
    blocked: rows.filter((task) => task.status === "BLOCKED").length,
    inReview: rows.filter((task) => task.status === "IN_REVIEW").length,
    completed: rows.filter((task) => task.status === "COMPLETED" && task.completedAt && task.completedAt.slice(0, 10) >= from && task.completedAt.slice(0, 10) <= to).length,
  };
}

function group<T>(rows: T[], key: (row: T) => string): Array<[string, T[]]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const value = key(row);
    map.set(value, [...(map.get(value) ?? []), row]);
  }
  return [...map.entries()];
}

async function syncLinkedStaffTasks(
  db: AuthDatabase,
  actor: Actor,
  now: Date,
  companyId: string,
  employees: readonly HrEmployeeLink[],
  source: HrDirectorySource,
): Promise<void> {
  if (source.mode !== "api" || !staffTaskSyncAllowed() || !isHrCompany(companyId)) return;
  await reconcileCompanyStaffTasks(db, actor, now, companyId, employees, createHttpHrStaffTaskClient(actor.userId));
}

async function pushLinkedStaffTask(db: AuthDatabase, actor: Actor, source: HrDirectorySource, taskId: string): Promise<void> {
  if (source.mode !== "api" || !staffTaskSyncAllowed()) return;
  try {
    await pushOrganizationTask(db, createHttpHrStaffTaskClient(actor.userId), taskId);
  } catch {
    // The next organization read retries the same external id.
  }
}

async function loadHrRoster(
  db: AuthDatabase,
  userId: string,
  companyIds: string[],
  source: HrDirectorySource,
  actor: Actor | null = null,
): Promise<{ people: OrgPerson[]; unavailable: Set<string> }> {
  const { directories, unavailable } = await resolveHrDirectories(userId, companyIds, source);
  const now = new Date();
  for (const [companyId, employees] of directories) {
    if (unavailable.has(companyId)) continue;
    await syncHrLinks(db, companyId, employees);
    if (!actor) continue;
    try {
      await syncLinkedStaffTasks(db, actor, now, companyId, employees, source);
    } catch {
      // Keep organization available when one company cannot sync.
    }
  }
  return { people: await assembleHrPeople(db, companyIds, directories), unavailable };
}

async function assembleHrPeople(
  db: AuthDatabase,
  companyIds: string[],
  directories: Map<string, HrEmployeeLink[]>,
): Promise<OrgPerson[]> {
  if (companyIds.length === 0) return [];
  const companyRows = await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, companyIds));
  const companyNames = new Map(companyRows.map((company) => [company.id, company.name]));
  const people: OrgPerson[] = [];
  for (const companyId of companyIds) {
    const employees = directories.get(companyId) ?? [];
    const rows = await readSyncedHrLinks(db, companyId, employees);
    const byCode = new Map(rows.map((row) => [row.employeeCode, row]));
    for (const employee of employees) {
      const row = byCode.get(employee.employeeCode);
      if (!row || row.companyId !== companyId || row.isDemo || row.source !== "hr") continue;
      const card: OrgPerson = {
        id: row.id,
        displayName: row.displayName,
        employeeCode: row.employeeCode,
        employmentStatus: row.employmentStatus,
        isDemo: false,
        companies: [
          {
            companyId,
            companyName: companyNames.get(companyId) ?? companyId,
            departmentId: "",
            departmentName: row.departmentName ?? "No department",
            positionId: row.id,
            positionTitle: row.positionTitle ?? "",
            managerPersonId: null,
            managerName: null,
          },
        ],
      };
      assertPersonShape(card);
      people.push(card);
    }
  }
  return people;
}

async function loadTree(
  db: AuthDatabase,
  companyIds: string[],
  query: string,
  people: OrgPerson[],
  unavailable: Set<string>,
): Promise<OrgTree> {
  const needle = query.trim().toLowerCase();
  const companyRows = companyIds.length
    ? await db.select().from(companies).where(inArray(companies.id, companyIds))
    : [];
  const treeCompanies = companyRows.map((company) => {
    const grouped = new Map<string, OrgPerson[]>();
    for (const person of people) {
      const placement = person.companies.find((item) => item.companyId === company.id);
      if (!placement) continue;
      grouped.set(placement.departmentName, [...(grouped.get(placement.departmentName) ?? []), person]);
    }
    const departmentNames = [...grouped.keys()].sort((left, right) => {
      if (left === "No department") return 1;
      if (right === "No department") return -1;
      return left.localeCompare(right);
    });
    return {
      id: company.id,
      name: company.name,
      directory: unavailable.has(company.id) ? ("unavailable" as const) : ("ready" as const),
      departments: departmentNames
        .map((departmentName) => ({
          id: `${company.id}:${departmentName}`,
          name: departmentName,
          isDemo: false,
          positions: (grouped.get(departmentName) ?? [])
            .map((person) => ({
              id: person.id,
              title: person.companies.find((item) => item.companyId === company.id)?.positionTitle ?? "",
              vacant: false,
              person,
            }))
            .filter((position) => matches(position, departmentName, needle))
            .sort((left, right) => (left.person?.displayName ?? "").localeCompare(right.person?.displayName ?? "") || left.id.localeCompare(right.id)),
        }))
        .filter((department) => department.positions.length > 0),
    };
  });
  return { companies: treeCompanies, vacant: [] };
}

function matches(position: { title: string; person: OrgPerson | null }, departmentName: string, needle: string): boolean {
  if (!needle) return true;
  const person = position.person;
  const values = [position.title, departmentName, person?.displayName ?? "", person?.employeeCode ?? ""];
  return values.some((value) => value.toLowerCase().includes(needle));
}

async function assigneeNames(db: AuthDatabase, personIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(personIds)];
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: orgPeople.id, displayName: orgPeople.displayName }).from(orgPeople).where(inArray(orgPeople.id, ids));
  return new Map(rows.map((row) => [row.id, row.displayName]));
}

function assertPersonShape(person: OrgPerson): void {
  const keys = Object.keys(person).sort();
  const expected = [...personFields].sort();
  if (keys.join() !== expected.join()) {
    throw new Error("Organization person response included an unexpected field.");
  }
}

async function recordEvent(
  db: AuthDatabase,
  actor: Actor,
  email: string,
  now: Date,
  taskId: string,
  companyId: string,
  previousStatus: string | null,
  nextStatus: string,
  reason: string,
): Promise<void> {
  await db.insert(orgTaskEvents).values({
    id: `demo-evt-${taskId}-${now.getTime()}`,
    taskId,
    actorUserId: actor.userId,
    actorSource: "user",
    previousStatus,
    nextStatus,
    reason: reason.slice(0, 200),
    createdAt: now,
  });
  await writeAudit(db, {
    eventType: "authorization_allowed",
    userId: actor.userId,
    companyId,
    resourceType: "org_task",
    resourceId: taskId,
    emailFingerprint: fingerprintEmail(email),
    ip: null,
    metadata: { module: "organization", action: "task_transition", fromStatus: previousStatus, toStatus: nextStatus },
    createdAt: now,
  });
}
