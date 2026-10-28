import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { withDb } from "../test/harness";
import {
  atriumDraftJournalLines,
  atriumDraftJournals,
  atriumRevenueDocuments,
  atriumSpendingDocuments,
  auditEvents,
  financeAccounts,
  financeChartAccounts,
  financeJournalLines,
  financeJournals,
  financeMappingConfigurations,
  financeModules,
  financePeriods,
  platformOperators,
  users,
} from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { createCompany } from "../admin/companies";
import { saveChartAccount, type ChartAccount } from "./chart-accounts";
import { saveMappingConfiguration } from "./mapping-configuration";
import { saveOperatingDepartment } from "./operating-departments";
import { createAtriumDraftJournal, deleteAtriumDraftJournal } from "./atrium-draft-journals";
import {
  atriumCycleRoute,
  createRevenueDocument,
  createSpendingDocument,
  readRevenueDocuments,
  readSpendingDocuments,
  type CycleWriteFault,
} from "./atrium-revenue-spending";

const now = new Date("2026-10-23T00:00:00.000Z");

const cash: ChartAccount = {
  account_code: "1010",
  account_name: "Cash",
  account_type: "Asset",
  normal_balance: "Debit",
  statutory_line: "Cash",
  usali_line: "Cash",
  active: "Y",
};
const guest: ChartAccount = { ...cash, account_code: "1020", account_name: "Guest ledger" };
const revenue: ChartAccount = {
  account_code: "4010",
  account_name: "Rooms",
  account_type: "Revenue",
  normal_balance: "Credit",
  statutory_line: "Revenue",
  usali_line: "Rooms",
  active: "Y",
};
const expense: ChartAccount = {
  account_code: "5010",
  account_name: "Supplies",
  account_type: "Expense",
  normal_balance: "Debit",
  statutory_line: "Expense",
  usali_line: "Supplies",
  active: "Y",
};
const payable: ChartAccount = {
  account_code: "2010",
  account_name: "Accounts payable",
  account_type: "Liability",
  normal_balance: "Credit",
  statutory_line: "Payable",
  usali_line: "Payable",
  active: "Y",
};

function actor(userId: string, companyId: string, role: "staff" | "administrator" = "staff"): Actor {
  return { userId, memberships: [{ companyId, departmentId: "finance", role }], grants: [] };
}

async function user(db: AuthDatabase, email: string) {
  const row = (await db.insert(users).values({ emailNormalized: email, status: "active" }).returning())[0];
  if (!row) throw new Error("missing user");
  return row;
}

async function enableHotel(db: AuthDatabase, companyId: string) {
  await db
    .update(financeModules)
    .set({ enabled: "Y" })
    .where(and(eq(financeModules.companyId, companyId), eq(financeModules.moduleId, "hotel-operations")));
}

async function counts(db: AuthDatabase, companyId: string) {
  const revenueRows = await db.select().from(atriumRevenueDocuments).where(eq(atriumRevenueDocuments.companyId, companyId));
  const spendingRows = await db.select().from(atriumSpendingDocuments).where(eq(atriumSpendingDocuments.companyId, companyId));
  const journals = await db.select().from(atriumDraftJournals).where(eq(atriumDraftJournals.companyId, companyId));
  const lines = await db.select().from(atriumDraftJournalLines).where(eq(atriumDraftJournalLines.companyId, companyId));
  const audits = await db.select().from(auditEvents).where(eq(auditEvents.companyId, companyId));
  return { revenue: revenueRows.length, spending: spendingRows.length, journals: journals.length, lines: lines.length, audits: audits.length };
}

