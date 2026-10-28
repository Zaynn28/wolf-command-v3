import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { orgPeople, orgTasks, users } from "../db/schema";
import { ensureTenant } from "../db/tenant";
import type { AuthDatabase } from "../db/types";
import { withDb } from "../test/harness";
import { syncHrLinks } from "./hr-directory";
import { seedOrganizationDemo } from "./seed";
import {
  externalIdForOrgTask,
  hrAssigneeCode,
  projectHrStaffTask,
  reconcileCompanyStaffTasks,
  type HrStaffTaskClient,
  type HrStaffTaskLink,
} from "./hr-task-sync";

const now = new Date("2026-10-23T00:00:00.000Z");
const apriadi = {
  employeeCode: "AMG-14",
  displayName: "Apriadi Idris",
  employmentStatus: "active" as const,
  departmentName: "Housekeeping",
  positionTitle: null,
};

function memoryClient() {
  const rows = new Map<string, HrStaffTaskLink[]>();
  const client: HrStaffTaskClient = {
    async list(companyId) {
      return [...(rows.get(companyId) ?? [])];
    },
    async upsert(companyId, task) {
      if (task.companyId !== companyId) return null;
      const list = rows.get(companyId) ?? [];
      const index = list.findIndex((item) => item.externalId === task.externalId);
      if (index >= 0) list[index] = task;
      else list.push(task);
      rows.set(companyId, list);
      return task;
    },
    async remove(companyId, externalId) {
      rows.set(companyId, (rows.get(companyId) ?? []).filter((item) => item.externalId !== externalId));
      return true;
    },
  };
  return { rows, client };
}

async function addUser(db: AuthDatabase) {
  const row = (await db.insert(users).values({ emailNormalized: "task-sync@wolf-command.test", status: "active", mustChangePassword: false }).returning())[0];
  if (!row) throw new Error("User was not stored.");
  return { userId: row.id, memberships: [], grants: [] };
}

test("staff task projection keeps the shared fields and drops other companies", () => {
  const projected = projectHrStaffTask(
    {
      company_id: "amg",
      external_id: "org:demo-task-team",
      employee_code: "AMG-14",
      title: "Reset the demo lobby",
      due_date: "2026-11-01",
      status: "ASSIGNED",
      updated_at: "2026-10-26T03:00:00.000Z",
      email: "person@example.test",
      phone: "0800",
      nik: "1",
      salary: 1,
    },
    "amg",
  );
  assert.deepEqual(projected, {
    externalId: "org:demo-task-team",
    companyId: "amg",
    employeeCode: "AMG-14",
    title: "Reset the demo lobby",
    dueOn: "2026-11-01",
    status: "ASSIGNED",
    updatedAt: "2026-10-26T03:00:00.000Z",
  });
  assert.equal(JSON.stringify(projected).includes("salary"), false);
  assert.equal(projectHrStaffTask({ company_id: "bzg", external_id: "org:demo-task-team", employee_code: "AMG-14", title: "Reset the demo lobby", due_date: "2026-11-01", status: "ASSIGNED", updated_at: "2026-10-26T03:00:00.000Z" }, "amg"), null);
  assert.equal(hrAssigneeCode({ source: "demo", companyId: null, employeeCode: null, isDemo: true }, "amg"), null);
  assert.equal(externalIdForOrgTask("demo-task-team"), "org:demo-task-team");
});

