import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { writeAudit } from "../auth/audit";
import { evaluateModuleAccess } from "../access/matrix";
import {
  financeAccounts,
  financeJournalLines,
  financeJournals,
  financeModules,
  financePeriods,
  financeSettings,
} from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { addUnits, formatUnits, parseMoney, storedNumeric } from "./money";

export type DraftLineInput = {
  accountCode: string;
  side: "debit" | "credit";
  amount: string;
};

export type DraftJournalView = {
  id: string;
  periodKey: string;
  memo: string;
  balanced: boolean;
  debit: string;
  credit: string;
  lines: { lineNo: number; accountCode: string; debit: string; credit: string }[];
};

type Denied = { status: "denied" };
type Invalid = { status: "invalid"; reason: string };

async function accountingCoreEnabled(db: AuthDatabase, companyId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(financeModules)
    .where(and(eq(financeModules.companyId, companyId), eq(financeModules.moduleId, "accounting-core"), eq(financeModules.enabled, "Y")))
    .limit(1);
  return Boolean(rows[0]);
}

function financeAllowed(actor: Actor, companyId: string, action: "read" | "create" | "update"): boolean {
  return evaluateModuleAccess(actor, "finance", action, { companyId, departmentId: null }).outcome === "allow";
}

export async function readFinanceWorkspace(db: AuthDatabase, actor: Actor, companyId: string) {
  if (!financeAllowed(actor, companyId, "read")) return { status: "denied" as const };
  const settings = await db.select().from(financeSettings).where(eq(financeSettings.companyId, companyId)).limit(1);
  const setting = settings[0];
  if (!setting) return { status: "unconfigured" as const, companyId };
  const accounts = await db
    .select()
    .from(financeAccounts)
    .where(eq(financeAccounts.companyId, companyId))
    .orderBy(asc(financeAccounts.accountCode));
  const periods = await db
    .select()
    .from(financePeriods)
    .where(eq(financePeriods.companyId, companyId))
    .orderBy(asc(financePeriods.periodKey));
  const journals = await db
    .select()
    .from(financeJournals)
    .where(eq(financeJournals.companyId, companyId))
    .orderBy(asc(financeJournals.createdAt));
  const lines = await db
    .select()
    .from(financeJournalLines)
    .where(eq(financeJournalLines.companyId, companyId))
    .orderBy(asc(financeJournalLines.lineNo));
  const views = journals.map((journal) => toView(journal, lines.filter((line) => line.journalId === journal.id)));
  return {
    status: "ready" as const,
    companyId,
    currencyCode: setting.currencyCode,
    minorScale: setting.minorScale,
    accounts,
    periods,
    journals: views,
  };
}

function toView(
  journal: { id: string; periodKey: string; memo: string },
  lines: { lineNo: number; accountCode: string; debit: string; credit: string }[],
): DraftJournalView {
  const debit = addUnits(lines.map((line) => unitsFromStored(line.debit)));
  const credit = addUnits(lines.map((line) => unitsFromStored(line.credit)));
  return {
    id: journal.id,
    periodKey: journal.periodKey,
    memo: journal.memo,
    balanced: debit === credit && debit > BigInt(0),
    debit: formatUnits(debit, 4),
    credit: formatUnits(credit, 4),
    lines: lines.map((line) => ({
      lineNo: line.lineNo,
      accountCode: line.accountCode,
      debit: formatUnits(unitsFromStored(line.debit), 4),
      credit: formatUnits(unitsFromStored(line.credit), 4),
    })),
  };
}

function unitsFromStored(value: string): bigint {
  const trimmed = value.trim();
  const canonical = trimmed.includes(".") ? trimmed.replace(/0+$/, "").replace(/\.$/, "") || "0" : trimmed;
  const parsed = parseMoney(canonical, 4);
  return parsed.ok ? parsed.units : BigInt(0);
}

