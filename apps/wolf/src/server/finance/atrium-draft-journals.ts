import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { writeAudit } from "../auth/audit";
import { evaluateModuleAccess } from "../access/matrix";
import { atriumDraftJournalLines, atriumDraftJournals, atriumRevenueDocuments, atriumSpendingDocuments, financeChartAccounts, financeModules, financeOperatingDepartments, financeSettings } from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { addUnits, formatUnits, parseMoney } from "./money";

export const journalLifecycleUnavailable = "Journal validation, approval, posting, and reversal are not available.";

const lifecycleActions = new Set(["validate", "approve", "post", "reverse"]);
const headerFields = new Set(["journal_date", "period", "source_type", "source_reference", "created_by"]);
const lineFields = new Set(["account_code", "department_code", "debit", "credit", "description"]);

export type AtriumDraftLine = {
  journal_id: string;
  line_no: number;
  line_number: number;
  account_code: string;
  department_code: string;
  debit: number;
  credit: number;
  description: string;
};

export type AtriumDraftJournal = {
  journal_id: string;
  journal_date: string;
  period: string;
  status: "DRAFT";
  source_type: "MANUAL" | "REVENUE" | "SPENDING";
  source_reference: string;
  created_by: string;
  approved_by: "";
  posted_at: "";
  reversal_of: "";
  lines: AtriumDraftLine[];
  total_debit: number;
  total_credit: number;
  is_balanced: boolean;
};

type ParsedLine = {
  accountCode: string;
  departmentCode: string | null;
  debitUnits: bigint;
  creditUnits: bigint;
  description: string;
};

function financeAllowed(actor: Actor, companyId: string, action: "read" | "create" | "delete"): boolean {
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

export function atriumJournalRoute(method: string, path: string): "list" | "create" | "read" | "remove" | "unavailable" | null {
  if (path === "/api/journals") {
    if (method === "GET" || method === "HEAD") return "list";
    if (method === "POST") return "create";
    return "unavailable";
  }
  if (!path.startsWith("/api/journals/")) return null;
  const parts = path.slice("/api/journals/".length).split("/");
  if (parts.length === 2 && parts[0] && lifecycleActions.has(parts[1] ?? "")) return "unavailable";
  if (parts.length !== 1 || !parts[0]) return "unavailable";
  if (method === "GET" || method === "HEAD") return "read";
  if (method === "DELETE") return "remove";
  return "unavailable";
}

export function journalIdFromPath(path: string): string | null {
  const id = path.slice("/api/journals/".length).split("/")[0] ?? "";
  return /^jrn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? id : null;
}

function amountText(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const text = Object.is(value, -0) ? "0" : value.toString();
    return /e/i.test(text) ? null : text;
  }
  return typeof value === "string" ? value.trim() : null;
}

function unitsAtScaleTwo(value: unknown): bigint | null {
  const text = amountText(value);
  if (text === null) return null;
  const parsed = parseMoney(text, 2);
  return parsed.ok ? parsed.units : null;
}

