import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { withDb } from "../test/harness";
import { financeMappingConfigurations, financeModules, platformOperators, users } from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { createCompany } from "../admin/companies";
import { defaultMappingConfiguration, readMappingConfiguration, saveMappingConfiguration } from "./mapping-configuration";

const now = new Date("2026-10-23T00:00:00.000Z");

async function user(db: AuthDatabase, email: string) {
  const row = (await db.insert(users).values({ emailNormalized: email, status: "active" }).returning())[0];
  if (!row) throw new Error("missing user");
  return row;
}

function actor(userId: string, companyId: string): Actor {
  return { userId, memberships: [{ companyId, departmentId: "finance", role: "staff" }], grants: [] };
}

test("mapping configuration stays inside the company and rejects an invalid payload", async () => {
  await withDb(async (db) => {
    const operatorUser = await user(db, "operator@wolf-command.test");
    await db.insert(platformOperators).values({ userId: operatorUser.id, createdAt: now });
    const operator = actor(operatorUser.id, "unused");
    assert.equal((await createCompany(db, operator, { companyId: "amg", name: "AMG", currencyCode: "IDR", minorScale: 0, workspaceKind: "amg" }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "bzg", name: "BZG", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "ggv", name: "GGV", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    const bzg = actor((await user(db, "bzg@wolf-command.test")).id, "bzg");
    const ggv = actor((await user(db, "ggv@wolf-command.test")).id, "ggv");
    const amg = actor((await user(db, "amg@wolf-command.test")).id, "amg");

    const before = await readMappingConfiguration(db, bzg, "bzg");
    assert.equal(before.status, "ready");
    if (before.status !== "ready") return;
    assert.deepEqual(before.configuration, defaultMappingConfiguration);
    assert.equal((await db.select().from(financeMappingConfigurations)).length, 0);

    const saved = await saveMappingConfiguration(db, bzg, "bzg", { revenue_default_debit_account: "1020" }, now);
    assert.equal(saved.status, "saved");
    if (saved.status !== "saved") return;
    assert.equal(saved.configuration.revenue_default_debit_account, "1020");
    assert.equal(saved.configuration.spending_procurement_credit_account, "");
    assert.equal(saved.configuration.confirmed_by_controller, true);

    const updated = await saveMappingConfiguration(db, bzg, "bzg", { spending_payroll_credit_account: "2020" }, now);
    assert.equal(updated.status, "saved");
    if (updated.status !== "saved") return;
    assert.equal(updated.configuration.revenue_default_debit_account, "1020");
    assert.equal(updated.configuration.spending_payroll_credit_account, "2020");

    const ggvSaved = await saveMappingConfiguration(db, ggv, "ggv", { spending_other_credit_account: "1010" }, now);
    assert.equal(ggvSaved.status, "saved");
    const bzgRead = await readMappingConfiguration(db, bzg, "bzg");
    const ggvRead = await readMappingConfiguration(db, ggv, "ggv");
    const amgRead = await readMappingConfiguration(db, amg, "amg");
    assert.equal(bzgRead.status, "ready");
    assert.equal(ggvRead.status, "ready");
    assert.equal(amgRead.status, "ready");
    if (bzgRead.status !== "ready" || ggvRead.status !== "ready" || amgRead.status !== "ready") return;
    assert.equal(bzgRead.configuration.revenue_default_debit_account, "1020");
    assert.equal(ggvRead.configuration.spending_other_credit_account, "1010");
    assert.equal(ggvRead.configuration.revenue_default_debit_account, "");
    assert.deepEqual(amgRead.configuration, defaultMappingConfiguration);
    assert.equal((await readMappingConfiguration(db, bzg, "ggv")).status, "denied");
    assert.equal((await saveMappingConfiguration(db, ggv, "amg", { revenue_default_debit_account: "9999" }, now)).status, "denied");

    const invalid = await saveMappingConfiguration(db, bzg, "bzg", { revenue_default_debit_account: "1 2", extra: "kept" }, now);
    assert.equal(invalid.status, "invalid");
    const afterInvalid = await readMappingConfiguration(db, bzg, "bzg");
    if (afterInvalid.status !== "ready") return;
    assert.equal(afterInvalid.configuration.revenue_default_debit_account, "1020");
    const stored = await db.select().from(financeMappingConfigurations).where(eq(financeMappingConfigurations.companyId, "bzg"));
    assert.equal(stored.length, 1);

    await db.update(financeModules).set({ enabled: "N" }).where(eq(financeModules.moduleId, "accounting-core"));
    assert.equal((await readMappingConfiguration(db, bzg, "bzg")).status, "denied");
    assert.equal((await saveMappingConfiguration(db, bzg, "bzg", { revenue_default_debit_account: "1000" }, now)).status, "denied");
  });
});
