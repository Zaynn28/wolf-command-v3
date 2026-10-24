import { and, asc, eq } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { writeAudit } from "../auth/audit";
import { evaluateModuleAccess } from "../access/matrix";
import { financeChartAccounts, financeModules, financeSettings } from "../db/schema";
import type { AuthDatabase } from "../db/types";

export type ChartAccount = {
  account_code: string;
  account_name: string;
  account_type: "Asset" | "Liability" | "Equity" | "Revenue" | "Expense";
  normal_balance: "Debit" | "Credit";
  statutory_line: string;
  usali_line: string;
  active: "Y" | "N";
};

const accountTypes = new Set<ChartAccount["account_type"]>(["Asset", "Liability", "Equity", "Revenue", "Expense"]);
const normalBalances = new Set<ChartAccount["normal_balance"]>(["Debit", "Credit"]);
const codePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const accountFields = [
  "account_code",
  "account_name",
  "account_type",
  "normal_balance",
  "statutory_line",
  "usali_line",
  "active",
] as const;

export const chartDeactivationBlocked =
  "Account deactivation is not available until journal references are stored for this company.";
export const chartDeletionBlocked =
  "Account deletion is not available until journal references are stored for this company.";
export const chartSeedBlocked =
  "USALI seeding is not available. No standard chart is copied, and the existing Atrium chart is left unchanged.";

function financeAllowed(actor: Actor, companyId: string, action: "read" | "create" | "update" | "delete"): boolean {
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

function toAccount(row: typeof financeChartAccounts.$inferSelect): ChartAccount {
  const accountType = accountTypes.has(row.accountType as ChartAccount["account_type"])
    ? (row.accountType as ChartAccount["account_type"])
    : null;
  const normalBalance = normalBalances.has(row.normalBalance as ChartAccount["normal_balance"])
    ? (row.normalBalance as ChartAccount["normal_balance"])
    : null;
  if (!accountType || !normalBalance || (row.active !== "Y" && row.active !== "N")) {
    throw new Error("Stored chart account is not valid.");
  }
  return {
    account_code: row.accountCode,
    account_name: row.accountName,
    account_type: accountType,
    normal_balance: normalBalance,
    statutory_line: row.statutoryLine,
    usali_line: row.usaliLine,
    active: row.active,
  };
}

export function chartAccountIssue(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Account record is not valid.";
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !accountFields.includes(key as (typeof accountFields)[number]))) return "Account record has an unknown field.";
  const code = record.account_code;
  const name = record.account_name;
  const accountType = record.account_type;
  const normalBalance = record.normal_balance;
  const statutoryLine = record.statutory_line;
  const usaliLine = record.usali_line;
  const active = record.active;
  if (typeof code !== "string" || !codePattern.test(code.trim())) return "Account code is not valid.";
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 200) return "Account name is not valid.";
  if (!accountTypes.has(accountType as ChartAccount["account_type"])) return "Account type is not valid.";
  if (!normalBalances.has(normalBalance as ChartAccount["normal_balance"])) return "Normal balance is not valid.";
  if (active !== "Y" && active !== "N") return "Active flag is not valid.";
  if (typeof statutoryLine !== "string" || statutoryLine.trim().length > 200) return "Statutory line is not valid.";
  if (typeof usaliLine !== "string" || usaliLine.trim().length > 200) return "USALI line is not valid.";
  return null;
}

export function parseChartAccount(input: unknown): ChartAccount | null {
  if (chartAccountIssue(input)) return null;
  const record = input as Record<string, unknown>;
  return {
    account_code: String(record.account_code).trim(),
    account_name: String(record.account_name).trim(),
    account_type: record.account_type as ChartAccount["account_type"],
    normal_balance: record.normal_balance as ChartAccount["normal_balance"],
    statutory_line: String(record.statutory_line).trim(),
    usali_line: String(record.usali_line).trim(),
    active: record.active as ChartAccount["active"],
  };
}

export async function readChartAccounts(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
): Promise<{ status: "ready"; accounts: ChartAccount[] } | { status: "denied" }> {
  if (!financeAllowed(actor, companyId, "read") || !(await accountingCoreEnabled(db, companyId))) return { status: "denied" };
  const rows = await db
    .select()
    .from(financeChartAccounts)
    .where(eq(financeChartAccounts.companyId, companyId))
    .orderBy(asc(financeChartAccounts.accountCode));
  return { status: "ready", accounts: rows.map(toAccount) };
}

export async function saveChartAccount(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
  input: unknown,
  now: Date,
): Promise<{ status: "saved"; account: ChartAccount } | { status: "denied" } | { status: "invalid"; reason: string } | { status: "blocked"; reason: string }> {
  const account = parseChartAccount(input);
  if (!account) return { status: "invalid", reason: "Account code, name, type, and normal balance are required." };
  const existing = await db
    .select()
    .from(financeChartAccounts)
    .where(and(eq(financeChartAccounts.companyId, companyId), eq(financeChartAccounts.accountCode, account.account_code)))
    .limit(1);
  const action = existing[0] ? "update" : "create";
  if (!financeAllowed(actor, companyId, action) || !(await accountingCoreEnabled(db, companyId))) return { status: "denied" };
  if (existing[0]?.active === "Y" && account.active === "N") return { status: "blocked", reason: chartDeactivationBlocked };
  const settings = await db.select().from(financeSettings).where(eq(financeSettings.companyId, companyId)).limit(1);
  if (!settings[0]) return { status: "invalid", reason: "Finance settings are not configured for this company." };
  if (existing[0]) {
    await db
      .update(financeChartAccounts)
      .set({
        accountName: account.account_name,
        accountType: account.account_type,
        normalBalance: account.normal_balance,
        statutoryLine: account.statutory_line,
        usaliLine: account.usali_line,
        active: account.active,
        updatedAt: now,
      })
      .where(and(eq(financeChartAccounts.companyId, companyId), eq(financeChartAccounts.accountCode, account.account_code)));
  } else {
    await db.insert(financeChartAccounts).values({
      companyId,
      accountCode: account.account_code,
      accountName: account.account_name,
      accountType: account.account_type,
      normalBalance: account.normal_balance,
      statutoryLine: account.statutory_line,
      usaliLine: account.usali_line,
      active: account.active,
      createdAt: now,
      updatedAt: now,
    });
  }
  await writeAudit(db, {
    eventType: "authorization_allowed",
    userId: actor.userId,
    companyId,
    resourceType: "finance_chart_account",
    resourceId: account.account_code,
    emailFingerprint: null,
    ip: null,
    metadata: { module: "finance", action: existing[0] ? "chart_account_updated" : "chart_account_created" },
    createdAt: now,
  });
  return { status: "saved", account };
}

export async function deactivateChartAccount(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
): Promise<{ status: "denied" } | { status: "blocked"; reason: string }> {
  if (!financeAllowed(actor, companyId, "update") || !(await accountingCoreEnabled(db, companyId))) return { status: "denied" };
  return { status: "blocked", reason: chartDeactivationBlocked };
}

export async function deleteChartAccount(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
): Promise<{ status: "denied" } | { status: "blocked"; reason: string }> {
  if (!financeAllowed(actor, companyId, "delete") || !(await accountingCoreEnabled(db, companyId))) return { status: "denied" };
  return { status: "blocked", reason: chartDeletionBlocked };
}

export async function seedChartAccounts(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
): Promise<{ status: "denied" } | { status: "blocked"; reason: string }> {
  if (!financeAllowed(actor, companyId, "create") || !(await accountingCoreEnabled(db, companyId))) return { status: "denied" };
  return { status: "blocked", reason: chartSeedBlocked };
}
