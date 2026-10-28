import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { memberships, orgPeople, orgTasks, users } from "../db/schema";
import { ensureTenant } from "../db/tenant";
import type { AuthDatabase } from "../db/types";
import { seedOrganizationDemo } from "../organization/seed";
import { signIn, withDb } from "../test/harness";
import { serveAcademy, type AcademyDirectory, type AcademySection } from "./directory";

const now = new Date("2026-10-23T00:00:00.000Z");

const amgStaff = [
  { employeeCode: "AMG-14", displayName: "Apriadi Idris", employmentStatus: "active" as const, departmentName: "Housekeeping", positionTitle: "Room attendant" },
  { employeeCode: "AMG-01", displayName: "Lyly", employmentStatus: "active" as const, departmentName: "Executive", positionTitle: null },
];

async function addUser(db: AuthDatabase, email: string) {
  const row = (await db.insert(users).values({ emailNormalized: email, status: "active", mustChangePassword: false }).returning())[0];
  if (!row) throw new Error("User was not stored.");
  return row;
}

function directoryBody(body: unknown): AcademyDirectory {
  assert.equal(typeof body, "object");
  assert.equal(body !== null && "sections" in body, true);
  return body as AcademyDirectory;
}

function section(body: AcademyDirectory, companyId: string): AcademySection {
  const found = body.sections.find((item) => item.companyId === companyId);
  assert.ok(found, companyId);
  return found;
}

test("academy lists only the selected company's HR employees and keeps historical demo rows", async () => {
  await withDb(async (db) => {
    await ensureTenant(db, "amg", "finance");
    await ensureTenant(db, "bzg", "finance");
    await ensureTenant(db, "ggv", "finance");
    await ensureTenant(db, "local-books", "finance");
    await ensureTenant(db, "dev-company", "finance");
    await seedOrganizationDemo(db, now);
    const welcomeBefore = (await db.select().from(orgTasks).where(eq(orgTasks.id, "demo-task-welcome")))[0];
    const linenBefore = (await db.select().from(orgTasks).where(eq(orgTasks.id, "demo-task-linen")))[0];

    const denied = await serveAcademy(db, null, now, { companyId: "amg", query: "" });
    assert.equal(denied.status, 401);

    const admin = await addUser(db, "academy-admin@wolf-command.test");
    await db.insert(memberships).values([
      { userId: admin.id, companyId: "amg", departmentId: "finance", role: "administrator", status: "active" },
      { userId: admin.id, companyId: "bzg", departmentId: "finance", role: "administrator", status: "active" },
      { userId: admin.id, companyId: "ggv", departmentId: "finance", role: "administrator", status: "active" },
      { userId: admin.id, companyId: "local-books", departmentId: "finance", role: "administrator", status: "active" },
      { userId: admin.id, companyId: "dev-company", departmentId: "finance", role: "administrator", status: "active" },
    ]);
    const session = await signIn(db, admin.emailNormalized, now);
    const source = {
      mode: "provided" as const,
      byCompany: { amg: amgStaff, bzg: [], ggv: [] },
    };

    const amg = directoryBody((await serveAcademy(db, session.sessionToken, now, { companyId: "amg", query: "Apriadi" }, source)).body);
    assert.deepEqual(section(amg, "amg").learners.map((learner) => [learner.displayName, learner.employeeCode, learner.departmentName, learner.positionTitle, learner.employmentStatus]), [
      ["Apriadi Idris", "AMG-14", "Housekeeping", "Room attendant", "active"],
    ]);
    assert.equal(JSON.stringify(amg).includes("Lyly"), false);

    const again = await serveAcademy(db, session.sessionToken, now, { companyId: "amg", query: "" }, {
      mode: "provided",
      byCompany: {
        amg: [{ ...amgStaff[0], departmentName: "Housekeeping", positionTitle: "Supervisor" }, amgStaff[1]],
      },
    });
    const amgAgain = directoryBody(again.body);
    assert.equal(section(amgAgain, "amg").learners.length, 2);
    assert.equal(section(amgAgain, "amg").learners.find((learner) => learner.employeeCode === "AMG-14")?.positionTitle, "Supervisor");
    const linked = await db.select().from(orgPeople).where(eq(orgPeople.source, "hr"));
    assert.equal(linked.length, 2);
    assert.equal(linked.every((row) => row.companyId === "amg" && row.linkedUserId === null && row.isDemo === false), true);
    assert.equal((await db.select().from(users)).length, 1);

    for (const companyId of ["bzg", "ggv", "local-books", "dev-company"]) {
      const result = directoryBody((await serveAcademy(db, session.sessionToken, now, { companyId, query: "" }, source)).body);
      assert.equal(section(result, companyId).learners.length, 0);
      assert.equal(JSON.stringify(result).includes("Apriadi"), false);
      assert.equal(JSON.stringify(result).includes("AMG-"), false);
    }

    const combined = directoryBody((await serveAcademy(db, session.sessionToken, now, { companyId: null, query: "" }, source)).body);
    assert.deepEqual(section(combined, "amg").learners.map((learner) => learner.employeeCode).sort(), ["AMG-01", "AMG-14"]);
    assert.equal(section(combined, "bzg").learners.length, 0);
    assert.equal(section(combined, "ggv").learners.length, 0);
    const serialized = JSON.stringify(combined);
    for (const name of ["Jun Park", "Sari Quinn", "Aria Chen", "Mina Sol", "Kai Mendes", "Leo Hart", "Noah Ivers"]) {
      assert.equal(serialized.includes(name), false, name);
    }
    assert.equal(serialized.includes("salary"), false);
    assert.equal(serialized.includes("nik"), false);
    assert.equal(serialized.includes("phone"), false);
    assert.equal(serialized.includes("email"), false);
    assert.equal(serialized.includes("@"), false);
    assert.equal(serialized.includes("linkedUserId"), false);

    const welcome = (await db.select().from(orgTasks).where(eq(orgTasks.id, "demo-task-welcome")))[0];
    const linen = (await db.select().from(orgTasks).where(eq(orgTasks.id, "demo-task-linen")))[0];
    assert.equal(welcome?.status, welcomeBefore?.status);
    assert.equal(welcome?.assigneePersonId, "demo-jun-park");
    assert.equal(linen?.status, linenBefore?.status);
    assert.equal(linen?.assigneePersonId, linenBefore?.assigneePersonId);
    const demoPeople = await db.select().from(orgPeople).where(eq(orgPeople.isDemo, true));
    assert.equal(demoPeople.length > 0, true);
  });
});

