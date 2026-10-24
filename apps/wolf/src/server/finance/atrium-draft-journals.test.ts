import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { withDb } from "../test/harness";
import {
  atriumDraftJournalLines,
  atriumDraftJournals,
  financeAccounts,
  financeJournalLines,
  financeJournals,
  financeModules,
  financePeriods,
  platformOperators,
  users,
} from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { createCompany } from "../admin/companies";
import { saveChartAccount, type ChartAccount } from "./chart-accounts";
import { saveOperatingDepartment } from "./operating-departments";
import {
  atriumJournalRoute,
  createAtriumDraftJournal,
  deleteAtriumDraftJournal,
  journalLifecycleUnavailable,
  readAtriumDraftJournal,
  readAtriumDraftJournals,
} from "./atrium-draft-journals";

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

const revenue: ChartAccount = {
  account_code: "4010",
  account_name: "Rooms",
  account_type: "Revenue",
  normal_balance: "Credit",
  statutory_line: "Revenue",
  usali_line: "Rooms",
  active: "Y",
};

function draft(lines: { account_code: string; department_code?: string; debit: string; credit: string }[], date = "2026-10-23") {
  return {
    header: { journal_date: date, period: date.slice(0, 7), source_type: "MANUAL", source_reference: "Manual Adjustment Voucher", created_by: "client-supplied" },
    lines: lines.map((line) => ({ ...line, description: "Line" })),
  };
}

async function user(db: AuthDatabase, email: string) {
  const row = (await db.insert(users).values({ emailNormalized: email, status: "active" }).returning())[0];
  if (!row) throw new Error("missing user");
  return row;
}

function actor(userId: string, companyId: string, role: "staff" | "administrator" = "staff"): Actor {
  return { userId, memberships: [{ companyId, departmentId: "finance", role }], grants: [] };
}