export async function saveDraftJournal(
  db: AuthDatabase,
  actor: Actor,
  input: { companyId: string; journalId?: string | null; periodKey: string; memo: string; lines: DraftLineInput[] },
  now: Date,
): Promise<{ status: "saved"; journalId: string; balanced: boolean } | Denied | Invalid> {
  const companyId = input.companyId.trim();
  const action = input.journalId ? "update" : "create";
  if (!financeAllowed(actor, companyId, action)) return { status: "denied" };
  const settings = await db.select().from(financeSettings).where(eq(financeSettings.companyId, companyId)).limit(1);
  const setting = settings[0];
  if (!setting) return { status: "invalid", reason: "Finance settings are not configured for this company." };
  if (!(await accountingCoreEnabled(db, companyId))) return { status: "invalid", reason: "Accounting Core is not enabled for this company." };
  if (setting.workspaceKind !== "shared" && setting.workspaceKind !== "amg") return { status: "invalid", reason: "This company does not use the shared draft ledger." };
  if (!/^[0-9]{4}-[0-9]{2}$/.test(input.periodKey)) return { status: "invalid", reason: "Period must be YYYY-MM." };
  if (input.lines.length < 2 || input.lines.length > 8) return { status: "invalid", reason: "A draft needs between 2 and 8 lines." };
  const memo = input.memo.trim().slice(0, 200);
  const parsedLines: { accountCode: string; debit: string; credit: string; unitsDebit: bigint; unitsCredit: bigint }[] = [];
  for (const line of input.lines) {
    const accountCode = line.accountCode.trim();
    const amount = parseMoney(line.amount, setting.minorScale);
    if (!amount.ok || amount.units <= BigInt(0)) return { status: "invalid", reason: "Each line needs a positive amount at the company scale." };
    if (line.side !== "debit" && line.side !== "credit") return { status: "invalid", reason: "Each line is a debit or a credit." };
    const account = await db
      .select()
      .from(financeAccounts)
      .where(and(eq(financeAccounts.companyId, companyId), eq(financeAccounts.accountCode, accountCode), eq(financeAccounts.active, "Y")))
      .limit(1);
    if (!account[0]) return { status: "invalid", reason: "Each line must use an active account in this company." };
    parsedLines.push({
      accountCode,
      debit: line.side === "debit" ? storedNumeric(amount.canonical) : storedNumeric(formatUnits(BigInt(0), setting.minorScale)),
      credit: line.side === "credit" ? storedNumeric(amount.canonical) : storedNumeric(formatUnits(BigInt(0), setting.minorScale)),
      unitsDebit: line.side === "debit" ? amount.units : BigInt(0),
      unitsCredit: line.side === "credit" ? amount.units : BigInt(0),
    });
  }
  const period = await db
    .select()
    .from(financePeriods)
    .where(and(eq(financePeriods.companyId, companyId), eq(financePeriods.periodKey, input.periodKey)))
    .limit(1);
  if (!period[0]) return { status: "invalid", reason: "The period is not open for this company." };
  const journalId = input.journalId?.trim() || `jnl_${randomUUID()}`;
  const balanced = addUnits(parsedLines.map((line) => line.unitsDebit)) === addUnits(parsedLines.map((line) => line.unitsCredit));
  if (input.journalId) {
    const existing = await db
      .select()
      .from(financeJournals)
      .where(and(eq(financeJournals.companyId, companyId), eq(financeJournals.id, journalId), eq(financeJournals.status, "draft")))
      .limit(1);
    if (!existing[0]) return { status: "invalid", reason: "That draft was not found in this company." };
  }
  await db.transaction(async (tx) => {
    const database = tx as unknown as AuthDatabase;
    if (input.journalId) {
      await database
        .update(financeJournals)
        .set({ periodKey: input.periodKey, memo })
        .where(and(eq(financeJournals.companyId, companyId), eq(financeJournals.id, journalId)));
      await database
        .delete(financeJournalLines)
        .where(and(eq(financeJournalLines.companyId, companyId), eq(financeJournalLines.journalId, journalId)));
    } else {
      await database.insert(financeJournals).values({
        companyId,
        id: journalId,
        periodKey: input.periodKey,
        memo,
        status: "draft",
        createdBy: actor.userId,
        createdAt: now,
      });
    }
    await database.insert(financeJournalLines).values(
      parsedLines.map((line, index) => ({
        companyId,
        journalId,
        lineNo: index + 1,
        accountCode: line.accountCode,
        debit: line.debit,
        credit: line.credit,
      })),
    );
    await writeAudit(database, {
      eventType: "authorization_allowed",
      userId: actor.userId,
      companyId,
      resourceType: "finance_journal",
      resourceId: journalId,
      emailFingerprint: null,
      ip: null,
      metadata: { module: "finance", action: input.journalId ? "draft_updated" : "draft_created", balanced },
      createdAt: now,
    });
  });
  return { status: "saved", journalId, balanced };
}