test("academy rejects a company the account cannot read", async () => {
  await withDb(async (db) => {
    await ensureTenant(db, "amg", null);
    await ensureTenant(db, "bzg", "finance");
    const staff = await addUser(db, "academy-bzg@wolf-command.test");
    await db.insert(memberships).values({ userId: staff.id, companyId: "bzg", departmentId: "finance", role: "staff", status: "active" });
    const admin = await addUser(db, "academy-amg@wolf-command.test");
    await db.insert(memberships).values({ userId: admin.id, companyId: "amg", departmentId: null, role: "administrator", status: "active" });
    const staffSession = await signIn(db, staff.emailNormalized, now);
    const adminSession = await signIn(db, admin.emailNormalized, new Date(now.getTime() + 1000));
    const source = { mode: "provided" as const, byCompany: { amg: amgStaff, bzg: [] } };

    const departmentStaff = await serveAcademy(db, staffSession.sessionToken, now, { companyId: "bzg", query: "" }, source);
    assert.equal(departmentStaff.status, 403);
    const crossed = await serveAcademy(db, adminSession.sessionToken, now, { companyId: "bzg", query: "" }, source);
    assert.equal(crossed.status, 403);
    assert.equal(JSON.stringify(crossed.body).includes("Apriadi"), false);
    const own = directoryBody((await serveAcademy(db, adminSession.sessionToken, now, { companyId: "amg", query: "" }, source)).body);
    assert.equal(section(own, "amg").learners.length, 2);
    assert.equal(own.sections.every((item) => item.companyId === "amg"), true);
  });
});
