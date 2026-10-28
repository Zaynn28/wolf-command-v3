import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { evaluateModuleAccess } from "../access/matrix";
import { writeAudit } from "../auth/audit";
import type { AuthDatabase } from "../db/types";
import { roundDocumentTotal, type RoundingMode } from "./money";

type Denied = { status: "denied" };
type Invalid = { status: "invalid"; reason: string };

function financeAllowed(actor: Actor, companyId: string, action: "read" | "create" | "update"): boolean {
  return evaluateModuleAccess(actor, "finance", action, { companyId, departmentId: null }).outcome === "allow";
}

function rowsOf<T>(result: T[] | { rows: T[] }): T[] {
  return Array.isArray(result) ? result : result.rows;
}

export async function saveOutlet(
  db: AuthDatabase,
  actor: Actor,
  input: { companyId: string; outletCode: string; outletName: string },
  now: Date,
): Promise<{ status: "saved"; outletId: string } | Denied | Invalid> {
  if (!financeAllowed(actor, input.companyId, "create")) return { status: "denied" };
  const outletCode = input.outletCode.trim().toUpperCase();
  const outletName = input.outletName.trim();
  if (!/^[A-Z0-9][A-Z0-9-]{0,30}$/.test(outletCode)) return { status: "invalid", reason: "Outlet code must be letters, numbers, and hyphens." };
  if (outletName.length < 1 || outletName.length > 120) return { status: "invalid", reason: "Outlet name is required." };
  const outletId = randomUUID();
  await db.execute(sql`
    insert into finance_outlets (company_id, outlet_id, outlet_code, outlet_name, active, created_at)
    values (${input.companyId}, ${outletId}, ${outletCode}, ${outletName}, 'Y', ${now})
  `);
  await writeAudit(db, {
    eventType: "authorization_allowed",
    userId: actor.userId,
    companyId: input.companyId,
    resourceType: "finance_outlet",
    resourceId: outletId,
    emailFingerprint: null,
    ip: null,
    metadata: { module: "finance", action: "outlet_saved" },
    createdAt: now,
  });
  return { status: "saved", outletId };
}

export async function saveTaxRate(
  db: AuthDatabase,
  actor: Actor,
  input: {
    companyId: string;
    outletId?: string | null;
    taxType: string;
    ratePpm: number;
    priceMode: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
  },
  now: Date,
): Promise<{ status: "saved"; rateId: string } | Denied | Invalid> {
  if (!financeAllowed(actor, input.companyId, "create")) return { status: "denied" };
  if (!["PB1", "PPN", "SERVICE", "PPh"].includes(input.taxType)) return { status: "invalid", reason: "Tax type must be PB1, PPN, SERVICE, or PPh." };
  if (!Number.isInteger(input.ratePpm) || input.ratePpm < 0 || input.ratePpm > 1_000_000) {
    return { status: "invalid", reason: "Tax rate must be a whole number of parts per million." };
  }
  if (input.priceMode !== "exclusive" && input.priceMode !== "inclusive") return { status: "invalid", reason: "Price mode must be exclusive or inclusive." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) return { status: "invalid", reason: "Effective date is required." };
  const rateId = randomUUID();
  await db.execute(sql`
    insert into finance_tax_rates (company_id, rate_id, outlet_id, tax_type, rate_ppm, price_mode, effective_from, effective_to, created_at)
    values (
      ${input.companyId},
      ${rateId},
      ${input.outletId ?? null},
      ${input.taxType},
      ${input.ratePpm},
      ${input.priceMode},
      ${input.effectiveFrom},
      ${input.effectiveTo ?? null},
      ${now}
    )
  `);
  await writeAudit(db, {
    eventType: "authorization_allowed",
    userId: actor.userId,
    companyId: input.companyId,
    resourceType: "finance_tax_rate",
    resourceId: rateId,
    emailFingerprint: null,
    ip: null,
    metadata: { module: "finance", action: "tax_rate_saved" },
    createdAt: now,
  });
  return { status: "saved", rateId };
}

export async function lookupTaxRate(
  db: AuthDatabase,
  actor: Actor,
  input: { companyId: string; taxType: string; onDate: string; outletId?: string | null },
): Promise<{ status: "none" } | { status: "ready"; ratePpm: number; priceMode: string } | Denied> {
  if (!financeAllowed(actor, input.companyId, "read")) return { status: "denied" };
  const result = await db.execute<{ rate_ppm: number; price_mode: string; outlet_id: string | null }>(sql`
    select rate_ppm, price_mode, outlet_id
    from finance_tax_rates
    where company_id = ${input.companyId}
      and tax_type = ${input.taxType}
      and effective_from <= ${input.onDate}::date
      and (effective_to is null or effective_to >= ${input.onDate}::date)
      and (outlet_id is null or outlet_id = ${input.outletId ?? null})
    order by effective_from desc
  `);
  const rows = rowsOf(result);
  const specific = rows.find((row) => row.outlet_id && row.outlet_id === input.outletId);
  const chosen = specific ?? rows.find((row) => row.outlet_id === null) ?? rows[0];
  if (!chosen) return { status: "none" };
  return { status: "ready", ratePpm: Number(chosen.rate_ppm), priceMode: chosen.price_mode };
}

