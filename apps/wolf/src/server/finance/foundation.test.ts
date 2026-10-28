import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { createCompany } from "../admin/companies";
import { platformOperators, users } from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { withDb } from "../test/harness";
import { convertToBase, lookupTaxRate, postConfiguredEvent, recordStockMovement, savePostingRule, saveTaxRate, saveUomConversion, stockBalance } from "./foundation";

const now = new Date("2026-10-26T00:00:00.000Z");

async function ready(db: AuthDatabase) {
  const operatorUser = (await db.insert(users).values({ emailNormalized: "operator@wolf-command.test", status: "active" }).returning())[0];
  if (!operatorUser) throw new Error("missing user");
  await db.insert(platformOperators).values({ userId: operatorUser.id, createdAt: now });
  const operator: Actor = { userId: operatorUser.id, memberships: [], grants: [] };
  assert.equal((await createCompany(db, operator, { companyId: "bzg", name: "BZG", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
  const admin: Actor = { userId: operatorUser.id, memberships: [{ companyId: "bzg", departmentId: "finance", role: "administrator" }], grants: [] };
  return admin;
}

test("BZG finance configuration stays empty until an operator saves it, and a configured posting rule balances", async () => {
  await withDb(async (db) => {
    const admin = await ready(db);
    assert.equal((await lookupTaxRate(db, admin, { companyId: "bzg", taxType: "PB1", onDate: "2026-10-26" })).status, "none");
    assert.equal((await convertToBase(db, admin, { companyId: "bzg", itemCode: "ITEM", fromUom: "kg", toUom: "g", quantity: 1n, onDate: "2026-10-26" })).status, "missing");
    assert.equal((await postConfiguredEvent(db, admin, { companyId: "bzg", eventCode: "cogs", categoryCode: "food", documentRef: "doc-1", internalAmount: 205714300n }, now)).status, "unconfigured");

    assert.equal((await saveTaxRate(db, admin, { companyId: "bzg", taxType: "SERVICE", ratePpm: 50_000, priceMode: "exclusive", effectiveFrom: "2026-01-01" }, now)).status, "saved");
    const tax = await lookupTaxRate(db, admin, { companyId: "bzg", taxType: "SERVICE", onDate: "2026-10-26" });
    assert.equal(tax.status, "ready");
    if (tax.status !== "ready") return;
    assert.equal(tax.ratePpm, 50_000);

    assert.equal((await saveUomConversion(db, admin, { companyId: "bzg", itemCode: "ITEM", fromUom: "kg", toUom: "g", factorPpm: 1_000_000_000n, effectiveFrom: "2026-01-01" }, now)).status, "saved");
    const converted = await convertToBase(db, admin, { companyId: "bzg", itemCode: "ITEM", fromUom: "kg", toUom: "g", quantity: 1n, onDate: "2026-10-26" });
    assert.equal(converted.status, "ready");
    if (converted.status !== "ready") return;
    assert.equal(converted.baseQty, 1000n);

    const movement = await recordStockMovement(db, admin, {
      companyId: "bzg",
      outletId: "outlet",
      locationId: "store",
      itemCode: "ITEM",
      qtyInBase: 10n,
      qtyOutBase: 0n,
      unitCostInternal: 32000n,
      documentRef: "receipt-1",
    }, now);
    assert.equal(movement.status, "saved");
    const balance = await stockBalance(db, admin, { companyId: "bzg", itemCode: "ITEM", locationId: "store" });
    assert.equal(balance.status, "ready");
    if (balance.status !== "ready") return;
    assert.equal(balance.qtyBase, 10n);
    await assert.rejects(() => db.execute(sql`delete from finance_stock_ledger where company_id = 'bzg'`));

    assert.equal((await savePostingRule(db, admin, { companyId: "bzg", eventCode: "cogs", categoryCode: "food", debitAccountCode: "5000", creditAccountCode: "1400" }, now)).status, "saved");
    const posted = await postConfiguredEvent(db, admin, { companyId: "bzg", eventCode: "cogs", categoryCode: "food", documentRef: "doc-1", internalAmount: 205714300n }, now);
    assert.equal(posted.status, "posted");
    if (posted.status !== "posted") return;
    assert.equal(posted.amount, 20571n);
    const again = await postConfiguredEvent(db, admin, { companyId: "bzg", eventCode: "cogs", categoryCode: "food", documentRef: "doc-1", internalAmount: 205714300n }, now);
    assert.equal(again.status, "posted");
    if (again.status !== "posted") return;
    assert.equal(again.journalId, posted.journalId);
  });
});