test("Atrium draft journals stay in the company, reject inexact amounts, and ignore the legacy draft ledger", async () => {
  await withDb(async (db) => {
    const operatorUser = await user(db, "operator@wolf-command.test");
    await db.insert(platformOperators).values({ userId: operatorUser.id, createdAt: now });
    const operator = actor(operatorUser.id, "amg", "administrator");
    assert.equal((await createCompany(db, operator, { companyId: "amg", name: "AMG", currencyCode: "IDR", minorScale: 0, workspaceKind: "amg" }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "bzg", name: "BZG", currencyCode: "USD", minorScale: 2 }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "ggv", name: "GGV", currencyCode: "USD", minorScale: 2 }, now)).status, "created");
    const bzgUser = await user(db, "bzg@wolf-command.test");
    const bzg = actor(bzgUser.id, "bzg");
    const bzgAdmin = actor(bzgUser.id, "bzg", "administrator");
    const ggv = actor((await user(db, "ggv@wolf-command.test")).id, "ggv");
    const amg = actor((await user(db, "amg@wolf-command.test")).id, "amg");

    assert.equal((await saveChartAccount(db, bzg, "bzg", cash, now)).status, "saved");
    assert.equal((await saveChartAccount(db, bzg, "bzg", revenue, now)).status, "saved");
    assert.equal((await saveChartAccount(db, ggv, "ggv", cash, now)).status, "saved");
    assert.equal((await saveChartAccount(db, amg, "amg", cash, now)).status, "saved");
    assert.equal((await saveOperatingDepartment(db, bzg, "bzg", { department_code: "ROOMS", department_name: "Rooms", active: "Y" }, now)).status, "saved");
    assert.equal((await saveOperatingDepartment(db, ggv, "ggv", { department_code: "FOOD", department_name: "Food", active: "Y" }, now)).status, "saved");

    const empty = await readAtriumDraftJournals(db, bzg, "bzg");
    assert.equal(empty.status, "ready");
    if (empty.status !== "ready") return;
    assert.deepEqual(empty.journals, []);

    await db.insert(financePeriods).values({ companyId: "bzg", periodKey: "2026-10", createdAt: now });
    await db.insert(financeAccounts).values({ companyId: "bzg", accountCode: "1000", accountName: "Legacy cash", active: "Y", createdAt: now });
    await db.insert(financeAccounts).values({ companyId: "bzg", accountCode: "4000", accountName: "Legacy revenue", active: "Y", createdAt: now });
    await db.insert(financeJournals).values({ companyId: "bzg", id: "jnl_legacy", periodKey: "2026-10", memo: "legacy", status: "draft", createdBy: bzgUser.id, createdAt: now });
    await db.insert(financeJournalLines).values([
      { companyId: "bzg", journalId: "jnl_legacy", lineNo: 1, accountCode: "1000", debit: "1.0000", credit: "0.0000" },
      { companyId: "bzg", journalId: "jnl_legacy", lineNo: 2, accountCode: "4000", debit: "0.0000", credit: "1.0000" },
    ]);
    const stillEmpty = await readAtriumDraftJournals(db, bzg, "bzg");
    if (stillEmpty.status !== "ready") return;
    assert.equal(stillEmpty.journals.length, 0);

    const saved = await createAtriumDraftJournal(
      db,
      bzg,
      "bzg",
      "bzg@wolf-command.test",
      draft([
        { account_code: "1010", department_code: "ROOMS", debit: "10.10", credit: "0.00" },
        { account_code: "4010", department_code: "ROOMS", debit: "0.00", credit: "0.20" },
        { account_code: "4010", debit: "0", credit: "9.90" },
      ]),
      now,
    );
    assert.equal(saved.status, "saved");
    if (saved.status !== "saved") return;
    assert.equal(saved.journal.status, "DRAFT");
    assert.equal(saved.journal.created_by, "bzg@wolf-command.test");
    assert.equal(saved.journal.approved_by, "");
    assert.equal(saved.journal.posted_at, "");
    assert.equal(saved.journal.reversal_of, "");
    assert.equal(saved.journal.total_debit, 10.1);
    assert.equal(saved.journal.total_credit, 10.1);
    assert.equal(saved.journal.is_balanced, true);
    assert.equal(saved.journal.lines[0]?.line_number, 1);
    assert.equal(saved.journal.lines[2]?.department_code, "");

    const later = await readAtriumDraftJournal(db, bzg, "bzg", saved.journal.journal_id);
    assert.equal(later.status, "ready");
    if (later.status !== "ready") return;
    assert.equal(later.journal.is_balanced, true);
    assert.equal((await readAtriumDraftJournals(db, bzg, "ggv")).status, "denied");
    assert.equal((await readAtriumDraftJournals(db, ggv, "bzg")).status, "denied");
    assert.equal((await readAtriumDraftJournal(db, ggv, "bzg", saved.journal.journal_id)).status, "denied");
    assert.equal((await createAtriumDraftJournal(db, ggv, "bzg", "ggv@wolf-command.test", draft([{ account_code: "1010", debit: "1.00", credit: "0" }, { account_code: "4010", debit: "0", credit: "1.00" }]), now)).status, "denied");
    assert.equal((await deleteAtriumDraftJournal(db, ggv, "bzg", saved.journal.journal_id, now)).status, "denied");
    assert.equal((await deleteAtriumDraftJournal(db, bzg, "bzg", saved.journal.journal_id, now)).status, "denied");

    const wrongAccount = await createAtriumDraftJournal(
      db,
      bzg,
      "bzg",
      "bzg@wolf-command.test",
      draft([{ account_code: "9999", debit: "1.00", credit: "0" }, { account_code: "4010", debit: "0", credit: "1.00" }]),
      now,
    );
    assert.equal(wrongAccount.status, "invalid");
    const otherCompanyAccount = await createAtriumDraftJournal(
      db,
      amg,
      "amg",
      "amg@wolf-command.test",
      draft([{ account_code: "4010", debit: "1.00", credit: "0" }, { account_code: "1010", debit: "0", credit: "1.00" }]),
      now,
    );
    assert.equal(otherCompanyAccount.status, "invalid");
    const otherDepartment = await createAtriumDraftJournal(
      db,
      bzg,
      "bzg",
      "bzg@wolf-command.test",
      draft([
        { account_code: "1010", department_code: "FOOD", debit: "1.00", credit: "0" },
        { account_code: "4010", debit: "0", credit: "1.00" },
      ]),
      now,
    );
    assert.equal(otherDepartment.status, "invalid");
    const excess = await createAtriumDraftJournal(
      db,
      bzg,
      "bzg",
      "bzg@wolf-command.test",
      draft([{ account_code: "1010", debit: "1.234", credit: "0" }, { account_code: "4010", debit: "0", credit: "1.23" }]),
      now,
    );
    assert.equal(excess.status, "invalid");
    const badDate = await createAtriumDraftJournal(
      db,
      bzg,
      "bzg",
      "bzg@wolf-command.test",
      draft([{ account_code: "1010", debit: "1.00", credit: "0" }, { account_code: "4010", debit: "0", credit: "1.00" }], "2026-02-31"),
      now,
    );
    assert.equal(badDate.status, "invalid");
    assert.equal((await db.select().from(atriumDraftJournals).where(eq(atriumDraftJournals.companyId, "bzg"))).length, 1);
    assert.equal((await db.select().from(atriumDraftJournalLines).where(eq(atriumDraftJournalLines.companyId, "bzg"))).length, 3);

    const removed = await deleteAtriumDraftJournal(db, bzgAdmin, "bzg", saved.journal.journal_id, now);
    assert.equal(removed.status, "deleted");
    assert.equal((await readAtriumDraftJournal(db, bzg, "bzg", saved.journal.journal_id)).status, "missing");
    assert.equal((await db.select().from(atriumDraftJournalLines).where(eq(atriumDraftJournalLines.companyId, "bzg"))).length, 0);
    assert.equal((await db.select().from(financeJournals)).length, 1);

    await db.update(financeModules).set({ enabled: "N" }).where(eq(financeModules.moduleId, "accounting-core"));
    assert.equal((await readAtriumDraftJournals(db, bzg, "bzg")).status, "denied");
    assert.equal((await createAtriumDraftJournal(db, bzg, "bzg", "bzg@wolf-command.test", draft([{ account_code: "1010", debit: "1.00", credit: "0" }, { account_code: "4010", debit: "0", credit: "1.00" }]), now)).status, "denied");
  });
});

