import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { createCompany } from "../admin/companies";
import { financeWorkspace } from "../finance/companies";
import { hrAccess } from "../hr/companies";
import {
  accessPolicyVersions,
  accessRoles,
  companies,
  companyOperatingResponsibilities,
  companyOperatingRoles,
  companyOperatingUnits,
  departments,
  financeSettings,
  grants,
  memberships,
  platformOperators,
  users,
} from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { withDb } from "../test/harness";
import { evaluateModuleAccess } from "./matrix";
import { capabilityById } from "./policy-model";
import {
  ensureCompanyOperatingSystem,
  hotelOnlyFinanceResponsibilityCodes,
  operatingCatalogErrors,
  operatingResponsibilities,
  readCompanyOperatingSystem,
  type OperatingSystemView,
} from "./operating-system";

const now = new Date("2026-10-28T00:00:00.000Z");

test("the operating catalog stays on existing checks", () => {
  assert.deepEqual(operatingCatalogErrors(), []);
  assert.equal(operatingResponsibilities.some((item) => item.code === "finance.post" || item.code === "finance.journal.post"), false);
  for (const item of operatingResponsibilities) {
    assert.equal(item.capabilityId === "grant.owner_private" || item.capabilityId === "grant.approve.owner_private", false);
  }
});

