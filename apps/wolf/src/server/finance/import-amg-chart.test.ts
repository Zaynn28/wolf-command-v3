import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { withDb } from "../test/harness";
import { financeChartAccounts, platformOperators, users } from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { createCompany } from "../admin/companies";
import { readChartAccounts, type ChartAccount } from "./chart-accounts";
import { importAmgChartAccounts, reconcileChartAccounts } from "./import-amg-chart";
import { runAmgChartImportCommand } from "../db/import-amg-chart";

const now = new Date("2026-10-23T00:00:00.000Z");

const cash: ChartAccount = {
  account_code: "1010",
  account_name: "Cash - Operating Bank Account",
  account_type: "Asset",
  normal_balance: "Debit",
  statutory_line: "Cash and Cash Equivalents",
  usali_line: "Cash",
  active: "Y",
};

const revenue: ChartAccount = {
  account_code: "4010",
  account_name: "Rooms Revenue - Transient",
  account_type: "Revenue",
  normal_balance: "Credit",
  statutory_line: "Operating Revenue",
  usali_line: "Rooms - Transient",
  active: "Y",
};

async function user(db: AuthDatabase, email: string) {
  const row = (await db.insert(users).values({ emailNormalized: email, status: "active" }).returning())[0];
  if (!row) throw new Error("missing user");
  return row;
}

function actor(userId: string, companyId: string): Actor {
  return { userId, memberships: [{ companyId, departmentId: "finance", role: "staff" }], grants: [] };
}

test("AMG chart import is repeatable, keeps conflicts, and does not copy into BZG or GGV", async () => {
  await withDb(async (db) => {
    const operatorUser = await user(db, "operator@wolf-command.test");
    await db.insert(platformOperators).values({ userId: operatorUser.id, createdAt: now });
    const operator = actor(operatorUser.id, "amg");
    assert.equal((await createCompany(db, operator, { companyId: "amg", name: "AMG", currencyCode: "IDR", minorScale: 0, workspaceKind: "amg" }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "bzg", name: "BZG", currencyCode: "USD", minorScale: 2 }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "ggv", name: "GGV", currencyCode: "USD", minorScale: 2 }, now)).status, "created");
    const bzg = actor((await user(db, "bzg@wolf-command.test")).id, "bzg");

    const refused = await importAmgChartAccounts(db, { companyId: "bzg", userId: operatorUser.id, accounts: [cash] }, now);
    assert.equal(refused.status, "refused");
    assert.equal((await db.select().from(financeChartAccounts)).length, 0);

    const invalid = await importAmgChartAccounts(db, { companyId: "amg", userId: operatorUser.id, accounts: [cash, { ...revenue, account_type: "Cash" }] }, now);
    assert.equal(invalid.status, "rejected");
    assert.equal(invalid.importedCount, 0);
    assert.equal((await db.select().from(financeChartAccounts)).length, 0);

    const duplicate = await importAmgChartAccounts(db, { companyId: "amg", userId: operatorUser.id, accounts: [cash, { ...cash, account_name: "Other cash" }] }, now);
    assert.equal(duplicate.status, "rejected");
    assert.equal(duplicate.rejected.some((row) => row.reason === "Duplicate account code."), true);
    assert.equal((await db.select().from(financeChartAccounts)).length, 0);

    const imported = await importAmgChartAccounts(db, { companyId: "amg", userId: operatorUser.id, accounts: [cash, revenue] }, now);
    assert.equal(imported.status, "imported");
    assert.equal(imported.importedCount, 2);
    assert.equal(imported.conflictCount, 0);
    const again = await importAmgChartAccounts(db, { companyId: "amg", userId: operatorUser.id, accounts: [cash, revenue] }, now);
    assert.equal(again.importedCount, 0);
    assert.equal(again.skippedCount, 2);
    assert.equal((await db.select().from(financeChartAccounts).where(eq(financeChartAccounts.companyId, "amg"))).length, 2);

    await db.update(financeChartAccounts).set({ accountName: "Reviewed cash" }).where(eq(financeChartAccounts.accountCode, "1010"));
    const conflict = await importAmgChartAccounts(db, { companyId: "amg", userId: operatorUser.id, accounts: [cash, revenue] }, now);
    assert.equal(conflict.importedCount, 0);
    assert.equal(conflict.skippedCount, 1);
    assert.equal(conflict.conflictCount, 1);
    assert.deepEqual(conflict.conflicts[0], { account_code: "1010", fields: ["account_name"] });
    const kept = await db.select().from(financeChartAccounts).where(eq(financeChartAccounts.accountCode, "1010"));
    assert.equal(kept[0]?.accountName, "Reviewed cash");

    const amg = await readChartAccounts(db, operator, "amg");
    const bzgRows = await readChartAccounts(db, bzg, "bzg");
    const ggvRows = await readChartAccounts(db, actor((await user(db, "ggv@wolf-command.test")).id, "ggv"), "ggv");
    assert.equal(amg.status, "ready");
    assert.equal(bzgRows.status, "ready");
    assert.equal(ggvRows.status, "ready");
    if (amg.status !== "ready" || bzgRows.status !== "ready" || ggvRows.status !== "ready") return;
    assert.equal(bzgRows.accounts.length, 0);
    assert.equal(ggvRows.accounts.length, 0);
    assert.equal(amg.accounts.some((account) => account.account_name === "Reviewed cash"), true);
    const reconciliation = reconcileChartAccounts([cash, revenue], amg.accounts);
    assert.equal(reconciliation.matched, false);
    assert.deepEqual(reconciliation.different, [{ account_code: "1010", fields: ["account_name"] }]);
    assert.equal((await readChartAccounts(db, bzg, "amg")).status, "denied");
  });
});

test("the AMG chart import command refuses another database before opening it", async () => {
  let opened = false;
  const messages: string[] = [];
  const code = await runAmgChartImportCommand(
    { DATABASE_URL: "postgres://wolf:local@127.0.0.1:5432/wolf_command", WOLF_ALLOW_AMG_CHART_IMPORT: "1", NODE_ENV: "development" },
    "export.json",
    () => {
      throw new Error("read");
    },
    () => {
      opened = true;
      throw new Error("opened");
    },
    (message) => messages.push(message),
  );
  assert.equal(code, 1);
  assert.equal(opened, false);
  assert.equal(messages.some((message) => message.includes("5433")), true);
  assert.equal(messages.some((message) => message.includes("postgres://")), false);

  const missingFlag = await runAmgChartImportCommand(
    { DATABASE_URL: "postgres://wolf:local@127.0.0.1:5433/wolf_command", NODE_ENV: "development" },
    "export.json",
    () => "[]",
    () => {
      opened = true;
      throw new Error("opened");
    },
    () => {},
  );
  assert.equal(missingFlag, 1);
  assert.equal(opened, false);
});
