import { createHash } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { writeAudit } from "../auth/audit";
import { atriumDraftJournalLines, atriumDraftJournals, financeChartAccounts, financeSettings } from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { formatUnits, parseMoney } from "./money";

export const amgTransactionCompanyId = "amg";
export const amgGuestLedgerAccount = "1020";

const transientSegments = new Set(["OTA(Online Travel Agent)", "FIT / Individual", "Transient Walk-in/Phone"]);
const groupSegments = new Set(["Group - Business", "Group - Leisure"]);
const cashSettlements = new Set(["Cash", "Bank Transfer"]);

export type AbsTransactionRow = {
  absId: string;
  fileStamp: string;
  excelRow: number;
  reservation: string;
  folio: string;
  invoice: string;
  room: string;
  charge: string;
  extraChargeType: string;
  marketSegment: string;
  settlementParticular: string;
  reference: string;
  transactionDate: string;
  quantity: string;
  netAmount: string;
  discountAmount: string;
  taxableAmount: string;
  grossAmount: string;
  settlementAmount: string;
  folioStatus: string;
};

export type AmgTransactionSkip = {
  reason: string;
};

export type AmgTransactionImportReport = {
  status: "imported" | "refused";
  reason: string;
  sourceRows: number;
  loaded: number;
  alreadyLoaded: number;
  skipped: number;
  skipReasons: Record<string, number>;
  sourceGross: string;
  sourceSettlement: string;
  loadedAmount: string;
  debitByAccount: Record<string, string>;
  creditByAccount: Record<string, string>;
  loadedByPeriod: Record<string, string>;
};

type PreparedJournal = {
  externalId: string;
  journalId: string;
  journalDate: string;
  period: string;
  sourceType: "REVENUE" | "MANUAL";
  amount: bigint;
  debitAccount: string;
  creditAccount: string;
  description: string;
};

const emptyReport = (status: AmgTransactionImportReport["status"], reason = ""): AmgTransactionImportReport => ({
  status,
  reason,
  sourceRows: 0,
  loaded: 0,
  alreadyLoaded: 0,
  skipped: 0,
  skipReasons: {},
  sourceGross: "0",
  sourceSettlement: "0",
  loadedAmount: "0",
  debitByAccount: {},
  creditByAccount: {},
  loadedByPeriod: {},
});

export function amgTransactionExternalId(row: Pick<AbsTransactionRow, "absId" | "fileStamp" | "excelRow">): string {
  return `AMG|ABS|${row.absId}|${row.fileStamp}|r${row.excelRow}`;
}

