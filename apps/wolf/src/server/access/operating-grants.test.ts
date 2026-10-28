import assert from "node:assert/strict";
import { test } from "node:test";
import type { Actor } from "@wolf/shared";
import { createCompany } from "../admin/companies";
import { financeWorkspace } from "../finance/companies";
import { hrAccess } from "../hr/companies";
import {
  companyOperatingRoleAssignments,
  companyOperatingRoleGrants,
  memberships,
  platformOperators,
  users,
} from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { withDb } from "../test/harness";
import { evaluateModuleAccess } from "./matrix";
import {
  financeWorkspaceWithGrants,
  grantsForProfile,
  hotelOnlyGrantCodes,
  hrAccessWithGrants,
  omittedOperatingApprovals,
  operatingGrantCatalogErrors,
  operatingGrantDefaults,
  operatingGrantEffect,
  readOperatingEnforcement,
  saveOperatingRoleGrants,
} from "./operating-grants";
import { ensureCompanyOperatingSystem, readCompanyOperatingSystem } from "./operating-system";

const now = new Date("2026-10-28T00:00:00.000Z");

test("the grant catalog stays off owner private, posting, and missing actions", () => {
  assert.deepEqual(operatingGrantCatalogErrors(), []);
  const codes = new Set(omittedOperatingApprovals.map((item) => item.code));
  assert.equal(codes.has("finance.draft.approve"), true);
  assert.equal(codes.has("finance.journal.post"), true);
  assert.equal(codes.has("hr.overtime"), true);
  assert.equal(codes.has("hr.payroll.calculate"), true);
  assert.equal(codes.has("hr.payroll-period.approve"), true);
  assert.equal(codes.has("hr.payroll.post"), true);
  assert.equal(codes.has("assistant.key"), true);
  assert.equal(codes.has("owner_private"), true);
  assert.equal(operatingGrantDefaults("finance-approver").has("finance.approve"), true);
  assert.equal(operatingGrantDefaults("finance-approver").has("finance.book"), false);
  assert.equal([...operatingGrantDefaults("bookkeeper")].some((code) => code.startsWith("hr.")), false);
  assert.equal(operatingGrantDefaults("bookkeeper").has("access.grants.edit"), false);
});