function financeAdministrator(actor: Actor, companyId: string): boolean {
  return actor.memberships.some(
    (membership) =>
      membership.companyId === companyId &&
      (membership.role === "administrator" || membership.role === "owner") &&
      (membership.departmentId === null || membership.departmentId === "finance" || membership.departmentId.endsWith("-finance")),
  );
}

export async function addFinanceAccount(
  db: AuthDatabase,
  actor: Actor,
  input: { companyId: string; accountCode: string; accountName: string },
  now: Date,
): Promise<{ status: "created" } | Denied | Invalid> {
  const companyId = input.companyId.trim();
  if (!financeAdministrator(actor, companyId)) return { status: "denied" };
  const accountCode = input.accountCode.trim();
  const accountName = input.accountName.trim();
  if (!accountCode || accountCode.length > 32 || !accountName || accountName.length > 120) {
    return { status: "invalid", reason: "Account code and name are required." };
  }
  const settings = await db.select().from(financeSettings).where(eq(financeSettings.companyId, companyId)).limit(1);
  if (!settings[0]) return { status: "invalid", reason: "Finance settings are not configured for this company." };
  if (!(await accountingCoreEnabled(db, companyId))) return { status: "invalid", reason: "Accounting Core is not enabled for this company." };
  if (settings[0].workspaceKind !== "shared" && settings[0].workspaceKind !== "amg") {
    return { status: "invalid", reason: "This company does not use the shared draft ledger." };
  }
  try {
    await db.insert(financeAccounts).values({ companyId, accountCode, accountName, active: "Y", createdAt: now });
  } catch {
    return { status: "invalid", reason: "That account code already exists in this company." };
  }
  await writeAudit(db, {
    eventType: "authorization_allowed",
    userId: actor.userId,
    companyId,
    resourceType: "finance_account",
    resourceId: accountCode,
    emailFingerprint: null,
    ip: null,
    metadata: { module: "finance", action: "account_created" },
    createdAt: now,
  });
  return { status: "created" };
}

export async function addFinancePeriod(
  db: AuthDatabase,
  actor: Actor,
  input: { companyId: string; periodKey: string },
  now: Date,
): Promise<{ status: "created" } | Denied | Invalid> {
  const companyId = input.companyId.trim();
  if (!financeAdministrator(actor, companyId)) return { status: "denied" };
  if (!/^[0-9]{4}-[0-9]{2}$/.test(input.periodKey)) return { status: "invalid", reason: "Period must be YYYY-MM." };
  const settings = await db.select().from(financeSettings).where(eq(financeSettings.companyId, companyId)).limit(1);
  if (!settings[0]) return { status: "invalid", reason: "Finance settings are not configured for this company." };
  if (!(await accountingCoreEnabled(db, companyId))) return { status: "invalid", reason: "Accounting Core is not enabled for this company." };
  if (settings[0].workspaceKind !== "shared" && settings[0].workspaceKind !== "amg") {
    return { status: "invalid", reason: "This company does not use the shared draft ledger." };
  }
  try {
    await db.insert(financePeriods).values({ companyId, periodKey: input.periodKey, createdAt: now });
  } catch {
    return { status: "invalid", reason: "That period already exists in this company." };
  }
  await writeAudit(db, {
    eventType: "authorization_allowed",
    userId: actor.userId,
    companyId,
    resourceType: "finance_period",
    resourceId: input.periodKey,
    emailFingerprint: null,
    ip: null,
    metadata: { module: "finance", action: "period_created" },
    createdAt: now,
  });
  return { status: "created" };
}
