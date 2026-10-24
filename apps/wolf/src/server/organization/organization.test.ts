import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { loginWithPassword } from "../auth/login";
import { auditEvents, departments, grants, memberships, orgPeople, orgTasks, users } from "../db/schema";
import { ensureTenant } from "../db/tenant";
import type { AuthDatabase } from "../db/types";
import { signIn, withDb } from "../test/harness";
import { serveOrganization } from "./handler";
import { seedOrganizationDemo } from "./seed";

const now = new Date("2026-10-23T00:00:00.000Z");

async function addUser(db: AuthDatabase, email: string) {
  const row = (await db.insert(users).values({ emailNormalized: email, status: "active", mustChangePassword: false }).returning())[0];
  if (!row) throw new Error("User was not stored.");
  return row;
}

async function membership(db: AuthDatabase, userId: string, companyId: string, role: "staff" | "administrator" | "owner") {
  await ensureTenant(db, companyId, null);
  await db.insert(memberships).values({ userId, companyId, departmentId: null, role, status: "active" });
}

test("a Wolf session can read demo organization data and an unauthenticated request cannot", async () => {
  await withDb(async (db) => {
    await ensureTenant(db, "amg", null);
    await ensureTenant(db, "bzg", null);
    await ensureTenant(db, "ggv", null);
    await seedOrganizationDemo(db, now);
    const denied = await serveOrganization(db, null, now, { kind: "tree", companyId: "amg", query: "" });
    assert.equal(denied.status, 401);

    const user = await addUser(db, "org-reader@wolf-command.test");
    await membership(db, user.id, "amg", "staff");
    const session = await signIn(db, user.emailNormalized, now);
    const tree = await serveOrganization(db, session.sessionToken, now, { kind: "tree", companyId: null, query: "jun" });
    assert.equal(tree.status, 200);
    const body = JSON.stringify(tree.body);
    assert.match(body, /Jun Park/);
    assert.match(body, /"isDemo":true/);
    assert.equal(body.includes("salary"), false);
    assert.equal(body.includes("password"), false);
    assert.equal(body.includes("linkedUserId"), false);
    assert.equal(body.includes("nik"), false);
  });
});

