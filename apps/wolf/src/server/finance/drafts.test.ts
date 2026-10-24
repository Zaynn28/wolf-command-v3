import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { withDb } from "../test/harness";
import { financeJournalLines, financeJournals, platformOperators, users } from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { createCompany } from "../admin/companies";
import { addFinanceAccount, addFinancePeriod, readFinanceWorkspace, saveDraftJournal } from "./drafts";

const now = new Date("2026-10-23T00:00:00.000Z");

async function user(db: AuthDatabase, email: string) {
  const row = (await db.insert(users).values({ emailNormalized: email, status: "active" }).returning())[0];
  if (!row) throw new Error("missing user");
  return row;
}

function actor(userId: string, companyId: string, role: "staff" | "administrator" = "staff"): Actor {
  return { userId, memberships: [{ companyId, departmentId: "finance", role }], grants: [] };
}

async function readyCompany(db: AuthDatabase, operator: Actor, companyId: string) {
  const created = await createCompany(
    db,
    operator,
    { companyId, name: companyId, currencyCode: "USD", minorScale: 2 },
    now,
  );
  assert.equal(created.status, "created");
  const admin = actor(operator.userId, companyId, "administrator");
  assert.equal((await addFinanceAccount(db, admin, { companyId, accountCode: "1000", accountName: "Cash" }, now)).status, "created");
  assert.equal((await addFinanceAccount(db, admin, { companyId, accountCode: "4000", accountName: "Revenue" }, now)).status, "created");
  assert.equal((await addFinancePeriod(db, admin, { companyId, periodKey: "2026-10" }, now)).status, "created");
}

test("draft journals stay inside the company and compare debits exactly", async () => {
  await withDb(async (db) => {
    const operatorUser = await user(db, "operator@wolf-command.test");
    await db.insert(platformOperators).values({ userId: operatorUser.id, createdAt: now });
    const operator = actor(operatorUser.id, "unused", "administrator");
    await readyCompany(db, operator, "company-a");
    await readyCompany(db, operator, "company-b");
    const staff = actor((await user(db, "staff@wolf-command.test")).id, "company-a");
    await db.insert(users).values({ emailNormalized: "ignored@wolf-command.test", status: "active" });
    const saved = await saveDraftJournal(
      db,
      staff,
      {
        companyId: "company-a",
        periodKey: "2026-10",
        memo: "opening",
        lines: [
          { accountCode: "1000", side: "debit", amount: "10.10" },
          { accountCode: "4000", side: "credit", amount: "10.10" },
        ],
      },
      now,
    );
    assert.equal(saved.status, "saved");
    if (saved.status !== "saved") return;
    assert.equal(saved.balanced, true);
    const edited = await saveDraftJournal(
      db,
      staff,
      {
        companyId: "company-a",
        journalId: saved.journalId,
        periodKey: "2026-10",
        memo: "revised",
        lines: [
          { accountCode: "1000", side: "debit", amount: "4.00" },
          { accountCode: "4000", side: "credit", amount: "4.00" },
        ],
      },
      now,
    );
    assert.equal(edited.status, "saved");
    if (edited.status !== "saved") return;
    assert.equal(edited.journalId, saved.journalId);
    const afterEdit = await readFinanceWorkspace(db, staff, "company-a");
    assert.equal(afterEdit.status, "ready");
    if (afterEdit.status !== "ready") return;
    assert.equal(afterEdit.journals.length, 1);
    assert.equal(afterEdit.journals[0]?.memo, "revised");
    assert.equal(afterEdit.journals[0]?.debit, "4.0000");
    const denied = await saveDraftJournal(
      db,
      staff,
      {
        companyId: "company-b",
        periodKey: "2026-10",
        memo: "other",
        lines: [
          { accountCode: "1000", side: "debit", amount: "1.00" },
          { accountCode: "4000", side: "credit", amount: "1.00" },
        ],
      },
      now,
    );
    assert.equal(denied.status, "denied");
    const other = await readFinanceWorkspace(db, staff, "company-b");
    assert.equal(other.status, "denied");
    const own = await readFinanceWorkspace(db, staff, "company-a");
    assert.equal(own.status, "ready");
    if (own.status !== "ready") return;
    assert.equal(own.journals.length, 1);
    const foreignLines = await db.select().from(financeJournalLines).where(eq(financeJournalLines.companyId, "company-b"));
    assert.equal(foreignLines.length, 0);
    const journals = await db.select().from(financeJournals).where(eq(financeJournals.companyId, "company-a"));
    assert.equal(journals[0]?.status, "draft");
  });
});

test("a BZG finance user cannot read or change GGV drafts", async () => {
  await withDb(async (db) => {
    const operatorUser = await user(db, "operator@wolf-command.test");
    await db.insert(platformOperators).values({ userId: operatorUser.id, createdAt: now });
    const operator = actor(operatorUser.id, "unused", "administrator");
    await readyCompany(db, operator, "bzg");
    await readyCompany(db, operator, "ggv");
    const bzgUser = await user(db, "bzg@wolf-command.test");
    const ggvUser = await user(db, "ggv@wolf-command.test");
    const bzg = actor(bzgUser.id, "bzg", "administrator");
    const ggv = actor(ggvUser.id, "ggv", "administrator");
    const saved = await saveDraftJournal(
      db,
      bzg,
      {
        companyId: "bzg",
        periodKey: "2026-10",
        memo: "bzg only",
        lines: [
          { accountCode: "1000", side: "debit", amount: "2.50" },
          { accountCode: "4000", side: "credit", amount: "2.50" },
        ],
      },
      now,
    );
    assert.equal(saved.status, "saved");
    const malformed = await saveDraftJournal(
      db,
      bzg,
      {
        companyId: "bzg",
        periodKey: "2026-10",
        memo: "bad",
        lines: [
          { accountCode: "1000", side: "debit", amount: "1e2" },
          { accountCode: "4000", side: "credit", amount: "1e2" },
        ],
      },
      now,
    );
    assert.equal(malformed.status, "invalid");
    assert.equal((await readFinanceWorkspace(db, ggv, "bzg")).status, "denied");
    assert.equal((await readFinanceWorkspace(db, bzg, "ggv")).status, "denied");
    if (saved.status !== "saved") return;
    const edited = await saveDraftJournal(
      db,
      ggv,
      {
        companyId: "bzg",
        journalId: saved.journalId,
        periodKey: "2026-10",
        memo: "taken",
        lines: [
          { accountCode: "1000", side: "debit", amount: "2.50" },
          { accountCode: "4000", side: "credit", amount: "2.50" },
        ],
      },
      now,
    );
    assert.equal(edited.status, "denied");
    const bzgBooks = await readFinanceWorkspace(db, bzg, "bzg");
    assert.equal(bzgBooks.status, "ready");
    if (bzgBooks.status !== "ready") return;
    assert.equal(bzgBooks.journals.length, 1);
    assert.equal(bzgBooks.journals[0]?.memo, "bzg only");
    const ggvBooks = await readFinanceWorkspace(db, ggv, "ggv");
    assert.equal(ggvBooks.status, "ready");
    if (ggvBooks.status !== "ready") return;
    assert.equal(ggvBooks.journals.length, 0);
  });
});

test("a company membership cannot create a company", async () => {
  await withDb(async (db) => {
    const person = await user(db, "member@wolf-command.test");
    const member = actor(person.id, "company-a", "administrator");
    const denied = await createCompany(db, member, { companyId: "company-a", name: "A", currencyCode: "IDR", minorScale: 0 }, now);
    assert.equal(denied.status, "denied");
  });
});
