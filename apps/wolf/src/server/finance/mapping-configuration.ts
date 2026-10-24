import { and, eq } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { writeAudit } from "../auth/audit";
import { evaluateModuleAccess } from "../access/matrix";
import { financeMappingConfigurations, financeModules, financeSettings } from "../db/schema";
import type { AuthDatabase } from "../db/types";

export type MappingConfiguration = {
  revenue_default_debit_account: string;
  spending_procurement_credit_account: string;
  spending_payroll_credit_account: string;
  spending_other_credit_account: string;
  confirmed_by_controller: boolean;
};

export const defaultMappingConfiguration: MappingConfiguration = {
  revenue_default_debit_account: "",
  spending_procurement_credit_account: "",
  spending_payroll_credit_account: "",
  spending_other_credit_account: "",
  confirmed_by_controller: false,
};

const accountFields = [
  "revenue_default_debit_account",
  "spending_procurement_credit_account",
  "spending_payroll_credit_account",
  "spending_other_credit_account",
] as const;

const accountPattern = /^$|^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

type AccountField = (typeof accountFields)[number];

function financeAllowed(actor: Actor, companyId: string, action: "read" | "create" | "update"): boolean {
  return evaluateModuleAccess(actor, "finance", action, { companyId, departmentId: null }).outcome === "allow";
}

async function accountingCoreEnabled(db: AuthDatabase, companyId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(financeModules)
    .where(and(eq(financeModules.companyId, companyId), eq(financeModules.moduleId, "accounting-core"), eq(financeModules.enabled, "Y")))
    .limit(1);
  return Boolean(rows[0]);
}

function fromRow(row: {
  revenueDefaultDebitAccount: string;
  spendingProcurementCreditAccount: string;
  spendingPayrollCreditAccount: string;
  spendingOtherCreditAccount: string;
  confirmedByController: boolean;
}): MappingConfiguration {
  return {
    revenue_default_debit_account: row.revenueDefaultDebitAccount,
    spending_procurement_credit_account: row.spendingProcurementCreditAccount,
    spending_payroll_credit_account: row.spendingPayrollCreditAccount,
    spending_other_credit_account: row.spendingOtherCreditAccount,
    confirmed_by_controller: row.confirmedByController,
  };
}

export function mappingPatch(input: unknown): { ok: true; patch: Partial<MappingConfiguration> } | { ok: false } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false };
  const record = input as Record<string, unknown>;
  const allowed = new Set<string>([...accountFields, "confirmed_by_controller"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) return { ok: false };
  }
  const patch: Partial<MappingConfiguration> = {};
  for (const field of accountFields) {
    if (!(field in record)) continue;
    const value = record[field];
    if (typeof value !== "string" || !accountPattern.test(value.trim())) return { ok: false };
    patch[field as AccountField] = value.trim();
  }
  if ("confirmed_by_controller" in record && typeof record.confirmed_by_controller !== "boolean") return { ok: false };
  return { ok: true, patch };
}

export async function readMappingConfiguration(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
): Promise<{ status: "ready"; configuration: MappingConfiguration } | { status: "denied" }> {
  if (!financeAllowed(actor, companyId, "read") || !(await accountingCoreEnabled(db, companyId))) return { status: "denied" };
  const rows = await db.select().from(financeMappingConfigurations).where(eq(financeMappingConfigurations.companyId, companyId)).limit(1);
  return { status: "ready", configuration: rows[0] ? fromRow(rows[0]) : defaultMappingConfiguration };
}

export async function saveMappingConfiguration(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
  input: unknown,
  now: Date,
): Promise<{ status: "saved"; configuration: MappingConfiguration } | { status: "denied" } | { status: "invalid"; reason: string }> {
  const parsed = mappingPatch(input);
  if (!parsed.ok) return { status: "invalid", reason: "Mapping configuration is not valid." };
  const existing = await db.select().from(financeMappingConfigurations).where(eq(financeMappingConfigurations.companyId, companyId)).limit(1);
  const action = existing[0] ? "update" : "create";
  if (!financeAllowed(actor, companyId, action) || !(await accountingCoreEnabled(db, companyId))) return { status: "denied" };
  const settings = await db.select().from(financeSettings).where(eq(financeSettings.companyId, companyId)).limit(1);
  if (!settings[0]) return { status: "invalid", reason: "Finance settings are not configured for this company." };
  const current = existing[0] ? fromRow(existing[0]) : defaultMappingConfiguration;
  const configuration: MappingConfiguration = {
    ...current,
    ...parsed.patch,
    confirmed_by_controller: true,
  };
  const values = {
    companyId,
    revenueDefaultDebitAccount: configuration.revenue_default_debit_account,
    spendingProcurementCreditAccount: configuration.spending_procurement_credit_account,
    spendingPayrollCreditAccount: configuration.spending_payroll_credit_account,
    spendingOtherCreditAccount: configuration.spending_other_credit_account,
    confirmedByController: true,
    updatedAt: now,
  };
  if (existing[0]) {
    await db.update(financeMappingConfigurations).set(values).where(eq(financeMappingConfigurations.companyId, companyId));
  } else {
    await db.insert(financeMappingConfigurations).values(values);
  }
  await writeAudit(db, {
    eventType: "authorization_allowed",
    userId: actor.userId,
    companyId,
    resourceType: "finance_mapping_configuration",
    resourceId: "mapping",
    emailFingerprint: null,
    ip: null,
    metadata: { module: "finance", action: existing[0] ? "mapping_configuration_updated" : "mapping_configuration_created" },
    createdAt: now,
  });
  return { status: "saved", configuration };
}