export function amgTransactionJournalId(externalId: string): string {
  const hex = createHash("sha256").update(`amg-abs:${externalId}`).digest("hex");
  return `jrn_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function note(reasons: Record<string, number>, reason: string): void {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

function wholeIdr(value: string): bigint | null {
  if (!/^-?(?:0|[1-9]\d*)$/.test(value)) return null;
  return BigInt(value);
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function safeToken(value: string): string {
  return /^[A-Za-z0-9-]{1,40}$/.test(value) ? value : "";
}

function settlementKind(value: string): string {
  const trimmed = value.trim();
  if (cashSettlements.has(trimmed)) return trimmed;
  if (trimmed.startsWith("Booking.com")) return "Booking.com";
  if (trimmed.startsWith("Airbnb")) return "Airbnb";
  if (trimmed.startsWith("Owner Unit")) return "Owner Unit";
  if (trimmed === "OWNER NETWORK") return "Owner network";
  if (["Credit Card", "Debit Card", "QRISS", "Walk-in", "Balance Transfer"].includes(trimmed)) return trimmed;
  if (!trimmed) return "";
  return "other";
}

function contentKey(row: AbsTransactionRow): string {
  return [
    row.reservation.trim(),
    row.folio.trim(),
    row.invoice.trim(),
    row.room.trim(),
    row.transactionDate.trim(),
    row.charge.trim(),
    row.extraChargeType.trim(),
    row.marketSegment.trim(),
    row.settlementParticular.trim(),
    row.reference.trim(),
    row.quantity.trim(),
    row.netAmount.trim(),
    row.discountAmount.trim(),
    row.taxableAmount.trim(),
    row.grossAmount.trim(),
    row.settlementAmount.trim(),
    row.folioStatus.trim(),
  ].join("|");
}

function revenueAccount(charge: string, segment: string): string | null {
  if (charge === "Room Charges" && transientSegments.has(segment)) return "4010";
  if (charge === "Room Charges" && groupSegments.has(segment)) return "4020";
  if (charge === "Breakfast (UMA BLU)") return "4110";
  return null;
}

function addAmount(totals: Record<string, bigint>, account: string, amount: bigint): void {
  totals[account] = (totals[account] ?? BigInt(0)) + amount;
}

function textTotals(totals: Record<string, bigint>): Record<string, string> {
  return Object.fromEntries(Object.entries(totals).map(([account, amount]) => [account, amount.toString()]));
}

export function prepareAmgTransactions(rows: AbsTransactionRow[]): {
  journals: PreparedJournal[];
  skipped: AmgTransactionSkip[];
  skipReasons: Record<string, number>;
  duplicateKeys: number;
  sourceGross: bigint;
  sourceSettlement: bigint;
} {
  const journals: PreparedJournal[] = [];
  const skipped: AmgTransactionSkip[] = [];
  const skipReasons: Record<string, number> = {};
  const seen = new Set<string>();
  const seenExternal = new Set<string>();
  let sourceGross = BigInt(0);
  let sourceSettlement = BigInt(0);
  let duplicateKeys = 0;

  for (const row of rows) {
    const gross = wholeIdr(row.grossAmount.trim() || "0");
    const settlement = wholeIdr(row.settlementAmount.trim() || "0");
    if (gross !== null && gross > BigInt(0)) sourceGross += gross;
    if (settlement !== null && settlement !== BigInt(0)) sourceSettlement += settlement;

    if (!/^[A-Za-z0-9_-]{1,64}$/.test(row.absId) || !/^\d{4}-\d{2}-\d{2}_\d{2}_\d{2}_\d{2}$/.test(row.fileStamp) || !Number.isInteger(row.excelRow) || row.excelRow < 2) {
      note(skipReasons, "invalid_source");
      skipped.push({ reason: "invalid_source" });
      continue;
    }
    const externalId = amgTransactionExternalId(row);
    if (externalId.length > 200 || seenExternal.has(externalId)) {
      note(skipReasons, "invalid_source");
      skipped.push({ reason: "invalid_source" });
      continue;
    }
    seenExternal.add(externalId);
    const fingerprint = contentKey(row);
    if (seen.has(fingerprint)) {
      duplicateKeys += 1;
      note(skipReasons, "duplicate");
      skipped.push({ reason: "duplicate" });
      continue;
    }
    seen.add(fingerprint);

    if (row.grossAmount.trim() === "invalid" || row.settlementAmount.trim() === "invalid" || gross === null || settlement === null || gross < BigInt(0)) {
      note(skipReasons, "invalid_amount");
      skipped.push({ reason: "invalid_amount" });
      continue;
    }
    if (!isCalendarDate(row.transactionDate.trim())) {
      note(skipReasons, "invalid_date");
      skipped.push({ reason: "invalid_date" });
      continue;
    }
    if (row.folioStatus.trim() === "Void") {
      note(skipReasons, "void");
      skipped.push({ reason: "void" });
      continue;
    }
    if (gross === BigInt(0) && settlement === BigInt(0)) {
      note(skipReasons, "zero_amount");
      skipped.push({ reason: "zero_amount" });
      continue;
    }
    if (gross > BigInt(0) && settlement !== BigInt(0)) {
      note(skipReasons, "mixed_amount");
      skipped.push({ reason: "mixed_amount" });
      continue;
    }

    const folio = safeToken(row.folio.trim());
    const reservation = safeToken(row.reservation.trim());
    const ref = [folio ? `folio ${folio}` : "", reservation ? `reservation ${reservation}` : ""].filter(Boolean).join(" ");
    let prepared: Omit<PreparedJournal, "externalId" | "journalId" | "journalDate" | "period"> | null = null;
    if (gross > BigInt(0)) {
      const account = revenueAccount(row.charge.trim(), row.marketSegment.trim());
      if (!account) {
        note(skipReasons, `unmapped_charge:${row.charge.trim() || "blank"}`);
        skipped.push({ reason: "unmapped_charge" });
        continue;
      }
      const segment = row.marketSegment.trim();
      prepared = {
        sourceType: "REVENUE",
        amount: gross,
        debitAccount: amgGuestLedgerAccount,
        creditAccount: account,
        description: `ABS ${row.charge.trim()}${segment ? ` / ${segment}` : ""}${ref ? ` ${ref}` : ""}`.slice(0, 500),
      };
    } else if (settlement < BigInt(0)) {
      const kind = settlementKind(row.settlementParticular);
      if (!cashSettlements.has(kind)) {
        note(skipReasons, `unmapped_settlement:${kind || "blank"}`);
        skipped.push({ reason: "unmapped_settlement" });
        continue;
      }
      prepared = {
        sourceType: "MANUAL",
        amount: -settlement,
        debitAccount: "1010",
        creditAccount: amgGuestLedgerAccount,
        description: `ABS ${kind} settlement${ref ? ` ${ref}` : ""}`.slice(0, 500),
      };
    } else {
      note(skipReasons, "positive_settlement");
      skipped.push({ reason: "positive_settlement" });
      continue;
    }

    journals.push({
      ...prepared,
      externalId,
      journalId: amgTransactionJournalId(externalId),
      journalDate: row.transactionDate.trim(),
      period: row.transactionDate.trim().slice(0, 7),
    });
  }

  return { journals, skipped, skipReasons, duplicateKeys, sourceGross, sourceSettlement };
}

export async function importAmgTransactions(
  db: AuthDatabase,
  request: { companyId: string; userId: string; createdBy: string; rows: AbsTransactionRow[] },
  now: Date,
): Promise<AmgTransactionImportReport> {
  if (request.companyId !== amgTransactionCompanyId || !request.userId) return emptyReport("refused", "AMG is the only company that can load this ABS export.");
  const createdBy = request.createdBy.trim();
  if (!createdBy || createdBy.length > 200 || /[\r\n]/.test(createdBy)) return emptyReport("refused", "A signed-in finance user is required.");
  const prepared = prepareAmgTransactions(request.rows);
  const report = emptyReport("imported");
  report.sourceRows = request.rows.length;
  report.skipped = prepared.skipped.length;
  report.skipReasons = prepared.skipReasons;
  report.sourceGross = prepared.sourceGross.toString();
  report.sourceSettlement = prepared.sourceSettlement.toString();

  const settings = await db.select().from(financeSettings).where(eq(financeSettings.companyId, amgTransactionCompanyId)).limit(1);
  if (!settings[0]) return { ...report, status: "refused", reason: "Finance settings are not configured for this company." };
  const accounts = await db.select().from(financeChartAccounts).where(eq(financeChartAccounts.companyId, amgTransactionCompanyId));
  const chart = new Map(accounts.map((account) => [account.accountCode, account]));
  const guest = chart.get(amgGuestLedgerAccount);
  if (!guest || guest.active !== "Y" || guest.accountType !== "Asset") {
    return { ...report, status: "refused", reason: "AMG guest ledger 1020 is not an active asset account." };
  }

  const accepted: PreparedJournal[] = [];
  for (const journal of prepared.journals) {
    const debit = chart.get(journal.debitAccount);
    const credit = chart.get(journal.creditAccount);
    const debitOk = debit?.active === "Y" && debit.accountType === "Asset";
    const creditOk = credit?.active === "Y" && (journal.sourceType === "REVENUE" ? credit.accountType === "Revenue" : credit.accountCode === amgGuestLedgerAccount);
    if (!debitOk || !creditOk) {
      report.skipped += 1;
      note(report.skipReasons, "missing_account");
      continue;
    }
    accepted.push(journal);
  }

  const debitTotals: Record<string, bigint> = {};
  const creditTotals: Record<string, bigint> = {};
  const periodTotals: Record<string, bigint> = {};
  let loadedAmount = BigInt(0);

  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ sourceReference: atriumDraftJournals.sourceReference })
      .from(atriumDraftJournals)
      .where(and(eq(atriumDraftJournals.companyId, amgTransactionCompanyId), like(atriumDraftJournals.sourceReference, "AMG|ABS|%")));
    const loadedKeys = new Set(existing.map((row) => row.sourceReference));
    for (const journal of accepted) {
      if (loadedKeys.has(journal.externalId)) {
        report.alreadyLoaded += 1;
        continue;
      }
      const parsedAmount = parseMoney(journal.amount.toString(), 2);
      if (!parsedAmount.ok) throw new Error("Draft amount is not a whole rupiah value.");
      const amount = parsedAmount.canonical;
      await tx.insert(atriumDraftJournals).values({
        companyId: amgTransactionCompanyId,
        journalId: journal.journalId,
        journalDate: journal.journalDate,
        period: journal.period,
        status: "DRAFT",
        sourceType: journal.sourceType,
        sourceReference: journal.externalId,
        createdBy,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(atriumDraftJournalLines).values([
        {
          companyId: amgTransactionCompanyId,
          journalId: journal.journalId,
          lineNo: 1,
          accountCode: journal.debitAccount,
          departmentCode: null,
          debit: amount,
          credit: formatUnits(BigInt(0), 2),
          description: journal.description,
          createdAt: now,
        },
        {
          companyId: amgTransactionCompanyId,
          journalId: journal.journalId,
          lineNo: 2,
          accountCode: journal.creditAccount,
          departmentCode: null,
          debit: formatUnits(BigInt(0), 2),
          credit: amount,
          description: journal.description,
          createdAt: now,
        },
      ]);
      loadedKeys.add(journal.externalId);
      report.loaded += 1;
      loadedAmount += journal.amount;
      addAmount(debitTotals, journal.debitAccount, journal.amount);
      addAmount(creditTotals, journal.creditAccount, journal.amount);
      addAmount(periodTotals, journal.period, journal.amount);
    }
    if (report.loaded > 0) {
      await writeAudit(tx, {
        eventType: "authorization_allowed",
        userId: request.userId,
        companyId: amgTransactionCompanyId,
        resourceType: "atrium_draft_journal",
        resourceId: "amg-abs-batch",
        emailFingerprint: null,
        ip: null,
        metadata: { module: "finance", action: "amg_transactions_imported", imported: report.loaded, skipped: report.skipped, already: report.alreadyLoaded },
        createdAt: now,
      });
    }
  });

  report.loadedAmount = loadedAmount.toString();
  report.debitByAccount = textTotals(debitTotals);
  report.creditByAccount = textTotals(creditTotals);
  report.loadedByPeriod = textTotals(periodTotals);
  return report;
}
