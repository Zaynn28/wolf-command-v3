import { and, eq } from "drizzle-orm";
import { writeAudit } from "../auth/audit";
import { financeChartAccounts, financeSettings } from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { chartAccountIssue, parseChartAccount, type ChartAccount } from "./chart-accounts";

export const amgChartCompanyId = "amg";

export type ChartImportConflict = {
  account_code: string;
  fields: string[];
};

export type ChartImportRejection = {
  account_code: string;
  reason: string;
};

export type ChartImportReport = {
  status: "imported" | "rejected" | "refused";
  sourceCount: number;
  importedCount: number;
  skippedCount: number;
  conflictCount: number;
  conflicts: ChartImportConflict[];
  rejected: ChartImportRejection[];
};

export type ChartReconciliation = {
  matched: boolean;
  sourceCount: number;
  storedCount: number;
  missing: string[];
  unexpected: string[];
  different: ChartImportConflict[];
};

const emptyReport = (status: ChartImportReport["status"], sourceCount = 0): ChartImportReport => ({
  status,
  sourceCount,
  importedCount: 0,
  skippedCount: 0,
  conflictCount: 0,
  conflicts: [],
  rejected: [],
});

function accountCode(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "(missing)";
  const code = (input as { account_code?: unknown }).account_code;
  return typeof code === "string" && code.trim() ? code.trim() : "(missing)";
}

function changedFields(row: typeof financeChartAccounts.$inferSelect, account: ChartAccount): string[] {
  const fields: string[] = [];
  if (row.accountName !== account.account_name) fields.push("account_name");
  if (row.accountType !== account.account_type) fields.push("account_type");
  if (row.normalBalance !== account.normal_balance) fields.push("normal_balance");
  if (row.statutoryLine !== account.statutory_line) fields.push("statutory_line");
  if (row.usaliLine !== account.usali_line) fields.push("usali_line");
  if (row.active !== account.active) fields.push("active");
  return fields;
}

export function readChartExport(input: unknown): { ok: true; accounts: unknown[] } | { ok: false; reason: string } {
  if (!Array.isArray(input)) return { ok: false, reason: "The chart export must be an array of accounts." };
  return { ok: true, accounts: input };
}

export async function importAmgChartAccounts(
  db: AuthDatabase,
  request: { companyId: string; userId: string; accounts: unknown[] },
  now: Date,
): Promise<ChartImportReport> {
  if (request.companyId !== amgChartCompanyId || !request.userId) return emptyReport("refused", request.accounts.length);
  const rejected: ChartImportRejection[] = [];
  const parsed: ChartAccount[] = [];
  const seen = new Set<string>();
  for (const input of request.accounts) {
    const issue = chartAccountIssue(input);
    const code = accountCode(input);
    if (issue) {
      rejected.push({ account_code: code, reason: issue });
      continue;
    }
    const account = parseChartAccount(input);
    if (!account) {
      rejected.push({ account_code: code, reason: "Account record is not valid." });
      continue;
    }
    if (seen.has(account.account_code)) {
      rejected.push({ account_code: account.account_code, reason: "Duplicate account code." });
      continue;
    }
    seen.add(account.account_code);
    parsed.push(account);
  }
  if (rejected.length > 0) {
    return { ...emptyReport("rejected", request.accounts.length), rejected };
  }

  const settings = await db.select().from(financeSettings).where(eq(financeSettings.companyId, amgChartCompanyId)).limit(1);
  if (!settings[0]) {
    return {
      ...emptyReport("rejected", parsed.length),
      rejected: [{ account_code: "(missing)", reason: "Finance settings are not configured for this company." }],
    };
  }

  const report = emptyReport("imported", parsed.length);
  await db.transaction(async (tx) => {
    for (const account of parsed) {
      const existing = await tx
        .select()
        .from(financeChartAccounts)
        .where(and(eq(financeChartAccounts.companyId, amgChartCompanyId), eq(financeChartAccounts.accountCode, account.account_code)))
        .limit(1);
      const row = existing[0];
      if (!row) {
        await tx.insert(financeChartAccounts).values({
          companyId: amgChartCompanyId,
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
        report.importedCount += 1;
        continue;
      }
      const fields = changedFields(row, account);
      if (fields.length === 0) {
        report.skippedCount += 1;
        continue;
      }
      report.conflicts.push({ account_code: account.account_code, fields });
    }
    report.conflictCount = report.conflicts.length;
    if (report.importedCount > 0) {
      await writeAudit(tx, {
        eventType: "authorization_allowed",
        userId: request.userId,
        companyId: amgChartCompanyId,
        resourceType: "finance_chart_account",
        resourceId: "chart",
        emailFingerprint: null,
        ip: null,
        metadata: {
          module: "finance",
          action: "chart_imported",
          imported: report.importedCount,
          skipped: report.skippedCount,
          conflicts: report.conflictCount,
        },
        createdAt: now,
      });
    }
  });
  return report;
}

export function reconcileChartAccounts(source: ChartAccount[], stored: ChartAccount[]): ChartReconciliation {
  const storedByCode = new Map(stored.map((account) => [account.account_code, account]));
  const sourceCodes = new Set(source.map((account) => account.account_code));
  const missing = source.filter((account) => !storedByCode.has(account.account_code)).map((account) => account.account_code);
  const unexpected = stored.filter((account) => !sourceCodes.has(account.account_code)).map((account) => account.account_code);
  const different: ChartImportConflict[] = [];
  for (const account of source) {
    const row = storedByCode.get(account.account_code);
    if (!row) continue;
    const fields: string[] = [];
    if (row.account_name !== account.account_name) fields.push("account_name");
    if (row.account_type !== account.account_type) fields.push("account_type");
    if (row.normal_balance !== account.normal_balance) fields.push("normal_balance");
    if (row.statutory_line !== account.statutory_line) fields.push("statutory_line");
    if (row.usali_line !== account.usali_line) fields.push("usali_line");
    if (row.active !== account.active) fields.push("active");
    if (fields.length > 0) different.push({ account_code: account.account_code, fields });
  }
  return {
    matched: missing.length === 0 && unexpected.length === 0 && different.length === 0 && source.length === stored.length,
    sourceCount: source.length,
    storedCount: stored.length,
    missing,
    unexpected,
    different,
  };
}
