import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { writeAudit } from "../auth/audit";
import { evaluateModuleAccess } from "../access/matrix";
import {
  atriumDraftJournalLines,
  atriumDraftJournals,
  atriumRevenueDocuments,
  atriumSpendingDocuments,
  financeChartAccounts,
  financeMappingConfigurations,
  financeModules,
  financeOperatingDepartments,
  financeSettings,
} from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { formatUnits, parseMoney } from "./money";
import type { AtriumDraftJournal } from "./atrium-draft-journals";
import { readAtriumDraftJournal } from "./atrium-draft-journals";

export type CycleWriteFault = "journal" | "lines" | "document" | "audit" | "constraint";

export type RevenueDocument = {
  transaction_id: string;
  date: string;
  source: "Manual" | "PMS";
  department_code: string;
  account_code: string;
  amount: number;
  description: string;
  journal_id: string;
};

export type SpendingDocument = {
  transaction_id: string;
  date: string;
  type: "Procurement" | "Payroll" | "Other";
  vendor_or_employee: string;
  department_code: string;
  account_code: string;
  amount: number;
  description: string;
  journal_id: string;
};

type AccountRole = "revenue" | "asset" | "spending-debit" | "spending-credit";
type SpendType = SpendingDocument["type"];

const revenueFields = new Set(["date", "source", "department_code", "account_code", "amount", "description", "debit_account_code"]);
const spendingFields = new Set(["date", "type", "vendor_or_employee", "department_code", "account_code", "amount", "description", "credit_account_code"]);

class CycleRejection extends Error {}

function financeAllowed(actor: Actor, companyId: string, action: "read" | "create"): boolean {
  return evaluateModuleAccess(actor, "finance", action, { companyId, departmentId: null }).outcome === "allow";
}

async function moduleEnabled(db: AuthDatabase, companyId: string, moduleId: "accounting-core" | "hotel-operations"): Promise<boolean> {
  const rows = await db
    .select()
    .from(financeModules)
    .where(and(eq(financeModules.companyId, companyId), eq(financeModules.moduleId, moduleId), eq(financeModules.enabled, "Y")))
    .limit(1);
  return Boolean(rows[0]);
}

async function cycleAllowed(db: AuthDatabase, actor: Actor, companyId: string, action: "read" | "create"): Promise<boolean> {
  return financeAllowed(actor, companyId, action) && (await moduleEnabled(db, companyId, "accounting-core")) && (await moduleEnabled(db, companyId, "hotel-operations"));
}

export function atriumCycleRoute(method: string, path: string): "revenue-list" | "revenue-create" | "spending-list" | "spending-create" | "unavailable" | null {
  if (path === "/api/revenue") {
    if (method === "GET" || method === "HEAD") return "revenue-list";
    if (method === "POST") return "revenue-create";
    return "unavailable";
  }
  if (path.startsWith("/api/revenue/")) return "unavailable";
  if (path === "/api/spending") {
    if (method === "GET" || method === "HEAD") return "spending-list";
    if (method === "POST") return "spending-create";
    return "unavailable";
  }
  if (path.startsWith("/api/spending/")) return "unavailable";
  return null;
}

function amountUnits(value: unknown): bigint | null {
  const text = typeof value === "number"
    ? Number.isFinite(value) && !Object.is(value, -0) && !/e/i.test(value.toString())
      ? value.toString()
      : null
    : typeof value === "string"
      ? value.trim()
      : null;
  if (text === null || text.startsWith("-")) return null;
  const parsed = parseMoney(text, 2);
  return parsed.ok ? parsed.units : null;
}

function responseAmount(units: bigint): number {
  return Number(formatUnits(units, 2));
}