test("starter operating seed is idempotent and does not touch memberships", async () => {
  await withDb(async (db) => {
    const operator = await operatorActor(db);
    assert.equal((await createCompany(db, operator, { companyId: "amg", name: "AMG", currencyCode: "IDR", minorScale: 0, workspaceKind: "amg" }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "bzg", name: "BZG", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "ggv", name: "GGV", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    await db.insert(companies).values({ id: "wide-co", name: "Wide", status: "active" });
    await db.insert(financeSettings).values({
      companyId: "wide-co",
      currencyCode: "IDR",
      minorScale: 0,
      workspaceKind: "shared",
      roundingMode: "half-up",
    });
    const before = await accessCounts(db);
    const first = await ensureCompanyOperatingSystem(db, "wide-co");
    const seeded = await accessCounts(db);
    const second = await ensureCompanyOperatingSystem(db, "wide-co");
    const after = await accessCounts(db);
    assert.equal(first.status, "ready");
    assert.equal(second.status, "ready");
    if (first.status !== "ready" || second.status !== "ready") return;
    assert.equal(first.profile, "neutral");
    assert.ok(first.inserted > 0);
    assert.equal(second.inserted, 0);
    assert.equal(seeded.memberships, before.memberships);
    assert.equal(seeded.grants, before.grants);
    assert.equal(seeded.policies, before.policies);
    assert.equal(seeded.accessRoles, before.accessRoles);
    assert.ok(seeded.responsibilities > before.responsibilities);
    assert.deepEqual(after, seeded);
    const once = await readCompanyOperatingSystem(db, "wide-co");
    const twice = await readCompanyOperatingSystem(db, "wide-co");
    assert.deepEqual(responsibilityCodes(twice), responsibilityCodes(once));
    assert.equal(new Set(responsibilityCodes(once)).size, responsibilityCodes(once).length);
  });
});

test("BZG and GGV do not receive hotel-only finance responsibilities", async () => {
  await withDb(async (db) => {
    const operator = await operatorActor(db);
    assert.equal((await createCompany(db, operator, { companyId: "amg", name: "AMG", currencyCode: "IDR", minorScale: 0, workspaceKind: "amg" }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "bzg", name: "BZG", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "ggv", name: "GGV", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    const amg = await readCompanyOperatingSystem(db, "amg");
    const bzg = await readCompanyOperatingSystem(db, "bzg");
    const ggv = await readCompanyOperatingSystem(db, "ggv");
    assert.ok(amg && bzg && ggv);
    if (!amg || !bzg || !ggv) return;
    assert.equal(amg.profile, "hotel");
    assert.equal(bzg.profile, "neutral");
    assert.equal(ggv.profile, "neutral");
    assert.deepEqual(bzg.units.map((unit) => unit.code), ggv.units.map((unit) => unit.code));
    assert.equal(bzg.units.some((unit) => unit.code === "rooms"), false);
    assert.equal(ggv.units.some((unit) => unit.code === "rooms"), false);
    assert.equal(amg.units.some((unit) => unit.code === "rooms"), true);
    const bzgCodes = responsibilityCodes(bzg);
    const ggvCodes = responsibilityCodes(ggv);
    const amgCodes = responsibilityCodes(amg);
    for (const code of hotelOnlyFinanceResponsibilityCodes) {
      assert.equal(bzgCodes.includes(code), false, code);
      assert.equal(ggvCodes.includes(code), false, code);
      assert.equal(amgCodes.includes(code), true, code);
    }
    assert.equal(bzg.units.some((unit) => unit.roles.some((role) => role.responsibilities.some((item) => item.hotelOnly))), false);
    const ownerPool = amg.units.flatMap((unit) => unit.roles.flatMap((role) => role.responsibilities)).find((item) => item.code === "finance.owner-pool.read");
    assert.equal(ownerPool?.capabilityId, "membership.department.finance.staff");
    assert.equal(ownerPool?.capabilityId === "grant.owner_private", false);
  });
});

test("a finance-only membership still does not open HR", async () => {
  await withDb(async (db) => {
    const operator = await operatorActor(db);
    assert.equal((await createCompany(db, operator, { companyId: "bzg", name: "BZG", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    const view = await readCompanyOperatingSystem(db, "bzg");
    assert.ok(view);
    if (!view) return;
    const openBook = view.units.flatMap((unit) => unit.roles.flatMap((role) => role.responsibilities)).find((item) => item.code === "finance.book.open");
    const capability = openBook ? capabilityById(openBook.capabilityId) : null;
    assert.equal(capability?.membership?.departmentKey, "finance");
    assert.equal(capability?.membership?.role, "staff");
    const financeOnly: Actor = {
      userId: "finance-only",
      memberships: [{ companyId: "bzg", departmentId: "finance", role: "staff" }],
      grants: [],
    };
    assert.equal(hrAccess(financeOnly, "bzg"), null);
    assert.equal(financeWorkspace(financeOnly, "bzg"), "application");
    assert.equal(evaluateModuleAccess(financeOnly, "hr", "read", { companyId: "bzg" }).outcome, "deny");
    assert.equal(evaluateModuleAccess(financeOnly, "finance", "read", { companyId: "bzg" }).outcome, "allow");
  });
});

test("seeding the operating system does not lock the operator out or change the store manager", async () => {
  await withDb(async (db) => {
    const operator = await operatorActor(db);
    assert.equal((await createCompany(db, operator, { companyId: "amg", name: "AMG", currencyCode: "IDR", minorScale: 0, workspaceKind: "amg" }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "bzg", name: "BZG", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "ggv", name: "GGV", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    const account = (await db.insert(users).values({ emailNormalized: "operator.dev@wolf-command.test", status: "active" }).returning())[0];
    if (!account) throw new Error("missing account");
    await db.insert(memberships).values(
      ["amg", "bzg", "ggv"].map((companyId) => ({
        userId: account.id,
        companyId,
        departmentId: null,
        role: "administrator" as const,
        status: "active" as const,
      })),
    );
    await db.insert(departments).values({ companyId: "amg", id: "procurement", name: "Procurement", status: "active" });
    const manager = (await db.insert(users).values({ emailNormalized: "store-manager.amg@wolf-command.test", status: "active" }).returning())[0];
    if (!manager) throw new Error("missing store manager");
    await db.insert(memberships).values({
      userId: manager.id,
      companyId: "amg",
      departmentId: "procurement",
      role: "staff",
      status: "active",
    });
    const before = await accessCounts(db);
    for (const companyId of ["amg", "bzg", "ggv"]) {
      const seeded = await ensureCompanyOperatingSystem(db, companyId);
      assert.equal(seeded.status, "ready");
      if (seeded.status === "ready") assert.equal(seeded.inserted, 0);
    }
    const after = await accessCounts(db);
    assert.deepEqual(after, before);
    const actor: Actor = {
      userId: account.id,
      memberships: ["amg", "bzg", "ggv"].map((companyId) => ({ companyId, departmentId: null, role: "administrator" as const })),
      grants: [],
    };
    for (const companyId of ["amg", "bzg", "ggv"]) {
      assert.equal(evaluateModuleAccess(actor, "finance", "read", { companyId }).outcome, "allow");
      assert.equal(evaluateModuleAccess(actor, "hr", "read", { companyId }).outcome, "allow");
      assert.equal(financeWorkspace(actor, companyId), "application");
      assert.ok(hrAccess(actor, companyId));
    }
    const storeManager: Actor = {
      userId: manager.id,
      memberships: [{ companyId: "amg", departmentId: "procurement", role: "staff" }],
      grants: [],
    };
    assert.equal(financeWorkspace(storeManager, "amg"), "procurement");
    assert.equal(hrAccess(storeManager, "amg"), "employee");
    assert.equal(evaluateModuleAccess(storeManager, "finance", "read", { companyId: "amg" }).outcome, "deny");
    assert.equal(evaluateModuleAccess(storeManager, "hr", "read", { companyId: "amg" }).outcome, "deny");
    const hidden = await ensureCompanyOperatingSystem(db, "local-books");
    assert.deepEqual(hidden, { status: "skipped", reason: "hidden" });
    await db.insert(companies).values({ id: "dev-company", name: "dev-company", status: "active" });
    const unconfigured = await ensureCompanyOperatingSystem(db, "dev-company");
    assert.deepEqual(unconfigured, { status: "skipped", reason: "unconfigured" });
    const devRows = await db.select().from(companyOperatingUnits).where(eq(companyOperatingUnits.companyId, "dev-company"));
    assert.equal(devRows.length, 0);
  });
});

function responsibilityCodes(view: OperatingSystemView): string[] {
  return view.units.flatMap((unit) => unit.roles.flatMap((role) => role.responsibilities.map((item) => item.code)));
}

async function accessCounts(db: AuthDatabase) {
  const [membershipRows, grantRows, policyRows, roleRows, responsibilityRows] = await Promise.all([
    db.select({ id: memberships.id }).from(memberships),
    db.select({ id: grants.id }).from(grants),
    db.select({ id: accessPolicyVersions.id }).from(accessPolicyVersions),
    db.select({ id: accessRoles.id }).from(accessRoles),
    db.select({ code: companyOperatingResponsibilities.responsibilityCode }).from(companyOperatingResponsibilities),
  ]);
  const roles = await db.select({ code: companyOperatingRoles.roleCode }).from(companyOperatingRoles);
  return {
    memberships: membershipRows.length,
    grants: grantRows.length,
    policies: policyRows.length,
    accessRoles: roleRows.length,
    operatingRoles: roles.length,
    responsibilities: responsibilityRows.length,
  };
}

async function operatorActor(db: AuthDatabase): Promise<Actor> {
  const row = (await db.insert(users).values({ emailNormalized: "operator@wolf-command.test", status: "active" }).returning())[0];
  if (!row) throw new Error("missing operator");
  await db.insert(platformOperators).values({ userId: row.id, createdAt: now });
  return { userId: row.id, memberships: [], grants: [] };
}