test("BZG cannot store or show a USALI grant", async () => {
  await withDb(async (db) => {
    const operator = await operatorActor(db);
    assert.equal((await createCompany(db, operator, { companyId: "bzg", name: "BZG", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    const view = await readCompanyOperatingSystem(db, "bzg");
    assert.ok(view);
    if (!view) return;
    const shown = view.units.flatMap((unit) => unit.roles.flatMap((role) => role.grants.map((grant) => grant.code)));
    for (const code of hotelOnlyGrantCodes) assert.equal(shown.includes(code), false, code);
    assert.equal(grantsForProfile("neutral").some((grant) => grant.code === "finance.usali"), false);
    const admin = await administrator(db, "bzg");
    const bookkeeper = view.units.flatMap((unit) => unit.roles).find((role) => role.code === "bookkeeper");
    assert.ok(bookkeeper);
    if (!bookkeeper) return;
    const saved = await saveOperatingRoleGrants(db, admin, {
      companyId: "bzg",
      roleCode: "bookkeeper",
      offered: [...bookkeeper.grants.map((grant) => grant.code), "finance.usali"],
      enabled: ["finance.usali"],
    }, now);
    assert.equal(saved.status, "invalid");
    await assert.rejects(() => db.insert(companyOperatingRoleGrants).values({
      companyId: "bzg",
      roleCode: "bookkeeper",
      grantCode: "finance.usali",
      enabled: true,
      profile: "neutral",
      hotelOnly: false,
    }));
  });
});

test("a saved grant reloads and is not reset by seeding", async () => {
  await withDb(async (db) => {
    const operator = await operatorActor(db);
    assert.equal((await createCompany(db, operator, { companyId: "amg", name: "AMG", currencyCode: "IDR", minorScale: 0, workspaceKind: "amg" }, now)).status, "created");
    const admin = await administrator(db, "amg");
    const before = await readCompanyOperatingSystem(db, "amg");
    const approver = before?.units.flatMap((unit) => unit.roles).find((role) => role.code === "finance-approver");
    assert.ok(approver);
    if (!approver) return;
    assert.equal(approver.grants.find((grant) => grant.code === "finance.approve")?.enabled, true);
    const saved = await saveOperatingRoleGrants(db, admin, {
      companyId: "amg",
      roleCode: "finance-approver",
      offered: approver.grants.map((grant) => grant.code),
      enabled: approver.grants.filter((grant) => grant.enabled && grant.code !== "finance.approve").map((grant) => grant.code),
    }, now);
    assert.equal(saved.status, "ok");
    assert.equal((await ensureCompanyOperatingSystem(db, "amg")).status, "ready");
    const after = await readCompanyOperatingSystem(db, "amg");
    const reloaded = after?.units.flatMap((unit) => unit.roles).find((role) => role.code === "finance-approver");
    assert.equal(reloaded?.grants.find((grant) => grant.code === "finance.approve")?.enabled, false);
    const restored = await saveOperatingRoleGrants(db, admin, {
      companyId: "amg",
      roleCode: "finance-approver",
      offered: approver.grants.map((grant) => grant.code),
      enabled: approver.grants.filter((grant) => grant.enabled).map((grant) => grant.code),
    }, now);
    assert.equal(restored.status, "ok");
    const defaults = await readCompanyOperatingSystem(db, "amg");
    assert.equal(defaults?.units.flatMap((unit) => unit.roles).find((role) => role.code === "finance-approver")?.grants.find((grant) => grant.code === "finance.approve")?.enabled, true);
  });
});

test("a finance book grant does not open HR, and finance approval does not open the book or HR", async () => {
  await withDb(async (db) => {
    const operator = await operatorActor(db);
    assert.equal((await createCompany(db, operator, { companyId: "bzg", name: "BZG", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    const bookkeeper = await assigned(db, "bzg", "bookkeeper", "bookkeeper@wolf-command.test");
    const approver = await assigned(db, "bzg", "finance-approver", "approver@wolf-command.test");
    const bookGrants = await readOperatingEnforcement(db, bookkeeper.userId);
    const approvalGrants = await readOperatingEnforcement(db, approver.userId);
    assert.equal(operatingGrantEffect(bookGrants.assignments, bookGrants.grants, "bzg", "finance.book"), "allow");
    assert.equal(operatingGrantEffect(bookGrants.assignments, bookGrants.grants, "bzg", "portal.hr"), "deny");
    assert.equal(hrAccessWithGrants(bookkeeper, "bzg", bookGrants), null);
    assert.equal(financeWorkspaceWithGrants(bookkeeper, "bzg", bookGrants), "application");
    assert.equal(operatingGrantEffect(approvalGrants.assignments, approvalGrants.grants, "bzg", "finance.approve"), "allow");
    assert.equal(operatingGrantEffect(approvalGrants.assignments, approvalGrants.grants, "bzg", "finance.book"), "deny");
    assert.equal(operatingGrantEffect(approvalGrants.assignments, approvalGrants.grants, "bzg", "portal.hr"), "deny");
    assert.equal(financeWorkspaceWithGrants(approver, "bzg", approvalGrants), null);
    assert.equal(hrAccessWithGrants(approver, "bzg", approvalGrants), null);
    assert.equal(evaluateModuleAccess(approver, "hr", "read", { companyId: "bzg" }).outcome, "deny");
  });
});

test("unassigned operator access is unchanged and no operating role is assigned", async () => {
  await withDb(async (db) => {
    const operator = await operatorActor(db);
    assert.equal((await createCompany(db, operator, { companyId: "amg", name: "AMG", currencyCode: "IDR", minorScale: 0, workspaceKind: "amg" }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "bzg", name: "BZG", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "ggv", name: "GGV", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    const account = (await db.insert(users).values({ emailNormalized: "operator.dev@wolf-command.test", status: "active" }).returning())[0];
    if (!account) throw new Error("missing account");
    await db.insert(memberships).values(["amg", "bzg", "ggv"].map((companyId) => ({
      userId: account.id,
      companyId,
      departmentId: null,
      role: "administrator" as const,
      status: "active" as const,
    })));
    const actor: Actor = {
      userId: account.id,
      memberships: ["amg", "bzg", "ggv"].map((companyId) => ({ companyId, departmentId: null, role: "administrator" as const })),
      grants: [],
    };
    const enforcement = await readOperatingEnforcement(db, actor.userId);
    assert.equal(enforcement.assignments.length, 0);
    assert.equal((await db.select().from(companyOperatingRoleAssignments)).length, 0);
    for (const companyId of ["amg", "bzg", "ggv"]) {
      assert.equal(financeWorkspace(actor, companyId), "application");
      assert.equal(financeWorkspaceWithGrants(actor, companyId, enforcement), "application");
      assert.ok(hrAccess(actor, companyId));
      assert.equal(hrAccessWithGrants(actor, companyId, enforcement), hrAccess(actor, companyId));
      assert.equal(evaluateModuleAccess(actor, "finance", "read", { companyId }).outcome, "allow");
      assert.equal(evaluateModuleAccess(actor, "hr", "read", { companyId }).outcome, "allow");
    }
    const financeOnly: Actor = {
      userId: "finance-only",
      memberships: [{ companyId: "bzg", departmentId: "finance", role: "staff" }],
      grants: [],
    };
    assert.equal(hrAccess(financeOnly, "bzg"), null);
    assert.equal(financeWorkspace(financeOnly, "bzg"), "application");
  });
});

async function operatorActor(db: AuthDatabase): Promise<Actor> {
  const row = (await db.insert(users).values({ emailNormalized: "operator@wolf-command.test", status: "active" }).returning())[0];
  if (!row) throw new Error("missing operator");
  await db.insert(platformOperators).values({ userId: row.id, createdAt: now });
  return { userId: row.id, memberships: [], grants: [] };
}

async function administrator(db: AuthDatabase, companyId: string): Promise<Actor> {
  const row = (await db.insert(users).values({ emailNormalized: `admin.${companyId}@wolf-command.test`, status: "active" }).returning())[0];
  if (!row) throw new Error("missing administrator");
  await db.insert(memberships).values({ userId: row.id, companyId, departmentId: null, role: "administrator", status: "active" });
  return { userId: row.id, memberships: [{ companyId, departmentId: null, role: "administrator" }], grants: [] };
}

async function assigned(db: AuthDatabase, companyId: string, roleCode: string, email: string): Promise<Actor> {
  const row = (await db.insert(users).values({ emailNormalized: email, status: "active" }).returning())[0];
  if (!row) throw new Error("missing assignee");
  await db.insert(memberships).values({ userId: row.id, companyId, departmentId: "finance", role: "staff", status: "active" });
  await db.insert(companyOperatingRoleAssignments).values({ companyId, roleCode, userId: row.id, assignedAt: now });
  return { userId: row.id, memberships: [{ companyId, departmentId: "finance", role: "staff" }], grants: [] };
}