test("company scope, demo login, seed idempotency, and task authority are enforced", async () => {
  await withDb(async (db) => {
    await ensureTenant(db, "amg", null);
    await ensureTenant(db, "bzg", null);
    await ensureTenant(db, "ggv", null);
    await db.insert(departments).values({ companyId: "amg", id: "wolf-demo-fo", name: "Real Desk", status: "active", isDemo: false });
    const beforeUsers = await db.select().from(users);
    await seedOrganizationDemo(db, now);
    const desk = await db.select().from(departments).where(eq(departments.id, "wolf-demo-fo"));
    assert.equal(desk[0]?.name, "Real Desk");
    assert.equal(desk[0]?.isDemo, false);

    const amg = await addUser(db, "amg-only@wolf-command.test");
    await membership(db, amg.id, "amg", "staff");
    const both = await addUser(db, "both-companies@wolf-command.test");
    await membership(db, both.id, "amg", "administrator");
    await membership(db, both.id, "bzg", "staff");
    const reviewer = await addUser(db, "reviewer@wolf-command.test");
    await membership(db, reviewer.id, "amg", "staff");
    await db.insert(grants).values({ userId: reviewer.id, grantType: "approve", companyId: "amg", scope: "company", departmentId: null });
    await db.update(orgPeople).set({ linkedUserId: reviewer.id }).where(eq(orgPeople.id, "demo-sari-quinn"));
    await db.update(orgTasks).set({ submittedByUserId: reviewer.id }).where(eq(orgTasks.id, "demo-task-audit"));

    const amgSession = await signIn(db, amg.emailNormalized, now);
    const crossed = await serveOrganization(db, amgSession.sessionToken, now, { kind: "tree", companyId: "bzg", query: "" });
    assert.equal(crossed.status, 403);
    const forged = await serveOrganization(db, amgSession.sessionToken, now, {
      kind: "create",
      body: { companyId: "bzg", title: "Forged", description: "No", priority: "low", dueOn: "2026-12-01", completionCriteria: "No", reviewRequired: false, assigneePersonId: "demo-noah-ivers", role: "owner", userId: both.id, isOwner: true },
    });
    assert.equal(forged.status, 403);

    const bothSession = await signIn(db, both.emailNormalized, now);
    const multi = await serveOrganization(db, bothSession.sessionToken, now, { kind: "person", personId: "demo-kai-mendes" });
    assert.equal(multi.status, 200);
    if (multi.status === 200 && "person" in (multi.body as object)) {
      const person = (multi.body as { person: { companies: unknown[]; isDemo: boolean } }).person;
      assert.equal(person.companies.length, 2);
      assert.equal(person.isDemo, true);
    }

    const login = await loginWithPassword({ db, now: () => now }, { email: "demo-jun-park@wolf-command.test", password: "not-a-wolf-password", ip: null });
    assert.notEqual(login.status, "verified");
    const demoUsers = await db.select().from(users).where(eq(users.emailNormalized, "demo-jun-park@wolf-command.test"));
    assert.equal(demoUsers.length, 0);

    await db.update(orgTasks).set({ status: "IN_PROGRESS" }).where(eq(orgTasks.id, "demo-task-welcome"));
    await seedOrganizationDemo(db, now);
    const welcome = await db.select().from(orgTasks).where(eq(orgTasks.id, "demo-task-welcome"));
    assert.equal(welcome[0]?.status, "IN_PROGRESS");
    assert.equal((await db.select().from(users)).length, beforeUsers.length + 3);

    const reviewSession = await signIn(db, reviewer.emailNormalized, now);
    const selfApproval = await serveOrganization(db, reviewSession.sessionToken, now, {
      kind: "transition",
      taskId: "demo-task-audit",
      body: { action: "approve", note: "I approve myself", userId: both.id },
    });
    assert.equal(selfApproval.status, 403);
    const invalid = await serveOrganization(db, bothSession.sessionToken, now, {
      kind: "transition",
      taskId: "demo-task-welcome",
      body: { action: "accept", note: "skip" },
    });
    assert.equal(invalid.status, 403);
    const reassign = await serveOrganization(db, amgSession.sessionToken, now, {
      kind: "reassign",
      taskId: "demo-task-linen",
      body: { assigneePersonId: "demo-mina-sol", note: "move" },
    });
    assert.equal(reassign.status, 403);

    const moved = await serveOrganization(db, bothSession.sessionToken, new Date(now.getTime() + 2000), {
      kind: "transition",
      taskId: "demo-task-welcome",
      body: { action: "block", note: "Waiting on a sample." },
    });
    assert.equal(moved.status, 200);
    const history = await serveOrganization(db, bothSession.sessionToken, now, {
      kind: "tasks",
      companyId: "amg",
      from: "2026-10-01",
      to: "2026-10-31",
      today: "2026-10-23",
      scope: "company",
    });
    assert.equal(history.status, 200);
    const task = (history.body as { tasks: Array<{ id: string; events: Array<{ actorUserId: string | null; previousStatus: string | null; nextStatus: string }> }> }).tasks.find((item) => item.id === "demo-task-welcome");
    assert.equal(task?.events.some((event) => event.actorUserId === both.id && event.previousStatus === "IN_PROGRESS" && event.nextStatus === "BLOCKED"), true);
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.resourceId, "demo-task-welcome"));
    assert.equal(audit.length > 0, true);

    await db.update(users).set({ status: "disabled" }).where(eq(users.id, amg.id));
    const disabled = await serveOrganization(db, amgSession.sessionToken, now, { kind: "tree", companyId: "amg", query: "" });
    assert.equal(disabled.status, 401);
    await db.update(memberships).set({ status: "disabled" }).where(eq(memberships.userId, both.id));
    const revoked = await serveOrganization(db, bothSession.sessionToken, now, { kind: "tree", companyId: "bzg", query: "" });
    assert.equal(revoked.status, 403);
  });
});