export async function saveUomConversion(
  db: AuthDatabase,
  actor: Actor,
  input: { companyId: string; itemCode: string; fromUom: string; toUom: "g" | "ml" | "pcs"; factorPpm: bigint; effectiveFrom: string },
  now: Date,
): Promise<{ status: "saved" } | Denied | Invalid> {
  if (!financeAllowed(actor, input.companyId, "create")) return { status: "denied" };
  if (input.factorPpm <= 0n) return { status: "invalid", reason: "A conversion needs a factor." };
  await db.execute(sql`
    insert into finance_uom_conversions (company_id, item_code, from_uom, to_uom, factor_ppm, effective_from)
    values (${input.companyId}, ${input.itemCode}, ${input.fromUom}, ${input.toUom}, ${input.factorPpm.toString()}::bigint, ${input.effectiveFrom}::date)
  `);
  await writeAudit(db, {
    eventType: "authorization_allowed",
    userId: actor.userId,
    companyId: input.companyId,
    resourceType: "finance_uom",
    resourceId: input.itemCode,
    emailFingerprint: null,
    ip: null,
    metadata: { module: "finance", action: "uom_saved" },
    createdAt: now,
  });
  return { status: "saved" };
}

export async function convertToBase(
  db: AuthDatabase,
  actor: Actor,
  input: { companyId: string; itemCode: string; fromUom: string; toUom: "g" | "ml" | "pcs"; quantity: bigint; onDate: string },
): Promise<{ status: "ready"; baseQty: bigint } | { status: "missing" } | Denied | Invalid> {
  if (!financeAllowed(actor, input.companyId, "read")) return { status: "denied" };
  if (input.fromUom === input.toUom) return { status: "ready", baseQty: input.quantity };
  const result = await db.execute<{ factor_ppm: string }>(sql`
    select factor_ppm
    from finance_uom_conversions
    where company_id = ${input.companyId}
      and item_code = ${input.itemCode}
      and from_uom = ${input.fromUom}
      and to_uom = ${input.toUom}
      and effective_from <= ${input.onDate}::date
    order by effective_from desc
    limit 1
  `);
  const row = rowsOf(result)[0];
  if (!row) return { status: "missing" };
  const factor = BigInt(row.factor_ppm);
  return { status: "ready", baseQty: (input.quantity * factor) / 1_000_000n };
}

export async function recordStockMovement(
  db: AuthDatabase,
  actor: Actor,
  input: {
    companyId: string;
    outletId: string;
    locationId: string;
    itemCode: string;
    qtyInBase: bigint;
    qtyOutBase: bigint;
    unitCostInternal: bigint;
    documentRef: string;
  },
  now: Date,
): Promise<{ status: "saved"; entryId: string } | Denied | Invalid> {
  if (!financeAllowed(actor, input.companyId, "create")) return { status: "denied" };
  if (input.qtyInBase < 0n || input.qtyOutBase < 0n || (input.qtyInBase === 0n && input.qtyOutBase === 0n) || (input.qtyInBase > 0n && input.qtyOutBase > 0n)) {
    return { status: "invalid", reason: "A stock row records quantity in or quantity out." };
  }
  const entryId = randomUUID();
  await db.execute(sql`
    insert into finance_stock_ledger (
      company_id, entry_id, outlet_id, location_id, item_code, qty_in_base, qty_out_base, unit_cost_internal, document_ref, created_by, created_at
    ) values (
      ${input.companyId}, ${entryId}, ${input.outletId}, ${input.locationId}, ${input.itemCode},
      ${input.qtyInBase.toString()}::bigint, ${input.qtyOutBase.toString()}::bigint, ${input.unitCostInternal.toString()}::bigint,
      ${input.documentRef}, ${actor.userId}, ${now}
    )
  `);
  return { status: "saved", entryId };
}

export async function stockBalance(
  db: AuthDatabase,
  actor: Actor,
  input: { companyId: string; itemCode: string; locationId: string },
): Promise<{ status: "ready"; qtyBase: bigint } | Denied> {
  if (!financeAllowed(actor, input.companyId, "read")) return { status: "denied" };
  const result = await db.execute<{ qty: string }>(sql`
    select coalesce(sum(qty_in_base - qty_out_base), 0)::text as qty
    from finance_stock_ledger
    where company_id = ${input.companyId} and item_code = ${input.itemCode} and location_id = ${input.locationId}
  `);
  return { status: "ready", qtyBase: BigInt(rowsOf(result)[0]?.qty ?? "0") };
}

