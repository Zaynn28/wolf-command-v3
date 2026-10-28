import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { withDb } from "../test/harness";
import { financeAccounts, financeChartAccounts, financeMappingConfigurations, financeModules, financeOperatingDepartments, platformOperators, users } from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { createCompany } from "../admin/companies";
import { readMappingConfiguration, saveMappingConfiguration } from "./mapping-configuration";
import {
  chartDeletionBlocked,
  chartDeactivationBlocked,
  chartSeedBlocked,
  deactivateChartAccount,
  deleteChartAccount,
  readChartAccounts,
  saveChartAccount,
  seedChartAccounts,
  type ChartAccount,
} from "./chart-accounts";

const now = new Date("2026-10-23T00:00:00.000Z");

const bzgAccount: ChartAccount = {
  account_code: "1020",
  account_name: "BZG clearing",
  account_type: "Asset",
  normal_balance: "Debit",
  statutory_line: "Current Assets",
  usali_line: "Accounts Receivable - Guest",
  active: "Y",
};

async function user(db: AuthDatabase, email: string) {
  const row = (await db.insert(users).values({ emailNormalized: email, status: "active" }).returning())[0];
  if (!row) throw new Error("missing user");
  return row;
}

function actor(userId: string, companyId: string, role: "staff" | "administrator" = "staff"): Actor {
  return { userId, memberships: [{ companyId, departmentId: "finance", role }], grants: [] };
}

