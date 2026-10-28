import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { withDb } from "../test/harness";
import { atriumDraftJournalLines, atriumDraftJournals, financeJournals, financeMappingConfigurations, platformOperators, users } from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { createCompany } from "../admin/companies";
import { saveChartAccount, type ChartAccount } from "./chart-accounts";
import { amgTransactionJournalId, importAmgTransactions, type AbsTransactionRow } from "./import-amg-transactions";

const now = new Date("2026-10-26T02:30:00.000Z");

function account(code: string, name: string, type: ChartAccount["account_type"], balance: ChartAccount["normal_balance"]): ChartAccount {
  return { account_code: code, account_name: name, account_type: type, normal_balance: balance, statutory_line: "", usali_line: "", active: "Y" };
}

function row(overrides: Partial<AbsTransactionRow> = {}): AbsTransactionRow {
  return {
    absId: "absTestId",
    fileStamp: "2026-10-26_02_28_49",
    excelRow: 2,
    reservation: "5-1",
    folio: "7",
    invoice: "60",
    room: "112",
    charge: "Room Charges",
    extraChargeType: "",
    marketSegment: "OTA(Online Travel Agent)",
    settlementParticular: "",
    reference: "",
    transactionDate: "2026-10-07",
    quantity: "",
    netAmount: "520000",
    discountAmount: "0",
    taxableAmount: "520000",
    grossAmount: "520000",
    settlementAmount: "",
    folioStatus: "Close",
    ...overrides,
  };
}

async function user(db: AuthDatabase, email: string) {
  const created = (await db.insert(users).values({ emailNormalized: email, status: "active" }).returning())[0];
  if (!created) throw new Error("missing user");
  return created;
}

function actor(userId: string): Actor {
  return { userId, memberships: [{ companyId: "amg", departmentId: null, role: "administrator" }], grants: [] };
}

test("AMG ABS drafts stay on AMG, skip unmapped rows, and do not duplicate", async () => {
  await withDb(async (db) => {
    const operator = await user(db, "operator@wolf-command.test");
    await db.insert(platformOperators).values({ userId: operator.id, createdAt: now });
    const amg = actor(operator.id);
    assert.equal((await createCompany(db, amg, { companyId: "amg", name: "AMG", currencyCode: "IDR", minorScale: 0, workspaceKind: "amg" }, now)).status, "created");
    assert.equal((await createCompany(db, amg, { companyId: "bzg", name: "BZG", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    for (const chart of [
      account("1010", "Cash - Operating Bank Account", "Asset", "Debit"),
      account("1020", "Cash in Transit / Guest Ledger Clearing", "Asset", "Debit"),
      account("4010", "Rooms Revenue - Transient", "Revenue", "Credit"),
      account("4020", "Rooms Revenue - Group & Corporate", "Revenue", "Credit"),
      account("4110", "Food Revenue - Restaurants & Outlets", "Revenue", "Credit"),
    ]) {
      assert.equal((await saveChartAccount(db, amg, "amg", chart, now)).status, "saved");
    }

    const rows = [
      row(),
      row({ excelRow: 3, marketSegment: "Group - Leisure", grossAmount: "400000" }),
      row({ excelRow: 4, charge: "Breakfast (UMA BLU)", marketSegment: "OTA(Online Travel Agent)", grossAmount: "50000" }),
      row({ excelRow: 5, charge: "N/A", grossAmount: "0", settlementParticular: "Cash", settlementAmount: "-250000" }),
      row({ excelRow: 6, charge: "N/A", grossAmount: "0", settlementParticular: "Bank Transfer", settlementAmount: "-4900000" }),
      row({ excelRow: 7, marketSegment: "Owner unit", grossAmount: "200000" }),
      row({ excelRow: 8, charge: "UMA BLU", grossAmount: "210000" }),
      row({ excelRow: 9, charge: "N/A", grossAmount: "0", settlementParticular: "Credit Card", settlementAmount: "-4050000" }),
      row({ excelRow: 10, grossAmount: "0", folioStatus: "Void" }),
      row({ excelRow: 11, grossAmount: "0", charge: "Cancellation Revenue" }),
      row({ excelRow: 12 }),
      row({ excelRow: 13, transactionDate: "2026-08-31", fileStamp: "2026-10-26_02_28_14", grossAmount: "10.50" }),
    ];

    const refused = await importAmgTransactions(db, { companyId: "bzg", userId: operator.id, createdBy: operator.emailNormalized, rows }, now);
    assert.equal(refused.status, "refused");
    assert.equal((await db.select().from(atriumDraftJournals)).length, 0);

    const imported = await importAmgTransactions(db, { companyId: "amg", userId: operator.id, createdBy: operator.emailNormalized, rows }, now);
    assert.equal(imported.status, "imported");
    assert.equal(imported.loaded, 5);
    assert.equal(imported.alreadyLoaded, 0);
    assert.equal(imported.loadedAmount, "6120000");
    assert.equal(imported.skipReasons.duplicate, 1);
    assert.equal(imported.skipReasons["unmapped_charge:UMA BLU"], 1);
    assert.equal(imported.skipReasons["unmapped_charge:Room Charges"], 1);
    assert.equal(imported.skipReasons["unmapped_settlement:Credit Card"], 1);
    assert.equal(imported.skipReasons.void, 1);
    assert.equal(imported.skipReasons.zero_amount, 1);
    assert.equal(imported.skipReasons.invalid_amount, 1);
    assert.equal(imported.debitByAccount["1020"], "970000");
    assert.equal(imported.debitByAccount["1010"], "5150000");
    assert.equal(imported.creditByAccount["4010"], "520000");
    assert.equal(imported.creditByAccount["4020"], "400000");
    assert.equal(imported.creditByAccount["4110"], "50000");
    assert.equal(imported.creditByAccount["1020"], "5150000");

    const journals = await db.select().from(atriumDraftJournals).where(eq(atriumDraftJournals.companyId, "amg"));
    assert.equal(journals.length, 5);
    assert.equal(journals.every((journal) => journal.status === "DRAFT"), true);
    assert.equal(journals.every((journal) => journal.companyId === "amg"), true);
    const room = journals.find((journal) => journal.sourceReference.endsWith("|r2"));
    assert.ok(room);
    assert.equal(room?.journalId, amgTransactionJournalId(room?.sourceReference ?? ""));
    assert.equal(room?.sourceType, "REVENUE");
    const lines = await db.select().from(atriumDraftJournalLines).where(eq(atriumDraftJournalLines.journalId, room?.journalId ?? ""));
    assert.deepEqual(
      lines.map((line) => [line.lineNo, line.accountCode, line.debit, line.credit, line.departmentCode]),
      [
        [1, "1020", "520000.00", "0.00", null],
        [2, "4010", "0.00", "520000.00", null],
      ],
    );
    assert.equal(lines.some((line) => /guest|card|@/i.test(line.description)), false);

    const again = await importAmgTransactions(db, { companyId: "amg", userId: operator.id, createdBy: operator.emailNormalized, rows }, now);
    assert.equal(again.loaded, 0);
    assert.equal(again.alreadyLoaded, 5);
    assert.equal((await db.select().from(atriumDraftJournals)).length, 5);
    assert.equal((await db.select().from(financeJournals)).length, 0);
    assert.equal((await db.select().from(financeMappingConfigurations)).length, 0);
    assert.equal((await db.select().from(atriumDraftJournals).where(eq(atriumDraftJournals.companyId, "bzg"))).length, 0);
  });
});