test("revenue and spending documents stay with their draft journals inside the company", async () => {
  await withDb(async (db) => {
    const operatorUser = await user(db, "operator@wolf-command.test");
    await db.insert(platformOperators).values({ userId: operatorUser.id, createdAt: now });
    const operator = actor(operatorUser.id, "amg", "administrator");
    assert.equal((await createCompany(db, operator, { companyId: "amg", name: "AMG", currencyCode: "IDR", minorScale: 0, workspaceKind: "amg" }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "bzg", name: "BZG", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "ggv", name: "GGV", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    await enableHotel(db, "bzg");
    await enableHotel(db, "ggv");
    const bzgUser = await user(db, "bzg@wolf-command.test");
    const bzg = actor(bzgUser.id, "bzg");
    const bzgAdmin = actor(bzgUser.id, "bzg", "administrator");
    const ggvUser = await user(db, "ggv@wolf-command.test");
    const ggv = actor(ggvUser.id, "ggv");
    const ggvAdmin = actor(ggvUser.id, "ggv", "administrator");
    const amg = actor((await user(db, "amg@wolf-command.test")).id, "amg");

    for (const company of [bzg, ggv, amg] as const) {
      for (const account of [cash, guest, revenue, expense, payable]) {
        assert.equal((await saveChartAccount(db, company, company.memberships[0]?.companyId ?? "", account, now)).status, "saved");
      }
    }
    await db.insert(financeChartAccounts).values({
      companyId: "bzg",
      accountCode: "1099",
      accountName: "Inactive cash",
      accountType: "Asset",
      normalBalance: "Debit",
      statutoryLine: "",
      usaliLine: "",
      active: "N",
      createdAt: now,
      updatedAt: now,
    });
    assert.equal((await saveOperatingDepartment(db, bzg, "bzg", { department_code: "ROOMS", department_name: "Rooms", active: "Y" }, now)).status, "saved");
    assert.equal((await saveOperatingDepartment(db, bzg, "bzg", { department_code: "CLOSED", department_name: "Closed", active: "N" }, now)).status, "saved");
    assert.equal((await saveOperatingDepartment(db, ggv, "ggv", { department_code: "FOOD", department_name: "Food", active: "Y" }, now)).status, "saved");
    assert.equal((await saveMappingConfiguration(db, bzg, "bzg", {
      revenue_default_debit_account: "1020",
      spending_procurement_credit_account: "2010",
      spending_payroll_credit_account: "1010",
      spending_other_credit_account: "1020",
    }, now)).status, "saved");
    assert.equal((await saveMappingConfiguration(db, ggv, "ggv", {
      revenue_default_debit_account: "1010",
      spending_procurement_credit_account: "2010",
      spending_payroll_credit_account: "2010",
      spending_other_credit_account: "1010",
    }, now)).status, "saved");

    await db.insert(financePeriods).values({ companyId: "bzg", periodKey: "2026-07", createdAt: now });
    await db.insert(financeAccounts).values({ companyId: "bzg", accountCode: "1000", accountName: "Legacy cash", active: "Y", createdAt: now });
    await db.insert(financeAccounts).values({ companyId: "bzg", accountCode: "4000", accountName: "Legacy revenue", active: "Y", createdAt: now });
    await db.insert(financeJournals).values({ companyId: "bzg", id: "jnl_legacy", periodKey: "2026-07", memo: "legacy", status: "draft", createdBy: bzgUser.id, createdAt: now });
    await db.insert(financeJournalLines).values([
      { companyId: "bzg", journalId: "jnl_legacy", lineNo: 1, accountCode: "1000", debit: "1.0000", credit: "0.0000" },
      { companyId: "bzg", journalId: "jnl_legacy", lineNo: 2, accountCode: "4000", debit: "0.0000", credit: "1.0000" },
    ]);

    const emptyRevenue = await readRevenueDocuments(db, bzg, "bzg");
    const emptySpending = await readSpendingDocuments(db, ggv, "ggv");
    assert.equal(emptyRevenue.status, "ready");
    assert.equal(emptySpending.status, "ready");
    if (emptyRevenue.status === "ready") assert.deepEqual(emptyRevenue.documents, []);
    if (emptySpending.status === "ready") assert.deepEqual(emptySpending.documents, []);
    assert.equal((await readRevenueDocuments(db, ggv, "bzg")).status, "denied");
    assert.equal((await readSpendingDocuments(db, bzg, "ggv")).status, "denied");

    const before = await counts(db, "bzg");
    const revenueInput = {
      date: "2026-07-31",
      source: "PMS",
      department_code: "ROOMS",
      account_code: "4010",
      amount: 10.1,
      description: "Folio",
      debit_account_code: "1010",
      company_id: "ggv",
    };
    assert.equal((await createRevenueDocument(db, bzg, "bzg", "bzg@wolf-command.test", revenueInput, now)).status, "invalid");
    assert.deepEqual(await counts(db, "bzg"), before);

    const saved = await createRevenueDocument(db, bzg, "bzg", "bzg@wolf-command.test", {
      date: "2026-07-31",
      source: "PMS",
      department_code: "ROOMS",
      account_code: "4010",
      amount: "10.10",
      description: "Folio",
      debit_account_code: "1010",
    }, now);
    assert.equal(saved.status, "saved");
    if (saved.status !== "saved") return;
    assert.equal(saved.transaction.source, "PMS");
    assert.equal(saved.transaction.amount, 10.1);
    assert.equal(saved.transaction.account_code, "4010");
    assert.equal(saved.draftJournal.source_type, "REVENUE");
    assert.equal(saved.draftJournal.source_reference, saved.transaction.transaction_id);
    assert.equal(saved.draftJournal.period, "2026-07");
    assert.equal(saved.draftJournal.status, "DRAFT");
    assert.equal(saved.draftJournal.created_by, "bzg@wolf-command.test");
    assert.equal(saved.draftJournal.approved_by, "");
    assert.equal(saved.draftJournal.posted_at, "");
    assert.equal(saved.draftJournal.total_debit, 10.1);
    assert.equal(saved.draftJournal.total_credit, 10.1);
    assert.equal(saved.draftJournal.is_balanced, true);
    assert.equal(saved.draftJournal.lines.length, 2);
    assert.equal(saved.draftJournal.lines[0]?.account_code, "1010");
    assert.equal(saved.draftJournal.lines[1]?.account_code, "4010");
    assert.equal(saved.transaction.journal_id.startsWith("JRN-PMS"), false);
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.resourceId, saved.transaction.transaction_id));
    assert.equal(audit[0]?.metadata.action, "atrium_revenue_recorded");
    assert.equal(JSON.stringify(audit[0]?.metadata).includes("10.1"), false);
    assert.equal(JSON.stringify(audit[0]?.metadata).includes("Folio"), false);

    const leap = await createSpendingDocument(db, ggv, "ggv", "ggv@wolf-command.test", {
      date: "2024-02-29",
      type: "Payroll",
      vendor_or_employee: "Night team",
      department_code: "FOOD",
      account_code: "5010",
      amount: 2.5,
      description: "Wages",
      credit_account_code: "2010",
    }, now);
    assert.equal(leap.status, "saved");
    if (leap.status !== "saved") return;
    assert.equal(leap.draftJournal.period, "2024-02");
    assert.equal(leap.draftJournal.source_type, "SPENDING");
    assert.equal(leap.draftJournal.total_debit, 2.5);
    assert.equal(leap.draftJournal.total_credit, 2.5);
    assert.equal(leap.transaction.journal_id, leap.draftJournal.journal_id);

    const bzgRevenue = await readRevenueDocuments(db, bzg, "bzg");
    const ggvRevenue = await readRevenueDocuments(db, ggv, "ggv");
    const ggvSpending = await readSpendingDocuments(db, ggv, "ggv");
    const bzgSpending = await readSpendingDocuments(db, bzg, "bzg");
    if (bzgRevenue.status !== "ready" || ggvRevenue.status !== "ready" || ggvSpending.status !== "ready" || bzgSpending.status !== "ready") return;
    assert.equal(bzgRevenue.documents.length, 1);
    assert.equal(ggvRevenue.documents.length, 0);
    assert.equal(ggvSpending.documents.length, 1);
    assert.equal(bzgSpending.documents.length, 0);
    assert.equal((await readRevenueDocuments(db, amg, "amg")).status, "ready");

    const unchanged = await counts(db, "bzg");
    await db.update(financeMappingConfigurations).set({ confirmedByController: false }).where(eq(financeMappingConfigurations.companyId, "bzg"));
    assert.equal((await createRevenueDocument(db, bzg, "bzg", "bzg@wolf-command.test", {
      date: "2026-08-01", source: "Manual", department_code: "ROOMS", account_code: "4010", amount: 1, debit_account_code: "1010",
    }, now)).status, "invalid");
    await db.update(financeMappingConfigurations).set({ confirmedByController: true, revenueDefaultDebitAccount: "" }).where(eq(financeMappingConfigurations.companyId, "bzg"));
    assert.equal((await createRevenueDocument(db, bzg, "bzg", "bzg@wolf-command.test", {
      date: "2026-08-01", source: "Manual", department_code: "ROOMS", account_code: "4010", amount: 1, debit_account_code: "1010",
    }, now)).status, "invalid");
    await db.update(financeMappingConfigurations).set({ revenueDefaultDebitAccount: "5010" }).where(eq(financeMappingConfigurations.companyId, "bzg"));
    const mappedType = await createRevenueDocument(db, bzg, "bzg", "bzg@wolf-command.test", {
      date: "2026-08-01", source: "Manual", department_code: "ROOMS", account_code: "4010", amount: 1, debit_account_code: "1010",
    }, now);
    assert.equal(mappedType.status, "invalid");
    if (mappedType.status === "invalid") assert.match(mappedType.reason, /mapping counterpart/);
    await db.update(financeMappingConfigurations).set({ revenueDefaultDebitAccount: "1020" }).where(eq(financeMappingConfigurations.companyId, "bzg"));
    assert.equal((await createRevenueDocument(db, bzg, "bzg", "bzg@wolf-command.test", {
      date: "2026-08-01", source: "Manual", department_code: "ROOMS", account_code: "5010", amount: 1, debit_account_code: "1010",
    }, now)).status, "invalid");
    assert.equal((await createRevenueDocument(db, bzg, "bzg", "bzg@wolf-command.test", {
      date: "2026-08-01", source: "Manual", department_code: "ROOMS", account_code: "4010", amount: 1, debit_account_code: "5010",
    }, now)).status, "invalid");
    assert.equal((await createRevenueDocument(db, bzg, "bzg", "bzg@wolf-command.test", {
      date: "2026-08-01", source: "Manual", department_code: "ROOMS", account_code: "4010", amount: 1, debit_account_code: "1099",
    }, now)).status, "invalid");
    assert.equal((await createRevenueDocument(db, ggv, "ggv", "ggv@wolf-command.test", {
      date: "2026-08-01", source: "Manual", department_code: "FOOD", account_code: "4010", amount: 1, debit_account_code: "1010",
    }, now)).status, "saved");
    assert.equal((await createRevenueDocument(db, bzg, "ggv", "bzg@wolf-command.test", {
      date: "2026-08-01", source: "Manual", department_code: "FOOD", account_code: "4010", amount: 1,
    }, now)).status, "denied");
    assert.equal((await createRevenueDocument(db, bzg, "bzg", "bzg@wolf-command.test", {
      date: "2026-02-31", source: "Manual", department_code: "ROOMS", account_code: "4010", amount: 1,
    }, now)).status, "invalid");
    assert.equal((await createRevenueDocument(db, bzg, "bzg", "bzg@wolf-command.test", {
      date: "2025-02-29", source: "Manual", department_code: "ROOMS", account_code: "4010", amount: 1,
    }, now)).status, "invalid");
    assert.equal((await createRevenueDocument(db, bzg, "bzg", "bzg@wolf-command.test", {
      date: "2026-08-01", source: "Manual", department_code: "ROOMS", account_code: "4010", amount: 1.234,
    }, now)).status, "invalid");
    assert.equal((await createRevenueDocument(db, bzg, "bzg", "bzg@wolf-command.test", {
      date: "2026-08-01", source: "Manual", department_code: "ROOMS", account_code: "4010", amount: 0,
    }, now)).status, "invalid");
    assert.equal((await createRevenueDocument(db, bzg, "bzg", "bzg@wolf-command.test", {
      date: "2026-08-01", source: "Manual", department_code: "ROOMS", account_code: "4010", amount: -1,
    }, now)).status, "invalid");
    assert.equal((await createRevenueDocument(db, bzg, "bzg", "bzg@wolf-command.test", {
      date: "2026-08-01", source: "Manual", department_code: "100", account_code: "4010", amount: 1,
    }, now)).status, "invalid");
    assert.equal((await createRevenueDocument(db, bzg, "bzg", "bzg@wolf-command.test", {
      date: "2026-08-01", source: "Manual", department_code: "CLOSED", account_code: "4010", amount: 1,
    }, now)).status, "invalid");
    assert.equal((await createRevenueDocument(db, bzg, "bzg", "bzg@wolf-command.test", {
      date: "2026-08-01", source: "Manual", department_code: "FOOD", account_code: "4010", amount: 1,
    }, now)).status, "invalid");
    assert.equal((await createSpendingDocument(db, bzg, "bzg", "bzg@wolf-command.test", {
      date: "2026-08-01", type: "Procurement", vendor_or_employee: "Vendor", department_code: "ROOMS", account_code: "4010", amount: 1,
    }, now)).status, "invalid");
    await db.update(financeMappingConfigurations).set({ spendingPayrollCreditAccount: "" }).where(eq(financeMappingConfigurations.companyId, "bzg"));
    assert.equal((await createSpendingDocument(db, bzg, "bzg", "bzg@wolf-command.test", {
      date: "2026-08-01", type: "Payroll", vendor_or_employee: "Vendor", department_code: "ROOMS", account_code: "5010", amount: 1, credit_account_code: "2010",
    }, now)).status, "invalid");
    await db.update(financeMappingConfigurations).set({ spendingPayrollCreditAccount: "1010" }).where(eq(financeMappingConfigurations.companyId, "bzg"));
    assert.deepEqual(await counts(db, "bzg"), unchanged);

    const linked = await deleteAtriumDraftJournal(db, bzgAdmin, "bzg", saved.draftJournal.journal_id, now);
    assert.equal(linked.status, "linked");
    assert.equal((await readRevenueDocuments(db, bzg, "bzg")).status, "ready");
    const stillThere = await db.select().from(atriumDraftJournals).where(and(eq(atriumDraftJournals.companyId, "bzg"), eq(atriumDraftJournals.journalId, saved.draftJournal.journal_id)));
    assert.equal(stillThere.length, 1);
    assert.equal((await deleteAtriumDraftJournal(db, ggvAdmin, "bzg", saved.draftJournal.journal_id, now)).status, "denied");
    const manual = await createAtriumDraftJournal(db, bzg, "bzg", "bzg@wolf-command.test", {
      header: { journal_date: "2026-08-02", period: "2026-08", source_type: "MANUAL", source_reference: "", created_by: "client" },
      lines: [
        { account_code: "1010", department_code: "ROOMS", debit: "1.00", credit: "0", description: "Manual" },
        { account_code: "4010", department_code: "ROOMS", debit: "0", credit: "1.00", description: "Manual" },
      ],
    }, now);
    assert.equal(manual.status, "saved");
    if (manual.status !== "saved") return;
    assert.equal((await deleteAtriumDraftJournal(db, bzgAdmin, "bzg", manual.journal.journal_id, now)).status, "deleted");

    await db.update(financeModules).set({ enabled: "N" }).where(and(eq(financeModules.companyId, "bzg"), eq(financeModules.moduleId, "hotel-operations")));
    assert.equal((await readRevenueDocuments(db, bzg, "bzg")).status, "denied");
    assert.equal((await createRevenueDocument(db, bzg, "bzg", "bzg@wolf-command.test", {
      date: "2026-08-01", source: "Manual", department_code: "ROOMS", account_code: "4010", amount: 1,
    }, now)).status, "denied");

    const laterRevenue = await readRevenueDocuments(db, ggv, "ggv");
    const laterSpending = await readSpendingDocuments(db, ggv, "ggv");
    if (laterRevenue.status !== "ready" || laterSpending.status !== "ready") return;
    assert.equal(laterRevenue.documents.length, 1);
    assert.equal(laterSpending.documents.length, 1);
    assert.equal(laterSpending.documents[0]?.date, "2024-02-29");
  });
});

test("a failed revenue or spending write leaves no document, journal, lines, or audit", async () => {
  await withDb(async (db) => {
    const operatorUser = await user(db, "operator@wolf-command.test");
    await db.insert(platformOperators).values({ userId: operatorUser.id, createdAt: now });
    const operator = actor(operatorUser.id, "amg", "administrator");
    assert.equal((await createCompany(db, operator, { companyId: "bzg", name: "BZG", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    await enableHotel(db, "bzg");
    const bzg = actor((await user(db, "bzg@wolf-command.test")).id, "bzg");
    for (const account of [cash, guest, revenue]) {
      assert.equal((await saveChartAccount(db, bzg, "bzg", account, now)).status, "saved");
    }
    assert.equal((await saveOperatingDepartment(db, bzg, "bzg", { department_code: "ROOMS", department_name: "Rooms", active: "Y" }, now)).status, "saved");
    assert.equal((await saveMappingConfiguration(db, bzg, "bzg", { revenue_default_debit_account: "1020" }, now)).status, "saved");
    const input = { date: "2026-08-01", source: "Manual", department_code: "ROOMS", account_code: "4010", amount: "1.00" };
    for (const fault of ["journal", "lines", "document", "audit", "constraint"] as const satisfies readonly CycleWriteFault[]) {
      const before = await counts(db, "bzg");
      await assert.rejects(() => createRevenueDocument(db, bzg, "bzg", "bzg@wolf-command.test", input, now, fault));
      assert.deepEqual(await counts(db, "bzg"), before);
    }
    const saved = await createRevenueDocument(db, bzg, "bzg", "bzg@wolf-command.test", input, now);
    assert.equal(saved.status, "saved");
  });
});

test("revenue and spending routes stay on the draft contract and copy nothing", () => {
  assert.equal(atriumCycleRoute("GET", "/api/revenue"), "revenue-list");
  assert.equal(atriumCycleRoute("POST", "/api/spending"), "spending-create");
  assert.equal(atriumCycleRoute("DELETE", "/api/revenue/rev_1"), "unavailable");
  assert.equal(atriumCycleRoute("POST", "/api/spending/spd_1/post"), "unavailable");
  assert.equal(atriumCycleRoute("GET", "/api/journals"), null);
  const migration = readFileSync(new URL("../db/migrations/0012_atrium_revenue_spending.sql", import.meta.url), "utf8").toLowerCase();
  assert.equal(migration.includes("insert into"), false);
  assert.equal(migration.includes("jrn-pms"), false);
  assert.equal(migration.includes("rev-pms"), false);
});
