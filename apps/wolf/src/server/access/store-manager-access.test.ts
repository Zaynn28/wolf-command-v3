import assert from "node:assert/strict";
import { test } from "node:test";
import type { Actor } from "@wolf/shared";
import { hrAccess, hrCompanyIds, openHrCompany } from "../hr/companies";
import { financeCompanyIds, financeWorkspace } from "../finance/companies";
import { moduleEnabled, readFinanceModules } from "../finance/modules";
import { createCompany } from "../admin/companies";
import { platformOperators, users } from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { withDb } from "../test/harness";
import { evaluateModuleAccess } from "./matrix";
import { grantedHrefs } from "./navigation-access";

const now = new Date("2026-10-24T00:00:00.000Z");

function storeManager(userId: string): Actor {
  return {
    userId,
    memberships: [
      { companyId: "amg", departmentId: "procurement", role: "staff" },
    ],
    grants: [],
  };
}

test("an AMG store manager opens procurement and the AMG employee HRIS screen, not HR staff", async () => {
  const actor = storeManager("store-manager");
  for (const module of ["overview", "finance", "hr", "academy", "content", "organization", "owner_private"] as const) {
    assert.equal(evaluateModuleAccess(actor, module, "read", { companyId: "amg" }).outcome, "deny", module);
  }
  assert.equal(evaluateModuleAccess(actor, "procurement", "read", { companyId: "amg" }).outcome, "allow");
  assert.equal(evaluateModuleAccess(actor, "procurement", "read", { companyId: "bzg" }).outcome, "deny");
  assert.equal(evaluateModuleAccess(actor, "procurement", "delete", { companyId: "amg" }).outcome, "deny");
  assert.equal(evaluateModuleAccess(actor, "hr", "read", { companyId: "bzg" }).outcome, "deny");
  assert.equal(hrAccess(actor, "amg"), "employee");
  assert.equal(hrAccess(actor, "bzg"), null);
  assert.deepEqual(hrCompanyIds(actor), ["amg"]);
  const amg = openHrCompany(actor, "amg");
  assert.equal(amg.status, "unlinked");
  if (amg.status === "unlinked") assert.equal(amg.access, "employee");
  assert.equal(openHrCompany(actor, "bzg").status, "denied");
  assert.equal(financeWorkspace(actor, "amg"), "procurement");
  assert.equal(financeWorkspace(actor, "bzg"), null);
  assert.deepEqual(financeCompanyIds(actor), ["amg"]);
  assert.deepEqual(grantedHrefs(actor), ["/finance", "/hr", "/settings"]);
  assert.deepEqual(grantedHrefs(null), ["/"]);
});

test("AMG finance includes procurement, and a finance membership does not become the store manager grant", async () => {
  await withDb(async (db) => {
    const operator = await operatorActor(db);
    assert.equal((await createCompany(db, operator, { companyId: "amg", name: "AMG", currencyCode: "IDR", minorScale: 0, workspaceKind: "amg" }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "bzg", name: "BZG", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    assert.equal(moduleEnabled(await readFinanceModules(db, "amg"), "procurement"), true);
    assert.equal(moduleEnabled(await readFinanceModules(db, "bzg"), "procurement"), false);

    const finance: Actor = { userId: "finance-admin", memberships: [{ companyId: "amg", departmentId: "finance", role: "administrator" }], grants: [] };
    assert.equal(evaluateModuleAccess(finance, "finance", "read", { companyId: "amg" }).outcome, "allow");
    assert.equal(evaluateModuleAccess(finance, "procurement", "read", { companyId: "amg" }).outcome, "deny");
    assert.equal(financeWorkspace(finance, "amg"), "application");
    assert.ok(grantedHrefs(finance).includes("/finance"));
    assert.equal(grantedHrefs(finance).some((href) => href.includes("procurement")), false);
    assert.equal(grantedHrefs(finance).includes("/hr"), false);
  });
});

async function operatorActor(db: AuthDatabase): Promise<Actor> {
  const row = (await db.insert(users).values({ emailNormalized: "operator@wolf-command.test", status: "active" }).returning())[0];
  if (!row) throw new Error("missing operator");
  await db.insert(platformOperators).values({ userId: row.id, createdAt: now });
  return { userId: row.id, memberships: [], grants: [] };
}
