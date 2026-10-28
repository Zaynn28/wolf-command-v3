import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { writeAudit } from "../auth/audit";
import { orgPeople, orgTaskEvents, orgTasks } from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { resolveHrAssertionSecret, signHrAssertion } from "../hr/assertion";
import { hrisApiOrigin } from "../hr/hris-proxy";
import { isHrCompany, type HrEmployeeLink } from "./hr-directory";
import { taskStatuses, type TaskStatus } from "./transitions";

const statusSet = new Set<string>(taskStatuses);
const externalIdPattern = /^[a-z0-9][a-z0-9:_-]{2,80}$/;
const employeeCodePattern = /^[A-Z0-9][A-Z0-9-]{1,31}$/;

export type HrStaffTaskLink = {
  externalId: string;
  companyId: string;
  employeeCode: string;
  title: string;
  dueOn: string;
  status: TaskStatus;
  updatedAt: string;
};

export type HrStaffTaskClient = {
  list(companyId: string): Promise<HrStaffTaskLink[] | null>;
  upsert(companyId: string, task: HrStaffTaskLink): Promise<HrStaffTaskLink | null>;
  remove(companyId: string, externalId: string): Promise<boolean>;
};

type AssigneeRow = {
  source: string;
  companyId: string | null;
  employeeCode: string | null;
  isDemo: boolean;
};

export function staffTaskSyncAllowed(): boolean {
  return !process.execArgv.includes("--test") && !process.argv.includes("--test");
}

export function externalIdForOrgTask(taskId: string): string | null {
  const externalId = `org:${taskId}`;
  return externalIdPattern.test(externalId) ? externalId : null;
}

export function wolfTaskIdForExternal(externalId: string): string {
  const hex = createHash("sha256").update(`hr-staff:${externalId}`).digest("hex").slice(0, 32);
  return `hr-task-${hex}`;
}

export function hrAssigneeCode(person: AssigneeRow | undefined, taskCompanyId: string): string | null {
  if (!person || person.isDemo || person.source !== "hr" || person.companyId !== taskCompanyId) return null;
  if (!person.employeeCode || !employeeCodePattern.test(person.employeeCode)) return null;
  return person.employeeCode;
}

export function projectHrStaffTask(row: unknown, companyId: string): HrStaffTaskLink | null {
  if (!row || typeof row !== "object" || !isHrCompany(companyId)) return null;
  const record = row as Record<string, unknown>;
  if (record.company_id !== companyId) return null;
  if (typeof record.external_id !== "string" || !externalIdPattern.test(record.external_id)) return null;
  if (record.external_id.startsWith("hr:") && !record.external_id.startsWith(`hr:${companyId}:`)) return null;
  if (typeof record.employee_code !== "string" || !employeeCodePattern.test(record.employee_code)) return null;
  if (typeof record.title !== "string") return null;
  const title = record.title.trim();
  if (title.length < 1 || title.length > 160) return null;
  if (typeof record.status !== "string" || !statusSet.has(record.status)) return null;
  const due = typeof record.due_date === "string" ? record.due_date.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
  const rawUpdated = record.updated_at instanceof Date ? record.updated_at.toISOString() : record.updated_at;
  if (typeof rawUpdated !== "string" || !Number.isFinite(Date.parse(rawUpdated))) return null;
  return {
    externalId: record.external_id,
    companyId,
    employeeCode: record.employee_code,
    title,
    dueOn: due,
    status: record.status as TaskStatus,
    updatedAt: new Date(rawUpdated).toISOString(),
  };
}