const progressToday = "2026-10-24";
const progressStatuses = ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "COMPLETED"] as const;

type ProgressTask = { id: string; title: string; status: string; companyId: string; dueOn: string; overdue: boolean };
type ProgressPerson = {
  id: string;
  displayName: string;
  employmentStatus: string;
  isDemo: boolean;
  companies: Array<{ companyId: string }>;
  counts: Record<string, number>;
  tasks: ProgressTask[];
};
type ProgressBody = {
  ownerView: boolean;
  scope: string;
  people: ProgressPerson[];
  unassigned: { title: string; counts: Record<string, number>; tasks: ProgressTask[] };
};

function progressBody(body: unknown): ProgressBody {
  assert.equal(typeof body, "object");
  assert.ok(body && typeof body === "object" && "people" in body && "unassigned" in body);
  return body as ProgressBody;
}

function progressPerson(body: ProgressBody, id: string): ProgressPerson {
  const found = body.people.find((item) => item.id === id);
  assert.ok(found, id);
  return found;
}

function assertProgressCounts(actual: Record<string, number>, expected: Partial<Record<(typeof progressStatuses)[number] | "overdue", number>>) {
  for (const status of progressStatuses) assert.equal(actual[status], expected[status] ?? 0, status);
  assert.equal(actual.overdue, expected.overdue ?? 0);
  const counted = progressStatuses.reduce((total, status) => total + actual[status], 0);
  assert.equal(Object.keys(actual).sort().join(), [...progressStatuses, "overdue"].sort().join());
  return counted;
}

function forbiddenProgressKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const banned = new Set(["salary", "nik", "password", "email", "linkedUserId", "passwordHash", "score", "rating", "percent", "percentage"]);
  if (Array.isArray(value)) return value.flatMap((item) => forbiddenProgressKeys(item));
  return Object.entries(value).flatMap(([key, child]) => (banned.has(key) ? [key] : []).concat(forbiddenProgressKeys(child)));
}