function responseAmount(units: bigint): number {
  return Number(formatUnits(units, 2));
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function toJournal(
  header: typeof atriumDraftJournals.$inferSelect,
  lines: (typeof atriumDraftJournalLines.$inferSelect)[],
): AtriumDraftJournal {
  const ordered = [...lines].sort((left, right) => left.lineNo - right.lineNo);
  const debitUnits = addUnits(ordered.map((line) => storedUnits(line.debit)));
  const creditUnits = addUnits(ordered.map((line) => storedUnits(line.credit)));
  return {
    journal_id: header.journalId,
    journal_date: header.journalDate,
    period: header.period,
    status: "DRAFT",
    source_type: storedSourceType(header.sourceType),
    source_reference: header.sourceReference,
    created_by: header.createdBy,
    approved_by: "",
    posted_at: "",
    reversal_of: "",
    lines: ordered.map((line) => ({
      journal_id: header.journalId,
      line_no: line.lineNo,
      line_number: line.lineNo,
      account_code: line.accountCode,
      department_code: line.departmentCode ?? "",
      debit: responseAmount(storedUnits(line.debit)),
      credit: responseAmount(storedUnits(line.credit)),
      description: line.description,
    })),
    total_debit: responseAmount(debitUnits),
    total_credit: responseAmount(creditUnits),
    is_balanced: debitUnits === creditUnits && debitUnits > BigInt(0),
  };
}

function storedSourceType(value: string): AtriumDraftJournal["source_type"] {
  if (value === "MANUAL" || value === "REVENUE" || value === "SPENDING") return value;
  throw new Error("Stored draft source is not valid.");
}

function storedUnits(value: string): bigint {
  const parsed = parseMoney(value.trim(), 2);
  if (parsed.ok) return parsed.units;
  const trimmed = value.trim().replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
  const again = parseMoney(trimmed, 2);
  if (!again.ok) throw new Error("Stored draft amount is not valid.");
  return again.units;
}

async function linesFor(db: AuthDatabase, companyId: string, journalId: string) {
  return db
    .select()
    .from(atriumDraftJournalLines)
    .where(and(eq(atriumDraftJournalLines.companyId, companyId), eq(atriumDraftJournalLines.journalId, journalId)))
    .orderBy(asc(atriumDraftJournalLines.lineNo));
}

export async function readAtriumDraftJournals(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
): Promise<{ status: "ready"; journals: AtriumDraftJournal[] } | { status: "denied" }> {
  if (!financeAllowed(actor, companyId, "read") || !(await accountingCoreEnabled(db, companyId))) return { status: "denied" };
  const headers = await db
    .select()
    .from(atriumDraftJournals)
    .where(eq(atriumDraftJournals.companyId, companyId))
    .orderBy(desc(atriumDraftJournals.journalDate), desc(atriumDraftJournals.journalId));
  const journals: AtriumDraftJournal[] = [];
  for (const header of headers) journals.push(toJournal(header, await linesFor(db, companyId, header.journalId)));
  return { status: "ready", journals };
}

export async function readAtriumDraftJournal(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
  journalId: string,
): Promise<{ status: "ready"; journal: AtriumDraftJournal } | { status: "missing" } | { status: "denied" }> {
  if (!financeAllowed(actor, companyId, "read") || !(await accountingCoreEnabled(db, companyId))) return { status: "denied" };
  const headers = await db
    .select()
    .from(atriumDraftJournals)
    .where(and(eq(atriumDraftJournals.companyId, companyId), eq(atriumDraftJournals.journalId, journalId)))
    .limit(1);
  const header = headers[0];
  if (!header) return { status: "missing" };
  return { status: "ready", journal: toJournal(header, await linesFor(db, companyId, journalId)) };
}

export async function createAtriumDraftJournal(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
  email: string,
  input: unknown,
  now: Date,
): Promise<{ status: "saved"; journal: AtriumDraftJournal } | { status: "denied" } | { status: "invalid"; reason: string }> {
  if (!financeAllowed(actor, companyId, "create") || !(await accountingCoreEnabled(db, companyId))) return { status: "denied" };
  const createdBy = email.trim();
  if (!createdBy || createdBy.length > 200 || /[\r\n]/.test(createdBy)) return { status: "invalid", reason: "A signed-in finance user is required." };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { status: "invalid", reason: "A draft journal needs a header and lines." };
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "header" && key !== "lines")) return { status: "invalid", reason: "A draft journal needs a header and lines." };
  const header = body.header;
  const lines = body.lines;
  if (!header || typeof header !== "object" || Array.isArray(header) || !Array.isArray(lines)) {
    return { status: "invalid", reason: "A draft journal needs a header and lines." };
  }
  const headerRecord = header as Record<string, unknown>;
  if (Object.keys(headerRecord).some((key) => !headerFields.has(key))) return { status: "invalid", reason: "A draft journal header is not valid." };
  if (headerRecord.source_type !== "MANUAL") return { status: "invalid", reason: "Only a manual draft can be saved." };
  if (typeof headerRecord.journal_date !== "string" || !isCalendarDate(headerRecord.journal_date)) {
    return { status: "invalid", reason: "Journal date is not valid." };
  }
  const period = typeof headerRecord.period === "string" ? headerRecord.period : headerRecord.journal_date.slice(0, 7);
  if (period !== headerRecord.journal_date.slice(0, 7)) return { status: "invalid", reason: "Period must match the journal date." };
  const sourceReference = headerRecord.source_reference === undefined ? "" : headerRecord.source_reference;
  if (typeof sourceReference !== "string" || sourceReference.trim().length > 200) return { status: "invalid", reason: "Source reference is not valid." };
  if (lines.length < 2 || lines.length > 40) return { status: "invalid", reason: "A draft needs between 2 and 40 lines." };

  const parsed: ParsedLine[] = [];
  for (const line of lines) {
    if (!line || typeof line !== "object" || Array.isArray(line)) return { status: "invalid", reason: "A journal line is not valid." };
    const record = line as Record<string, unknown>;
    if (Object.keys(record).some((key) => !lineFields.has(key))) return { status: "invalid", reason: "A journal line is not valid." };
    if (typeof record.account_code !== "string" || typeof record.description !== "string" || record.description.length > 500) {
      return { status: "invalid", reason: "A journal line is not valid." };
    }
    const department = record.department_code === undefined || record.department_code === "" ? null : record.department_code;
    if (department !== null && typeof department !== "string") return { status: "invalid", reason: "A journal line is not valid." };
    const debitUnits = unitsAtScaleTwo(record.debit);
    const creditUnits = unitsAtScaleTwo(record.credit);
    if (debitUnits === null || creditUnits === null) return { status: "invalid", reason: "Amounts must be exact decimals with at most two fractional digits." };
    const oneSide = (debitUnits > BigInt(0) && creditUnits === BigInt(0)) || (creditUnits > BigInt(0) && debitUnits === BigInt(0));
    if (!oneSide) return { status: "invalid", reason: "Each line is either a debit or a credit." };
    parsed.push({
      accountCode: record.account_code.trim(),
      departmentCode: typeof department === "string" ? department.trim() : null,
      debitUnits,
      creditUnits,
      description: record.description,
    });
  }

  const settings = await db.select().from(financeSettings).where(eq(financeSettings.companyId, companyId)).limit(1);
  if (!settings[0]) return { status: "invalid", reason: "Finance settings are not configured for this company." };
  for (const line of parsed) {
    const account = await db
      .select()
      .from(financeChartAccounts)
      .where(and(eq(financeChartAccounts.companyId, companyId), eq(financeChartAccounts.accountCode, line.accountCode), eq(financeChartAccounts.active, "Y")))
      .limit(1);
    if (!account[0]) return { status: "invalid", reason: "Each line needs an active account in this company." };
    if (line.departmentCode) {
      const department = await db
        .select()
        .from(financeOperatingDepartments)
        .where(
          and(
            eq(financeOperatingDepartments.companyId, companyId),
            eq(financeOperatingDepartments.departmentCode, line.departmentCode),
            eq(financeOperatingDepartments.active, "Y"),
          ),
        )
        .limit(1);
      if (!department[0]) return { status: "invalid", reason: "Each line needs an active operating department in this company." };
    }
  }

  const journalId = `jrn_${randomUUID()}`;
  await db.transaction(async (tx) => {
    const database = tx as unknown as AuthDatabase;
    await database.insert(atriumDraftJournals).values({
      companyId,
      journalId,
      journalDate: headerRecord.journal_date as string,
      period,
      status: "DRAFT",
      sourceType: "MANUAL",
      sourceReference: sourceReference.trim(),
      createdBy,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(atriumDraftJournalLines).values(
      parsed.map((line, index) => ({
        companyId,
        journalId,
        lineNo: index + 1,
        accountCode: line.accountCode,
        departmentCode: line.departmentCode,
        debit: formatUnits(line.debitUnits, 2),
        credit: formatUnits(line.creditUnits, 2),
        description: line.description,
        createdAt: now,
      })),
    );
    await writeAudit(database, {
      eventType: "authorization_allowed",
      userId: actor.userId,
      companyId,
      resourceType: "atrium_draft_journal",
      resourceId: journalId,
      emailFingerprint: null,
      ip: null,
      metadata: { module: "finance", action: "atrium_draft_created" },
      createdAt: now,
    });
  });
  const saved = await readAtriumDraftJournal(db, actor, companyId, journalId);
  if (saved.status !== "ready") return { status: "invalid", reason: "The draft journal was not stored." };
  return { status: "saved", journal: saved.journal };
}

export async function deleteAtriumDraftJournal(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
  journalId: string,
  now: Date,
): Promise<{ status: "deleted" } | { status: "missing" } | { status: "linked"; reason: string } | { status: "denied" }> {
  if (!financeAllowed(actor, companyId, "delete") || !(await accountingCoreEnabled(db, companyId))) return { status: "denied" };
  const existing = await db
    .select()
    .from(atriumDraftJournals)
    .where(and(eq(atriumDraftJournals.companyId, companyId), eq(atriumDraftJournals.journalId, journalId), eq(atriumDraftJournals.status, "DRAFT")))
    .limit(1);
  if (!existing[0]) return { status: "missing" };
  try {
    await db.transaction(async (tx) => {
      const database = tx as unknown as AuthDatabase;
      const revenueLink = await database
        .select({ transactionId: atriumRevenueDocuments.transactionId })
        .from(atriumRevenueDocuments)
        .where(and(eq(atriumRevenueDocuments.companyId, companyId), eq(atriumRevenueDocuments.journalId, journalId)))
        .limit(1);
      const spendingLink = await database
        .select({ transactionId: atriumSpendingDocuments.transactionId })
        .from(atriumSpendingDocuments)
        .where(and(eq(atriumSpendingDocuments.companyId, companyId), eq(atriumSpendingDocuments.journalId, journalId)))
        .limit(1);
      if (revenueLink[0] || spendingLink[0]) throw new LinkedDraftError();
      await database
        .delete(atriumDraftJournals)
        .where(and(eq(atriumDraftJournals.companyId, companyId), eq(atriumDraftJournals.journalId, journalId)));
      await writeAudit(database, {
        eventType: "authorization_allowed",
        userId: actor.userId,
        companyId,
        resourceType: "atrium_draft_journal",
        resourceId: journalId,
        emailFingerprint: null,
        ip: null,
        metadata: { module: "finance", action: "atrium_draft_deleted" },
        createdAt: now,
      });
    });
  } catch (error) {
    if (error instanceof LinkedDraftError) {
      return { status: "linked", reason: "This draft journal belongs to a revenue or spending document and cannot be deleted here." };
    }
    throw error;
  }
  return { status: "deleted" };
}

class LinkedDraftError extends Error {}