export async function savePostingRule(
  db: AuthDatabase,
  actor: Actor,
  input: { companyId: string; eventCode: string; categoryCode: string; outletId?: string | null; debitAccountCode: string; creditAccountCode: string },
  now: Date,
): Promise<{ status: "saved"; ruleId: string } | Denied | Invalid> {
  if (!financeAllowed(actor, input.companyId, "create")) return { status: "denied" };
  const debit = input.debitAccountCode.trim();
  const credit = input.creditAccountCode.trim();
  if (!debit || !credit || debit === credit) return { status: "invalid", reason: "A posting rule needs two different account codes." };
  const ruleId = randomUUID();
  await db.execute(sql`
    insert into finance_posting_rules (company_id, rule_id, event_code, category_code, outlet_id, debit_account_code, credit_account_code)
    values (${input.companyId}, ${ruleId}, ${input.eventCode}, ${input.categoryCode}, ${input.outletId ?? null}, ${debit}, ${credit})
  `);
  await writeAudit(db, {
    eventType: "authorization_allowed",
    userId: actor.userId,
    companyId: input.companyId,
    resourceType: "finance_posting_rule",
    resourceId: ruleId,
    emailFingerprint: null,
    ip: null,
    metadata: { module: "finance", action: "posting_rule_saved" },
    createdAt: now,
  });
  return { status: "saved", ruleId };
}

export async function postConfiguredEvent(
  db: AuthDatabase,
  actor: Actor,
  input: {
    companyId: string;
    eventCode: string;
    categoryCode: string;
    outletId?: string | null;
    documentRef: string;
    internalAmount: bigint;
    roundingMode?: RoundingMode;
  },
  now: Date,
): Promise<{ status: "posted"; journalId: string; amount: bigint } | { status: "unconfigured" } | Denied | Invalid> {
  if (!financeAllowed(actor, input.companyId, "create")) return { status: "denied" };
  const existing = await db.execute<{ journal_id: string; debit_units: string }>(sql`
    select journal_id, debit_units::text
    from finance_rule_journals
    where company_id = ${input.companyId} and document_ref = ${input.documentRef}
    limit 1
  `);
  const prior = rowsOf(existing)[0];
  if (prior) return { status: "posted", journalId: prior.journal_id, amount: BigInt(prior.debit_units) };
  const rules = await db.execute<{ debit_account_code: string; credit_account_code: string; outlet_id: string | null }>(sql`
    select debit_account_code, credit_account_code, outlet_id
    from finance_posting_rules
    where company_id = ${input.companyId}
      and event_code = ${input.eventCode}
      and category_code = ${input.categoryCode}
      and (outlet_id is null or outlet_id = ${input.outletId ?? null})
  `);
  const ruleRows = rowsOf(rules);
  const rule = ruleRows.find((row) => row.outlet_id && row.outlet_id === input.outletId) ?? ruleRows.find((row) => row.outlet_id === null);
  if (!rule) return { status: "unconfigured" };
  const amount = roundDocumentTotal(input.internalAmount, input.roundingMode ?? "half-up");
  if (amount <= 0n) return { status: "invalid", reason: "The document total rounds to zero." };
  const journalId = randomUUID();
  await db.transaction(async (tx) => {
    const database = tx as unknown as AuthDatabase;
    await database.execute(sql`
      insert into finance_rule_journals (company_id, journal_id, document_ref, event_code, debit_units, credit_units, created_at)
      values (${input.companyId}, ${journalId}, ${input.documentRef}, ${input.eventCode}, ${amount.toString()}::bigint, ${amount.toString()}::bigint, ${now})
    `);
    await database.execute(sql`
      insert into finance_rule_journal_lines (company_id, journal_id, line_no, account_code, side, amount_units)
      values
        (${input.companyId}, ${journalId}, 1, ${rule.debit_account_code}, 'debit', ${amount.toString()}::bigint),
        (${input.companyId}, ${journalId}, 2, ${rule.credit_account_code}, 'credit', ${amount.toString()}::bigint)
    `);
    await writeAudit(database, {
      eventType: "authorization_allowed",
      userId: actor.userId,
      companyId: input.companyId,
      resourceType: "finance_rule_journal",
      resourceId: journalId,
      emailFingerprint: null,
      ip: null,
      metadata: { module: "finance", action: "post" },
      createdAt: now,
    });
  });
  return { status: "posted", journalId, amount };
}