test("staff progress counts come from tasks and stay inside the actor's companies", async () => {
  await withDb(async (db) => {
    await ensureTenant(db, "amg", null);
    await ensureTenant(db, "bzg", null);
    await ensureTenant(db, "ggv", null);
    await ensureTenant(db, "local-books", null);
    await seedOrganizationDemo(db, now);
    await ensureTenant(db, "local-books", "finance");

    const denied = await serveOrganization(db, null, now, { kind: "progress", companyId: null, today: progressToday });
    assert.equal(denied.status, 401);

    const admin = await addUser(db, "progress-admin@wolf-command.test");
    await db.insert(memberships).values([
      { userId: admin.id, companyId: "amg", departmentId: "wolf-demo-hr", role: "administrator", status: "active" },
      { userId: admin.id, companyId: "bzg", departmentId: "wolf-demo-fin", role: "administrator", status: "active" },
      { userId: admin.id, companyId: "ggv", departmentId: "wolf-demo-night", role: "administrator", status: "active" },
      { userId: admin.id, companyId: "local-books", departmentId: "finance", role: "administrator", status: "active" },
    ]);
    await db.update(orgPeople).set({ linkedUserId: admin.id }).where(eq(orgPeople.id, "demo-jun-park"));
    const adminSession = await signIn(db, admin.emailNormalized, now);

    const forged = await serveOrganization(db, adminSession.sessionToken, now, {
      kind: "progress",
      companyId: "amg",
      today: progressToday,
      body: { userId: "forged-user", role: "owner", isOwner: true, companyId: "bzg", linkedUserId: admin.id },
    });
    assert.equal(forged.status, 200);
    const amg = progressBody(forged.body);
    assert.equal(amg.ownerView, false);
    assert.equal(amg.scope, "company");
    assert.deepEqual(amg.people.map((item) => item.id), [
      "demo-aria-chen",
      "demo-jun-park",
      "demo-kai-mendes",
      "demo-leo-hart",
      "demo-mina-sol",
      "demo-sari-quinn",
    ]);
    assert.equal(amg.people.some((item) => item.id === "demo-noah-ivers"), false);
    for (const item of amg.people) {
      assert.equal(item.isDemo, true);
      assert.equal(item.companies.every((company) => company.companyId === "amg"), true);
    }
    const jun = progressPerson(amg, "demo-jun-park");
    assert.equal(assertProgressCounts(jun.counts, { ASSIGNED: 1, ACCEPTED: 1, overdue: 1 }), jun.tasks.length);
    assert.equal(jun.tasks.some((task) => task.id === "demo-task-linen" && task.status === "ASSIGNED" && task.dueOn === "2026-10-20" && task.overdue && task.companyId === "amg"), true);
    assert.equal(jun.tasks.some((task) => task.id === "demo-task-welcome" && task.status === "ACCEPTED" && task.overdue === false), true);
    assertProgressCounts(progressPerson(amg, "demo-mina-sol").counts, { IN_PROGRESS: 1 });
    assertProgressCounts(progressPerson(amg, "demo-sari-quinn").counts, { IN_REVIEW: 1 });
    assertProgressCounts(progressPerson(amg, "demo-kai-mendes").counts, { COMPLETED: 1 });
    assert.equal(progressPerson(amg, "demo-kai-mendes").tasks[0]?.overdue, false);
    assertProgressCounts(progressPerson(amg, "demo-aria-chen").counts, {});
    assert.equal(progressPerson(amg, "demo-aria-chen").tasks.length, 0);
    assert.equal(amg.unassigned.title, "Unassigned team tasks");
    assert.equal(amg.unassigned.tasks.length, 1);
    assert.equal(amg.unassigned.tasks[0]?.id, "demo-task-team");
    assert.equal(amg.unassigned.tasks[0]?.status, "ASSIGNED");
    assert.equal(amg.people.every((item) => item.tasks.every((task) => task.id !== "demo-task-team")), true);
    const serialized = JSON.stringify(forged.body);
    assert.deepEqual(forbiddenProgressKeys(forged.body), []);
    assert.equal(serialized.includes("linkedUserId"), false);
    assert.equal(serialized.includes("salary"), false);
    assert.equal(serialized.includes("password"), false);
    assert.equal(serialized.includes(admin.id), false);
    assert.equal(serialized.includes("progress-admin@"), false);
    assert.equal(serialized.includes("@"), false);

    await db.update(orgTasks).set({ status: "IN_PROGRESS" }).where(eq(orgTasks.id, "demo-task-linen"));
    const changed = progressBody((await serveOrganization(db, adminSession.sessionToken, now, { kind: "progress", companyId: "amg", today: progressToday })).body);
    assert.equal(assertProgressCounts(progressPerson(changed, "demo-jun-park").counts, { ACCEPTED: 1, IN_PROGRESS: 1, overdue: 1 }), 2);
    assert.equal(progressPerson(changed, "demo-jun-park").tasks.some((task) => task.id === "demo-task-linen" && task.status === "IN_PROGRESS"), true);

    const bzg = progressBody((await serveOrganization(db, adminSession.sessionToken, now, { kind: "progress", companyId: "bzg", today: progressToday })).body);
    assert.deepEqual(bzg.people.map((item) => item.id), ["demo-kai-mendes", "demo-noah-ivers"]);
    assert.equal(progressPerson(bzg, "demo-kai-mendes").companies.length, 1);
    assert.equal(progressPerson(bzg, "demo-kai-mendes").companies[0]?.companyId, "bzg");
    assertProgressCounts(progressPerson(bzg, "demo-kai-mendes").counts, {});
    assert.equal(progressPerson(bzg, "demo-noah-ivers").employmentStatus, "leave");
    assertProgressCounts(progressPerson(bzg, "demo-noah-ivers").counts, { BLOCKED: 1, overdue: 1 });
    assert.equal(bzg.unassigned.tasks.length, 0);
    assert.equal(bzg.people.some((item) => item.id === "demo-jun-park"), false);

    const ggv = progressBody((await serveOrganization(db, adminSession.sessionToken, now, { kind: "progress", companyId: "ggv", today: progressToday })).body);
    assert.equal(ggv.people.length, 0);
    assert.equal(ggv.unassigned.tasks.length, 0);
    const books = progressBody((await serveOrganization(db, adminSession.sessionToken, now, { kind: "progress", companyId: "local-books", today: progressToday })).body);
    assert.equal(books.people.length, 0);
    assert.equal(books.unassigned.tasks.length, 0);

    const combined = progressBody((await serveOrganization(db, adminSession.sessionToken, now, { kind: "progress", companyId: null, today: progressToday })).body);
    assert.equal(combined.ownerView, false);
    const kai = progressPerson(combined, "demo-kai-mendes");
    assert.deepEqual(kai.companies.map((company) => company.companyId).sort(), ["amg", "bzg"]);
    assertProgressCounts(kai.counts, { COMPLETED: 1 });
    assert.equal(combined.people.some((item) => item.id === "demo-noah-ivers"), true);

    for (const companyId of ["dev-company", "not-a-company"]) {
      const missing = await serveOrganization(db, adminSession.sessionToken, now, {
        kind: "progress",
        companyId,
        today: progressToday,
        body: { role: "owner", isOwner: true, userId: admin.id },
      });
      assert.equal(missing.status, 403);
      assert.equal(JSON.stringify(missing.body).includes("Jun Park"), false);
      assert.equal(JSON.stringify(missing.body).includes("demo-noah-ivers"), false);
    }

    const manager = await addUser(db, "progress-manager@wolf-command.test");
    await membership(db, manager.id, "amg", "staff");
    await db.update(orgPeople).set({ linkedUserId: manager.id }).where(eq(orgPeople.id, "demo-leo-hart"));
    await db.insert(grants).values({ userId: manager.id, grantType: "owner_private", companyId: "bzg", scope: null, departmentId: null });
    const managerSession = await signIn(db, manager.emailNormalized, now);
    const managerTree = await serveOrganization(db, managerSession.sessionToken, now, { kind: "tree", companyId: "amg", query: "" });
    assert.equal(managerTree.status, 200);
    const managerProgress = await serveOrganization(db, managerSession.sessionToken, now, {
      kind: "progress",
      companyId: "amg",
      today: progressToday,
      body: { role: "owner", isOwner: true, userId: admin.id },
    });
    assert.equal(managerProgress.status, 403);
    const managerCross = await serveOrganization(db, managerSession.sessionToken, now, { kind: "progress", companyId: "bzg", today: progressToday });
    assert.equal(managerCross.status, 403);

    const owner = await addUser(db, "progress-owner@wolf-command.test");
    await membership(db, owner.id, "amg", "staff");
    await db.insert(grants).values({ userId: owner.id, grantType: "owner_private", companyId: "amg", scope: null, departmentId: null });
    const ownerSession = await signIn(db, owner.emailNormalized, now);
    const ownerProgress = progressBody((await serveOrganization(db, ownerSession.sessionToken, now, { kind: "progress", companyId: "amg", today: progressToday })).body);
    assert.equal(ownerProgress.ownerView, true);
    assert.equal(ownerProgress.scope, "owner");
    assert.equal(ownerProgress.people.some((item) => item.id === "demo-jun-park"), true);
    assert.equal(ownerProgress.people.some((item) => item.id === "demo-noah-ivers"), false);
    const ownerCross = await serveOrganization(db, ownerSession.sessionToken, now, { kind: "progress", companyId: "bzg", today: progressToday });
    assert.equal(ownerCross.status, 403);
  });
});