test("journal lifecycle routes stay unavailable and the migration copies nothing", () => {
  assert.equal(atriumJournalRoute("GET", "/api/journals"), "list");
  assert.equal(atriumJournalRoute("POST", "/api/journals"), "create");
  assert.equal(atriumJournalRoute("GET", "/api/journals/jrn_11111111-1111-1111-1111-111111111111"), "read");
  assert.equal(atriumJournalRoute("DELETE", "/api/journals/jrn_11111111-1111-1111-1111-111111111111"), "remove");
  assert.equal(atriumJournalRoute("POST", "/api/journals/jrn_11111111-1111-1111-1111-111111111111/validate"), "unavailable");
  assert.equal(atriumJournalRoute("POST", "/api/journals/jrn_11111111-1111-1111-1111-111111111111/approve"), "unavailable");
  assert.equal(atriumJournalRoute("POST", "/api/journals/jrn_11111111-1111-1111-1111-111111111111/post"), "unavailable");
  assert.equal(atriumJournalRoute("POST", "/api/journals/jrn_11111111-1111-1111-1111-111111111111/reverse"), "unavailable");
  assert.equal(journalLifecycleUnavailable.includes("not available"), true);
  const migration = readFileSync(new URL("../db/migrations/0011_atrium_draft_journals.sql", import.meta.url), "utf8").toLowerCase();
  assert.equal(migration.includes("insert into"), false);
  assert.equal(migration.includes("jrn-pms"), false);
  assert.equal(migration.includes("alter table finance_journals"), false);
  assert.equal(migration.includes("references finance_accounts"), false);
});