test("chart accounts stay inside the company and do not reuse the draft ledger or the memory chart", async () => {
  await withDb(async (db) => {
    const operatorUser = await user(db, "operator@wolf-command.test");
    await db.insert(platformOperators).values({ userId: operatorUser.id, createdAt: now });
    const operator = actor(operatorUser.id, "unused");
    assert.equal((await createCompany(db, operator, { companyId: "amg", name: "AMG", currencyCode: "IDR", minorScale: 0, workspaceKind: "amg" }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "bzg", name: "BZG", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "ggv", name: "GGV", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    const amg = actor((await user(db, "amg@wolf-command.test")).id, "amg");
    const bzgUser = await user(db, "bzg@wolf-command.test");
    const bzg = actor(bzgUser.id, "bzg");
    const bzgAdmin = actor(bzgUser.id, "bzg", "administrator");
    const ggv = actor((await user(db, "ggv@wolf-command.test")).id, "ggv");

    const saved = await saveChartAccount(db, bzg, "bzg", bzgAccount, now);
    assert.equal(saved.status, "saved");
    const updated = await saveChartAccount(db, bzg, "bzg", { ...bzgAccount, account_name: "BZG clearing updated" }, now);
    assert.equal(updated.status, "saved");
    if (updated.status !== "saved") return;
    assert.equal(updated.account.account_name, "BZG clearing updated");
    assert.equal(updated.account.active, "Y");

    const ggvAccount: ChartAccount = { ...bzgAccount, account_code: "1020", account_name: "GGV clearing" };
    assert.equal((await saveChartAccount(db, ggv, "ggv", ggvAccount, now)).status, "saved");
    const amgRead = await readChartAccounts(db, amg, "amg");
    const bzgRead = await readChartAccounts(db, bzg, "bzg");
    const ggvRead = await readChartAccounts(db, ggv, "ggv");
    assert.equal(amgRead.status, "ready");
    assert.equal(bzgRead.status, "ready");
    assert.equal(ggvRead.status, "ready");
    if (amgRead.status !== "ready" || bzgRead.status !== "ready" || ggvRead.status !== "ready") return;
    assert.equal(amgRead.accounts.length, 0);
    assert.equal(bzgRead.accounts.length, 1);
    assert.equal(bzgRead.accounts[0]?.account_name, "BZG clearing updated");
    assert.equal(ggvRead.accounts[0]?.account_name, "GGV clearing");
    assert.equal((await readChartAccounts(db, bzg, "ggv")).status, "denied");
    assert.equal((await readChartAccounts(db, bzg, "amg")).status, "denied");
    assert.equal((await saveChartAccount(db, ggv, "amg", { ...bzgAccount, account_name: "Should not land" }, now)).status, "denied");

    assert.equal((await saveMappingConfiguration(db, bzg, "bzg", { revenue_default_debit_account: "1020" }, now)).status, "saved");
    const mapping = await readMappingConfiguration(db, bzg, "bzg");
    assert.equal(mapping.status, "ready");
    if (mapping.status !== "ready") return;
    assert.equal(mapping.configuration.revenue_default_debit_account, "1020");
    assert.equal(bzgRead.accounts[0]?.account_name.includes("GGV"), false);

    const invalid = await saveChartAccount(db, bzg, "bzg", { ...bzgAccount, account_name: "Broken", account_type: "Cash", extra: "no" }, now);
    assert.equal(invalid.status, "invalid");
    const afterInvalid = await readChartAccounts(db, bzg, "bzg");
    if (afterInvalid.status !== "ready") return;
    assert.equal(afterInvalid.accounts.length, 1);
    assert.equal(afterInvalid.accounts[0]?.account_name, "BZG clearing updated");
    assert.equal(afterInvalid.accounts[0]?.account_type, "Asset");

    const deactivate = await deactivateChartAccount(db, bzg, "bzg");
    assert.equal(deactivate.status, "blocked");
    if (deactivate.status !== "blocked") return;
    assert.equal(deactivate.reason, chartDeactivationBlocked);
    const throughSave = await saveChartAccount(db, bzg, "bzg", { ...bzgAccount, account_name: "BZG clearing updated", active: "N" }, now);
    assert.equal(throughSave.status, "blocked");
    assert.equal((await deleteChartAccount(db, bzg, "bzg")).status, "denied");
    const removed = await deleteChartAccount(db, bzgAdmin, "bzg");
    assert.equal(removed.status, "blocked");
    if (removed.status !== "blocked") return;
    assert.equal(removed.reason, chartDeletionBlocked);
    const seeded = await seedChartAccounts(db, bzg, "bzg");
    assert.equal(seeded.status, "blocked");
    if (seeded.status !== "blocked") return;
    assert.equal(seeded.reason, chartSeedBlocked);

    const stillThere = await readChartAccounts(db, bzg, "bzg");
    if (stillThere.status !== "ready") return;
    assert.equal(stillThere.accounts.length, 1);
    assert.equal(stillThere.accounts[0]?.active, "Y");
    assert.equal((await db.select().from(financeChartAccounts).where(eq(financeChartAccounts.companyId, "amg"))).length, 0);
    assert.equal((await db.select().from(financeChartAccounts).where(eq(financeChartAccounts.companyId, "bzg"))).length, 1);
    assert.equal((await db.select().from(financeAccounts)).length, 0);
    assert.equal((await db.select().from(financeOperatingDepartments)).length, 0);
    assert.equal((await db.select().from(financeMappingConfigurations).where(eq(financeMappingConfigurations.companyId, "ggv"))).length, 0);

    await db.update(financeModules).set({ enabled: "N" }).where(eq(financeModules.moduleId, "accounting-core"));
    assert.equal((await readChartAccounts(db, bzg, "bzg")).status, "denied");
    assert.equal((await saveChartAccount(db, bzg, "bzg", { ...bzgAccount, account_name: "Closed" }, now)).status, "denied");
    assert.equal((await deactivateChartAccount(db, bzg, "bzg")).status, "denied");
    assert.equal((await deleteChartAccount(db, bzgAdmin, "bzg")).status, "denied");
    assert.equal((await seedChartAccounts(db, bzg, "bzg")).status, "denied");
    const afterDisable = await db.select().from(financeChartAccounts).where(eq(financeChartAccounts.companyId, "bzg"));
    assert.equal(afterDisable.length, 1);
    assert.equal(afterDisable[0]?.accountName, "BZG clearing updated");
  });
});