function storedUnits(value: string): bigint {
  const parsed = parseMoney(value.trim(), 2);
  if (parsed.ok) return parsed.units;
  const trimmed = value.trim().replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
  const again = parseMoney(trimmed, 2);
  if (!again.ok) throw new Error("Stored document amount is not valid.");
  return again.units;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function accepts(accountType: string, role: AccountRole): boolean {
  if (role === "revenue") return accountType === "Revenue";
  if (role === "asset") return accountType === "Asset";
  if (role === "spending-debit") return accountType === "Expense" || accountType === "Asset";
  return accountType === "Liability" || accountType === "Asset";
}

function rejectionReason(error: unknown): string | null {
  if (error instanceof CycleRejection) return error.message;
  if (error && typeof error === "object" && "cause" in error) return rejectionReason((error as { cause?: unknown }).cause);
  return null;
}

function optionalText(record: Record<string, unknown>, key: string): string | null {
  if (!(key in record) || record[key] === "") return null;
  if (typeof record[key] !== "string") throw new CycleRejection("The document is not valid.");
  const value = record[key].trim();
  return value || null;
}

async function activeAccount(db: AuthDatabase, companyId: string, accountCode: string, role: AccountRole, origin: "selected" | "mapped") {
  const rows = await db
    .select()
    .from(financeChartAccounts)
    .where(and(eq(financeChartAccounts.companyId, companyId), eq(financeChartAccounts.accountCode, accountCode), eq(financeChartAccounts.active, "Y")))
    .limit(1);
  const account = rows[0];
  if (!account || !accepts(account.accountType, role)) {
    throw new CycleRejection(
      origin === "mapped"
        ? "The confirmed mapping counterpart is not an active account of the required type in this company."
        : "The selected account is not an active account of the required type in this company.",
    );
  }
  return account;
}

async function activeDepartment(db: AuthDatabase, companyId: string, departmentCode: string) {
  const rows = await db
    .select()
    .from(financeOperatingDepartments)
    .where(
      and(
        eq(financeOperatingDepartments.companyId, companyId),
        eq(financeOperatingDepartments.departmentCode, departmentCode),
        eq(financeOperatingDepartments.active, "Y"),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new CycleRejection("An active operating department in this company is required.");
}

function toRevenue(row: typeof atriumRevenueDocuments.$inferSelect): RevenueDocument {
  return {
    transaction_id: row.transactionId,
    date: row.documentDate,
    source: row.source === "PMS" ? "PMS" : "Manual",
    department_code: row.departmentCode,
    account_code: row.accountCode,
    amount: responseAmount(storedUnits(row.amount)),
    description: row.description,
    journal_id: row.journalId,
  };
}

function toSpending(row: typeof atriumSpendingDocuments.$inferSelect): SpendingDocument {
  const type = row.spendingType === "Payroll" || row.spendingType === "Other" ? row.spendingType : "Procurement";
  return {
    transaction_id: row.transactionId,
    date: row.documentDate,
    type,
    vendor_or_employee: row.vendorOrEmployee,
    department_code: row.departmentCode,
    account_code: row.accountCode,
    amount: responseAmount(storedUnits(row.amount)),
    description: row.description,
    journal_id: row.journalId,
  };
}

export async function readRevenueDocuments(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
): Promise<{ status: "ready"; documents: RevenueDocument[] } | { status: "denied" }> {
  if (!(await cycleAllowed(db, actor, companyId, "read"))) return { status: "denied" };
  const rows = await db
    .select()
    .from(atriumRevenueDocuments)
    .where(eq(atriumRevenueDocuments.companyId, companyId))
    .orderBy(desc(atriumRevenueDocuments.documentDate), desc(atriumRevenueDocuments.transactionId));
  return { status: "ready", documents: rows.map(toRevenue) };
}

export async function readSpendingDocuments(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
): Promise<{ status: "ready"; documents: SpendingDocument[] } | { status: "denied" }> {
  if (!(await cycleAllowed(db, actor, companyId, "read"))) return { status: "denied" };
  const rows = await db
    .select()
    .from(atriumSpendingDocuments)
    .where(eq(atriumSpendingDocuments.companyId, companyId))
    .orderBy(desc(atriumSpendingDocuments.documentDate), desc(atriumSpendingDocuments.transactionId));
  return { status: "ready", documents: rows.map(toSpending) };
}

async function confirmedMapping(db: AuthDatabase, companyId: string) {
  const settings = await db.select().from(financeSettings).where(eq(financeSettings.companyId, companyId)).limit(1);
  if (!settings[0]) throw new CycleRejection("Finance settings are not configured for this company.");
  const rows = await db.select().from(financeMappingConfigurations).where(eq(financeMappingConfigurations.companyId, companyId)).limit(1);
  const mapping = rows[0];
  if (!mapping?.confirmedByController) throw new CycleRejection("Account mapping must be confirmed before this document can be saved.");
  return mapping;
}

async function writeJournal(
  db: AuthDatabase,
  companyId: string,
  journalId: string,
  documentDate: string,
  sourceType: "REVENUE" | "SPENDING",
  transactionId: string,
  createdBy: string,
  lines: { accountCode: string; departmentCode: string; debitUnits: bigint; creditUnits: bigint; description: string }[],
  now: Date,
  fault: CycleWriteFault | undefined,
) {
  if (fault === "journal") throw new Error("journal insert failed");
  await db.insert(atriumDraftJournals).values({
    companyId,
    journalId,
    journalDate: documentDate,
    period: documentDate.slice(0, 7),
    status: "DRAFT",
    sourceType,
    sourceReference: transactionId,
    createdBy,
    createdAt: now,
    updatedAt: now,
  });
  if (fault === "lines") throw new Error("line insert failed");
  await db.insert(atriumDraftJournalLines).values(
    lines.map((line, index) => ({
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
}

export async function createRevenueDocument(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
  email: string,
  input: unknown,
  now: Date,
  fault?: CycleWriteFault,
): Promise<{ status: "saved"; transaction: RevenueDocument; draftJournal: AtriumDraftJournal } | { status: "denied" } | { status: "invalid"; reason: string }> {
  if (!(await cycleAllowed(db, actor, companyId, "create"))) return { status: "denied" };
  const createdBy = email.trim();
  if (!createdBy || createdBy.length > 200 || /[\r\n]/.test(createdBy)) return { status: "invalid", reason: "A signed-in finance user is required." };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { status: "invalid", reason: "The revenue document is not valid." };
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !revenueFields.has(key))) return { status: "invalid", reason: "The revenue document is not valid." };
  if (typeof record.date !== "string" || !isCalendarDate(record.date)) return { status: "invalid", reason: "Transaction date is not valid." };
  if (record.source !== "Manual" && record.source !== "PMS") return { status: "invalid", reason: "Revenue source is not valid." };
  if (typeof record.department_code !== "string" || !record.department_code.trim()) return { status: "invalid", reason: "An active operating department in this company is required." };
  if (typeof record.account_code !== "string" || !record.account_code.trim()) return { status: "invalid", reason: "The revenue account is required." };
  if (record.description !== undefined && (typeof record.description !== "string" || record.description.length > 500)) {
    return { status: "invalid", reason: "The description is not valid." };
  }
  const units = amountUnits(record.amount);
  if (units === null || units <= BigInt(0)) return { status: "invalid", reason: "Transaction amount must be a positive exact decimal with at most two fractional digits." };
  let explicitDebit: string | null;
  try {
    explicitDebit = optionalText(record, "debit_account_code");
  } catch (error) {
    const reason = rejectionReason(error);
    return { status: "invalid", reason: reason ?? "The revenue document is not valid." };
  }
  const documentDate = record.date;
  const source = record.source;
  const departmentCode = record.department_code.trim();
  const revenueCode = record.account_code.trim();
  const description = typeof record.description === "string" ? record.description : "";
  const transactionId = `rev_${randomUUID()}`;
  const journalId = `jrn_${randomUUID()}`;

  try {
    await db.transaction(async (tx) => {
      const database = tx as unknown as AuthDatabase;
      const mapping = await confirmedMapping(database, companyId);
      if (!mapping.revenueDefaultDebitAccount) throw new CycleRejection("The confirmed mapping does not include the revenue counterpart account.");
      const mapped = await activeAccount(database, companyId, mapping.revenueDefaultDebitAccount, "asset", "mapped");
      const debit = explicitDebit ? await activeAccount(database, companyId, explicitDebit, "asset", "selected") : mapped;
      const revenue = await activeAccount(database, companyId, revenueCode, "revenue", "selected");
      await activeDepartment(database, companyId, departmentCode);
      const debitDescription = `Settlement: ${description || "Revenue Transaction"}`;
      const creditDescription = description || `${revenue.accountName} (${source})`;
      if (debitDescription.length > 500 || creditDescription.length > 500) throw new CycleRejection("The description is not valid.");
      await writeJournal(
        database,
        companyId,
        journalId,
        documentDate,
        "REVENUE",
        transactionId,
        createdBy,
        [
          { accountCode: debit.accountCode, departmentCode, debitUnits: units, creditUnits: BigInt(0), description: debitDescription },
          { accountCode: revenue.accountCode, departmentCode, debitUnits: BigInt(0), creditUnits: units, description: creditDescription },
        ],
        now,
        fault,
      );
      if (fault === "document") throw new Error("document insert failed");
      await database.insert(atriumRevenueDocuments).values({
        companyId,
        transactionId,
        journalId,
        documentDate,
        source: fault === "constraint" ? "NOPE" : source,
        departmentCode,
        accountCode: revenue.accountCode,
        amount: formatUnits(units, 2),
        description,
        createdAt: now,
      });
      if (fault === "audit") throw new Error("audit insert failed");
      await writeAudit(database, {
        eventType: "authorization_allowed",
        userId: actor.userId,
        companyId,
        resourceType: "atrium_revenue_document",
        resourceId: transactionId,
        emailFingerprint: null,
        ip: null,
        metadata: { module: "finance", action: "atrium_revenue_recorded" },
        createdAt: now,
      });
    });
  } catch (error) {
    const reason = rejectionReason(error);
    if (reason) return { status: "invalid", reason };
    throw error;
  }

  const documents = await readRevenueDocuments(db, actor, companyId);
  const journal = await readAtriumDraftJournal(db, actor, companyId, journalId);
  const transaction = documents.status === "ready" ? documents.documents.find((item) => item.transaction_id === transactionId) : undefined;
  if (!transaction || journal.status !== "ready") return { status: "invalid", reason: "The revenue document was not stored." };
  return { status: "saved", transaction, draftJournal: journal.journal };
}

export async function createSpendingDocument(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
  email: string,
  input: unknown,
  now: Date,
  fault?: CycleWriteFault,
): Promise<{ status: "saved"; transaction: SpendingDocument; draftJournal: AtriumDraftJournal } | { status: "denied" } | { status: "invalid"; reason: string }> {
  if (!(await cycleAllowed(db, actor, companyId, "create"))) return { status: "denied" };
  const createdBy = email.trim();
  if (!createdBy || createdBy.length > 200 || /[\r\n]/.test(createdBy)) return { status: "invalid", reason: "A signed-in finance user is required." };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { status: "invalid", reason: "The spending document is not valid." };
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !spendingFields.has(key))) return { status: "invalid", reason: "The spending document is not valid." };
  if (typeof record.date !== "string" || !isCalendarDate(record.date)) return { status: "invalid", reason: "Transaction date is not valid." };
  if (record.type !== "Procurement" && record.type !== "Payroll" && record.type !== "Other") return { status: "invalid", reason: "Spending type is not valid." };
  if (typeof record.vendor_or_employee !== "string" || !record.vendor_or_employee.trim() || record.vendor_or_employee.trim().length > 200 || /[\r\n]/.test(record.vendor_or_employee)) {
    return { status: "invalid", reason: "Vendor or employee name is required." };
  }
  if (typeof record.department_code !== "string" || !record.department_code.trim()) return { status: "invalid", reason: "An active operating department in this company is required." };
  if (typeof record.account_code !== "string" || !record.account_code.trim()) return { status: "invalid", reason: "The expense or asset account is required." };
  if (record.description !== undefined && (typeof record.description !== "string" || record.description.length > 500)) {
    return { status: "invalid", reason: "The description is not valid." };
  }
  const units = amountUnits(record.amount);
  if (units === null || units <= BigInt(0)) return { status: "invalid", reason: "Transaction amount must be a positive exact decimal with at most two fractional digits." };
  let explicitCredit: string | null;
  try {
    explicitCredit = optionalText(record, "credit_account_code");
  } catch (error) {
    const reason = rejectionReason(error);
    return { status: "invalid", reason: reason ?? "The spending document is not valid." };
  }
  const documentDate = record.date;
  const spendingType: SpendType = record.type;
  const vendor = record.vendor_or_employee.trim();
  const departmentCode = record.department_code.trim();
  const debitCode = record.account_code.trim();
  const description = typeof record.description === "string" ? record.description : "";
  const transactionId = `spd_${randomUUID()}`;
  const journalId = `jrn_${randomUUID()}`;

  try {
    await db.transaction(async (tx) => {
      const database = tx as unknown as AuthDatabase;
      const mapping = await confirmedMapping(database, companyId);
      const mappedCode = spendingType === "Procurement"
        ? mapping.spendingProcurementCreditAccount
        : spendingType === "Payroll"
          ? mapping.spendingPayrollCreditAccount
          : mapping.spendingOtherCreditAccount;
      if (!mappedCode) throw new CycleRejection("The confirmed mapping does not include the spending counterpart account.");
      const mapped = await activeAccount(database, companyId, mappedCode, "spending-credit", "mapped");
      const credit = explicitCredit ? await activeAccount(database, companyId, explicitCredit, "spending-credit", "selected") : mapped;
      const debit = await activeAccount(database, companyId, debitCode, "spending-debit", "selected");
      await activeDepartment(database, companyId, departmentCode);
      const debitDescription = `${spendingType}: ${vendor} - ${description || debit.accountName}`;
      const creditDescription = `Payable/Settlement to ${vendor}`;
      if (debitDescription.length > 500 || creditDescription.length > 500) throw new CycleRejection("The description is not valid.");
      await writeJournal(
        database,
        companyId,
        journalId,
        documentDate,
        "SPENDING",
        transactionId,
        createdBy,
        [
          { accountCode: debit.accountCode, departmentCode, debitUnits: units, creditUnits: BigInt(0), description: debitDescription },
          { accountCode: credit.accountCode, departmentCode, debitUnits: BigInt(0), creditUnits: units, description: creditDescription },
        ],
        now,
        fault,
      );
      if (fault === "document") throw new Error("document insert failed");
      await database.insert(atriumSpendingDocuments).values({
        companyId,
        transactionId,
        journalId,
        documentDate,
        spendingType: fault === "constraint" ? "NOPE" : spendingType,
        vendorOrEmployee: vendor,
        departmentCode,
        accountCode: debit.accountCode,
        amount: formatUnits(units, 2),
        description,
        createdAt: now,
      });
      if (fault === "audit") throw new Error("audit insert failed");
      await writeAudit(database, {
        eventType: "authorization_allowed",
        userId: actor.userId,
        companyId,
        resourceType: "atrium_spending_document",
        resourceId: transactionId,
        emailFingerprint: null,
        ip: null,
        metadata: { module: "finance", action: "atrium_spending_recorded" },
        createdAt: now,
      });
    });
  } catch (error) {
    const reason = rejectionReason(error);
    if (reason) return { status: "invalid", reason };
    throw error;
  }

  const documents = await readSpendingDocuments(db, actor, companyId);
  const journal = await readAtriumDraftJournal(db, actor, companyId, journalId);
  const transaction = documents.status === "ready" ? documents.documents.find((item) => item.transaction_id === transactionId) : undefined;
  if (!transaction || journal.status !== "ready") return { status: "invalid", reason: "The spending document was not stored." };
  return { status: "saved", transaction, draftJournal: journal.journal };
}