function stamp(value: string | Date): number {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

async function personByCode(db: AuthDatabase, companyId: string, employeeCode: string) {
  const rows = await db
    .select()
    .from(orgPeople)
    .where(and(eq(orgPeople.source, "hr"), eq(orgPeople.companyId, companyId), eq(orgPeople.employeeCode, employeeCode), eq(orgPeople.isDemo, false)))
    .limit(1);
  return rows[0];
}

async function recordSync(
  db: AuthDatabase,
  actor: Actor,
  now: Date,
  taskId: string,
  companyId: string,
  previousStatus: string | null,
  nextStatus: string,
): Promise<void> {
  await db.insert(orgTaskEvents).values({
    id: `demo-evt-${taskId}-${now.getTime()}-${randomBytes(3).toString("hex")}`,
    taskId,
    actorUserId: actor.userId,
    actorSource: "user",
    previousStatus,
    nextStatus,
    reason: "Synced from HR staff task.",
    createdAt: now,
  });
  await writeAudit(db, {
    eventType: "authorization_allowed",
    userId: actor.userId,
    companyId,
    resourceType: "org_task",
    resourceId: taskId,
    emailFingerprint: null,
    ip: null,
    metadata: { module: "organization", action: "task_transition", fromStatus: previousStatus, toStatus: nextStatus },
    createdAt: now,
  });
}

function knownEmployee(employees: readonly HrEmployeeLink[], employeeCode: string): boolean {
  return employees.some((employee) => employee.employeeCode === employeeCode);
}

export async function reconcileCompanyStaffTasks(
  db: AuthDatabase,
  actor: Actor,
  now: Date,
  companyId: string,
  employees: readonly HrEmployeeLink[],
  client: HrStaffTaskClient,
): Promise<void> {
  if (!isHrCompany(companyId)) return;
  const remote = await client.list(companyId);
  if (!remote) return;
  const remoteById = new Map<string, HrStaffTaskLink>();
  for (const link of remote) {
    if (link.companyId !== companyId || !knownEmployee(employees, link.employeeCode)) continue;
    remoteById.set(link.externalId, link);
  }

  const local = await db.select().from(orgTasks).where(eq(orgTasks.companyId, companyId));
  for (const link of remoteById.values()) {
    const person = await personByCode(db, companyId, link.employeeCode);
    if (!person || person.companyId !== companyId) continue;
    const existing = local.find((task) => task.hrExternalId === link.externalId);
    const updatedAt = new Date(link.updatedAt);
    if (!existing) {
      const id = wolfTaskIdForExternal(link.externalId);
      await db
        .insert(orgTasks)
        .values({
          id,
          companyId,
          departmentId: null,
          title: link.title,
          description: "Synced from the company HR staff task.",
          priority: "normal",
          dueOn: link.dueOn,
          completionCriteria: "Complete the staff task.",
          reviewRequired: false,
          status: link.status,
          assigneePersonId: person.id,
          teamDepartmentId: null,
          createdByUserId: actor.userId,
          isDemo: false,
          hrExternalId: link.externalId,
          completedAt: link.status === "COMPLETED" ? updatedAt : null,
          createdAt: updatedAt,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: orgTasks.id,
          set: {
            title: link.title,
            status: link.status,
            dueOn: link.dueOn,
            assigneePersonId: person.id,
            hrExternalId: link.externalId,
            completedAt: link.status === "COMPLETED" ? updatedAt : null,
            updatedAt,
          },
        });
      await recordSync(db, actor, now, id, companyId, null, link.status);
      continue;
    }
    if (stamp(link.updatedAt) <= existing.updatedAt.getTime()) continue;
    const same =
      existing.title === link.title &&
      existing.status === link.status &&
      existing.dueOn === link.dueOn &&
      existing.assigneePersonId === person.id;
    await db
      .update(orgTasks)
      .set({
        title: link.title,
        status: link.status,
        dueOn: link.dueOn,
        assigneePersonId: person.id,
        completedAt: link.status === "COMPLETED" ? (existing.completedAt ?? updatedAt) : null,
        updatedAt,
      })
      .where(and(eq(orgTasks.id, existing.id), eq(orgTasks.companyId, companyId)));
    if (!same) await recordSync(db, actor, now, existing.id, companyId, existing.status, link.status);
  }

  const current = await db.select().from(orgTasks).where(eq(orgTasks.companyId, companyId));
  for (const task of current) {
    const assignee = task.assigneePersonId
      ? (await db.select().from(orgPeople).where(eq(orgPeople.id, task.assigneePersonId)).limit(1))[0]
      : undefined;
    const employeeCode = hrAssigneeCode(assignee, companyId);
    if (!employeeCode || !knownEmployee(employees, employeeCode)) {
      if (task.hrExternalId && remoteById.has(task.hrExternalId)) await client.remove(companyId, task.hrExternalId);
      continue;
    }
    const externalId = task.hrExternalId ?? externalIdForOrgTask(task.id);
    if (!externalId) continue;
    const remoteTask = remoteById.get(externalId);
    if (remoteTask && stamp(task.updatedAt) <= stamp(remoteTask.updatedAt)) continue;
    const saved = await client.upsert(companyId, {
      externalId,
      companyId,
      employeeCode,
      title: task.title,
      dueOn: task.dueOn,
      status: task.status as TaskStatus,
      updatedAt: task.updatedAt.toISOString(),
    });
    if (saved && task.hrExternalId !== externalId) {
      await db.update(orgTasks).set({ hrExternalId: externalId }).where(and(eq(orgTasks.id, task.id), eq(orgTasks.companyId, companyId)));
    }
  }
}

export async function pushOrganizationTask(db: AuthDatabase, client: HrStaffTaskClient, taskId: string): Promise<void> {
  const task = (await db.select().from(orgTasks).where(eq(orgTasks.id, taskId)).limit(1))[0];
  if (!task || !isHrCompany(task.companyId)) return;
  const assignee = task.assigneePersonId
    ? (await db.select().from(orgPeople).where(eq(orgPeople.id, task.assigneePersonId)).limit(1))[0]
    : undefined;
  const employeeCode = hrAssigneeCode(assignee, task.companyId);
  if (!employeeCode) {
    if (task.hrExternalId) await client.remove(task.companyId, task.hrExternalId);
    return;
  }
  const externalId = task.hrExternalId ?? externalIdForOrgTask(task.id);
  if (!externalId) return;
  const saved = await client.upsert(task.companyId, {
    externalId,
    companyId: task.companyId,
    employeeCode,
    title: task.title,
    dueOn: task.dueOn,
    status: task.status as TaskStatus,
    updatedAt: task.updatedAt.toISOString(),
  });
  if (saved && task.hrExternalId !== externalId) {
    await db.update(orgTasks).set({ hrExternalId: externalId }).where(eq(orgTasks.id, task.id));
  }
}

export function createHttpHrStaffTaskClient(
  userId: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): HrStaffTaskClient {
  async function call(companyId: string, path: string, init: RequestInit): Promise<Response | null> {
    if (!isHrCompany(companyId)) return null;
    const origin = hrisApiOrigin(env);
    const secret = resolveHrAssertionSecret(env);
    if (!origin || !secret || userId.trim() === "") return null;
    const assertion = signHrAssertion(secret, {
      sub: userId,
      companyId,
      iat: Math.floor(Date.now() / 1000),
      jti: randomBytes(16).toString("hex"),
    });
    try {
      return await fetchImpl(`${origin}${path}`, {
        ...init,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-wolf-hr-assertion": assertion,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      return null;
    }
  }

  return {
    async list(companyId) {
      const response = await call(companyId, "/api/staff-tasks", { method: "GET" });
      if (!response?.ok) return null;
      const body: unknown = await response.json();
      if (!Array.isArray(body)) return null;
      const tasks: HrStaffTaskLink[] = [];
      for (const row of body) {
        const task = projectHrStaffTask(row, companyId);
        if (task) tasks.push(task);
      }
      return tasks;
    },
    async upsert(companyId, task) {
      if (task.companyId !== companyId) return null;
      const response = await call(companyId, "/api/staff-tasks", {
        method: "PUT",
        body: JSON.stringify({
          external_id: task.externalId,
          employee_code: task.employeeCode,
          title: task.title,
          due_date: task.dueOn,
          status: task.status,
          updated_at: task.updatedAt,
        }),
      });
      if (!response?.ok) return null;
      return projectHrStaffTask(await response.json(), companyId);
    },
    async remove(companyId, externalId) {
      const response = await call(companyId, `/api/staff-tasks?external_id=${encodeURIComponent(externalId)}`, { method: "DELETE" });
      return response?.ok === true;
    },
  };
}