test("organization and HR staff tasks share one external id per company", async () => {
  await withDb(async (db) => {
    await ensureTenant(db, "amg", null);
    await ensureTenant(db, "bzg", null);
    await seedOrganizationDemo(db, now);
    await syncHrLinks(db, "amg", [apriadi]);
    const actor = await addUser(db);
    const { rows, client } = memoryClient();
    const welcomeBefore = (await db.select().from(orgTasks).where(eq(orgTasks.id, "demo-task-welcome")))[0];
    const linenBefore = (await db.select().from(orgTasks).where(eq(orgTasks.id, "demo-task-linen")))[0];
    const rosterBefore = (await db.select().from(orgTasks).where(eq(orgTasks.id, "demo-task-roster")))[0];

    await db
      .update(orgTasks)
      .set({
        assigneePersonId: "hr-amg-amg-14",
        teamDepartmentId: null,
        updatedAt: new Date("2026-10-26T03:00:00.000Z"),
      })
      .where(eq(orgTasks.id, "demo-task-team"));

    await reconcileCompanyStaffTasks(db, actor, now, "amg", [apriadi], client);
    await reconcileCompanyStaffTasks(db, actor, now, "amg", [apriadi], client);
    const amgTasks = rows.get("amg") ?? [];
    assert.equal(amgTasks.length, 1);
    assert.equal(amgTasks[0]?.externalId, "org:demo-task-team");
    assert.equal(amgTasks[0]?.employeeCode, "AMG-14");
    assert.equal(amgTasks[0]?.title, "Reset the demo lobby");
    assert.equal(amgTasks[0]?.status, "ASSIGNED");
    assert.equal(amgTasks.some((task) => task.title === "Replace lobby linen" || task.title === "Prepare welcome cards"), false);

    amgTasks[0] = {
      ...amgTasks[0],
      title: "Reset the demo lobby synced",
      status: "IN_PROGRESS",
      updatedAt: "2026-10-26T05:00:00.000Z",
    };
    await reconcileCompanyStaffTasks(db, actor, now, "amg", [apriadi], client);
    const linked = (await db.select().from(orgTasks).where(eq(orgTasks.id, "demo-task-team")))[0];
    assert.equal(linked?.title, "Reset the demo lobby synced");
    assert.equal(linked?.status, "IN_PROGRESS");
    assert.equal(linked?.assigneePersonId, "hr-amg-amg-14");
    assert.equal(linked?.hrExternalId, "org:demo-task-team");
    assert.equal((rows.get("amg") ?? []).length, 1);

    rows.get("amg")?.push({
      externalId: "hr:amg:abc123",
      companyId: "amg",
      employeeCode: "AMG-14",
      title: "AMG staff task link",
      dueOn: "2026-12-01",
      status: "ASSIGNED",
      updatedAt: "2026-10-26T06:00:00.000Z",
    });
    await reconcileCompanyStaffTasks(db, actor, now, "amg", [apriadi], client);
    await reconcileCompanyStaffTasks(db, actor, now, "amg", [apriadi], client);
    const created = (await db.select().from(orgTasks).where(eq(orgTasks.hrExternalId, "hr:amg:abc123")));
    assert.equal(created.length, 1);
    assert.equal(created[0]?.companyId, "amg");
    assert.equal(created[0]?.title, "AMG staff task link");
    assert.equal(created[0]?.status, "ASSIGNED");
    assert.equal(created[0]?.assigneePersonId, "hr-amg-amg-14");
    assert.equal(created[0]?.isDemo, false);

    rows.set("bzg", [{
      externalId: "org:demo-task-team",
      companyId: "bzg",
      employeeCode: "AMG-14",
      title: "Reset the demo lobby synced",
      dueOn: "2026-11-01",
      status: "IN_PROGRESS",
      updatedAt: "2026-10-26T05:00:00.000Z",
    }]);
    await reconcileCompanyStaffTasks(db, actor, now, "bzg", [], client);
    const bzg = await db.select().from(orgTasks).where(eq(orgTasks.companyId, "bzg"));
    assert.equal(bzg.some((task) => task.hrExternalId === "org:demo-task-team" || task.title.includes("lobby")), false);
    assert.equal(bzg.find((task) => task.id === "demo-task-vendor")?.assigneePersonId, "demo-noah-ivers");

    const welcome = (await db.select().from(orgTasks).where(eq(orgTasks.id, "demo-task-welcome")))[0];
    const linen = (await db.select().from(orgTasks).where(eq(orgTasks.id, "demo-task-linen")))[0];
    const roster = (await db.select().from(orgTasks).where(eq(orgTasks.id, "demo-task-roster")))[0];
    assert.equal(welcome?.status, welcomeBefore?.status);
    assert.equal(welcome?.assigneePersonId, "demo-jun-park");
    assert.equal(welcome?.hrExternalId, null);
    assert.equal(linen?.status, linenBefore?.status);
    assert.equal(linen?.assigneePersonId, linenBefore?.assigneePersonId);
    assert.equal(linen?.hrExternalId, null);
    assert.equal(roster?.status, rosterBefore?.status);
    assert.equal(roster?.assigneePersonId, rosterBefore?.assigneePersonId);
    const people = await db.select().from(orgPeople).where(eq(orgPeople.source, "hr"));
    assert.equal(people.length, 1);
    assert.equal(people[0]?.employeeCode, "AMG-14");
  });
});
