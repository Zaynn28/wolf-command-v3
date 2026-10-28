import { execFile } from "node:child_process";
import { promisify } from "node:util";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { importAmgTransactions, type AbsTransactionRow } from "../finance/import-amg-transactions";
import { resolveDevelopmentDatabaseTarget } from "./database-target";
import { loadWolfEnvFile } from "./load-env";
import { platformOperators, users } from "./schema";
import * as schema from "./schema";
import type { AuthDatabase } from "./types";

const execFileAsync = promisify(execFile);

type ImportClient = {
  db: AuthDatabase;
  end(): Promise<unknown>;
};

const reader = `
import json, sys
from decimal import Decimal
from openpyxl import load_workbook

required = ["Transaction Date", "Charge", "Extra Charge Type", "Market Segment", "Settlement/Particular", "Reference #", "Gross Amount", "Settlement Amount", "Folio Status", "Reservation #", "Folio #", "Invoice #", "Room #", "Qty", "Net Amount", "Discount Amount", "Taxable Amount"]

def amount(value):
    if value is None or value == "":
        return ""
    if isinstance(value, bool):
        return "invalid"
    try:
        number = Decimal(str(value))
    except Exception:
        return "invalid"
    if number != number.to_integral_value():
        return "invalid"
    return str(int(number))

def text(value):
    if value is None:
        return ""
    return str(value).strip()

def day(value):
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    raw = text(value)
    return raw[:10] if len(raw) >= 10 and raw[4:5] == "-" else raw

def stamp(path):
    name = path.rsplit("/", 1)[-1]
    marker = "_ABS_"
    first = name.find(marker)
    second = name.find(marker, first + 1) if first >= 0 else -1
    if first < 0 or second < 0 or not name.endswith(".xlsx"):
        raise SystemExit("An ABS transaction workbook name is not valid.")
    abs_id = name[first + len(marker):second]
    tail = name[second + len(marker):-5]
    return abs_id, tail

rows = []
for path in sys.argv[1:]:
    abs_id, file_stamp = stamp(path)
    book = load_workbook(path, read_only=True, data_only=True)
    sheet = book[book.sheetnames[0]]
    table = sheet.iter_rows(values_only=True)
    header = next(table, None)
    if header is None:
        book.close()
        raise SystemExit("An ABS transaction workbook is empty.")
    names = [text(cell) for cell in header]
    missing = [name for name in required if name not in names]
    if missing:
        book.close()
        raise SystemExit("The workbook header does not match the ABS transaction detail report.")
    index = {name: names.index(name) for name in required}
    for excel_row, record in enumerate(table, start=2):
        if record is None or all(cell is None or cell == "" for cell in record):
            continue
        def cell(name, record=record):
            position = index[name]
            return record[position] if position < len(record) else None
        rows.append({
            "absId": abs_id,
            "fileStamp": file_stamp,
            "excelRow": excel_row,
            "reservation": text(cell("Reservation #")),
            "folio": text(cell("Folio #")),
            "invoice": text(cell("Invoice #")),
            "room": text(cell("Room #")),
            "charge": text(cell("Charge")),
            "extraChargeType": text(cell("Extra Charge Type")),
            "marketSegment": text(cell("Market Segment")),
            "settlementParticular": text(cell("Settlement/Particular")),
            "reference": text(cell("Reference #")),
            "transactionDate": day(cell("Transaction Date")),
            "quantity": amount(cell("Qty")),
            "netAmount": amount(cell("Net Amount")),
            "discountAmount": amount(cell("Discount Amount")),
            "taxableAmount": amount(cell("Taxable Amount")),
            "grossAmount": amount(cell("Gross Amount")),
            "settlementAmount": amount(cell("Settlement Amount")),
            "folioStatus": text(cell("Folio Status")),
        })
    book.close()
json.dump({"rows": rows}, sys.stdout)
`;

export function readAbsTransactionExport(input: unknown): { ok: true; rows: AbsTransactionRow[] } | { ok: false; reason: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, reason: "The ABS export could not be read." };
  const rows = (input as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return { ok: false, reason: "The ABS export could not be read." };
  const parsed: AbsTransactionRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return { ok: false, reason: "The ABS export could not be read." };
    const record = row as Record<string, unknown>;
    const excelRow = record.excelRow;
    if (typeof record.absId !== "string" || typeof record.fileStamp !== "string" || typeof excelRow !== "number") {
      return { ok: false, reason: "The ABS export could not be read." };
    }
    const text = (key: string) => (typeof record[key] === "string" ? record[key] : "");
    parsed.push({
      absId: record.absId,
      fileStamp: record.fileStamp,
      excelRow,
      reservation: text("reservation"),
      folio: text("folio"),
      invoice: text("invoice"),
      room: text("room"),
      charge: text("charge"),
      extraChargeType: text("extraChargeType"),
      marketSegment: text("marketSegment"),
      settlementParticular: text("settlementParticular"),
      reference: text("reference"),
      transactionDate: text("transactionDate"),
      quantity: text("quantity"),
      netAmount: text("netAmount"),
      discountAmount: text("discountAmount"),
      taxableAmount: text("taxableAmount"),
      grossAmount: text("grossAmount"),
      settlementAmount: text("settlementAmount"),
      folioStatus: text("folioStatus"),
    });
  }
  return { ok: true, rows: parsed };
}

async function readWorkbooks(paths: string[]): Promise<{ ok: true; rows: AbsTransactionRow[] } | { ok: false; reason: string }> {
  try {
    const result = await execFileAsync("python3", ["-c", reader, ...paths], { maxBuffer: 32 * 1024 * 1024 });
    return readAbsTransactionExport(JSON.parse(result.stdout) as unknown);
  } catch {
    return { ok: false, reason: "The ABS transaction workbooks could not be read." };
  }
}

export async function runAmgTransactionImportCommand(
  env: Record<string, string | undefined>,
  filePaths: string[],
  open: (databaseUrl: string) => ImportClient,
  readFiles: (paths: string[]) => Promise<{ ok: true; rows: AbsTransactionRow[] } | { ok: false; reason: string }> = readWorkbooks,
  report: (message: string) => void = console.error,
): Promise<number> {
  loadWolfEnvFile(env);
  if (env.WOLF_ALLOW_AMG_TRANSACTION_IMPORT !== "1") {
    report("Set WOLF_ALLOW_AMG_TRANSACTION_IMPORT=1 to import the local AMG transaction export.");
    return 1;
  }
  const target = resolveDevelopmentDatabaseTarget(env);
  if (!target.ok) {
    report(target.message);
    return 1;
  }
  if (filePaths.length === 0) {
    report("Provide the local AMG ABS transaction workbook paths.");
    return 1;
  }
  const exported = await readFiles(filePaths);
  if (!exported.ok) {
    report(exported.reason);
    return 1;
  }

  const sql = open(target.databaseUrl);
  try {
    const operators = await sql.db
      .select({ userId: platformOperators.userId, email: users.emailNormalized })
      .from(platformOperators)
      .innerJoin(users, eq(users.id, platformOperators.userId));
    const operator = operators.length === 1 ? operators[0] : null;
    if (!operator) {
      report("A single local platform operator is required before the AMG transaction import.");
      return 1;
    }
    const result = await importAmgTransactions(
      sql.db,
      { companyId: "amg", userId: operator.userId, createdBy: operator.email, rows: exported.rows },
      new Date(),
    );
    if (result.status !== "imported") {
      report(result.reason || "AMG transaction import was refused.");
      return 1;
    }
    report(
      `AMG transaction import loaded ${result.loaded}, already loaded ${result.alreadyLoaded}, skipped ${result.skipped}, source rows ${result.sourceRows}.`,
    );
    report(`Source gross ${result.sourceGross}. Source settlement ${result.sourceSettlement}. Loaded draft amount ${result.loadedAmount}.`);
    report(`Draft debits ${JSON.stringify(result.debitByAccount)}. Draft credits ${JSON.stringify(result.creditByAccount)}. Periods ${JSON.stringify(result.loadedByPeriod)}.`);
    const reasons = Object.entries(result.skipReasons).sort((left, right) => left[0].localeCompare(right[0]));
    for (const [reason, count] of reasons) report(`Skipped ${reason}: ${count}`);
    report("Draft journals were not posted. Idempotency key is AMG|ABS|{abs id}|{export stamp}|r{excel row} on company amg.");
    return 0;
  } catch {
    report("AMG transaction import failed.");
    return 1;
  } finally {
    await sql.end();
  }
}

async function main(): Promise<void> {
  const code = await runAmgTransactionImportCommand(process.env, process.argv.slice(2), (databaseUrl) => {
    const sql = postgres(databaseUrl, { max: 1, prepare: false });
    return {
      db: drizzle({ client: sql, schema }) as unknown as AuthDatabase,
      end: () => sql.end({ timeout: 5 }),
    };
  });
  process.exitCode = code;
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("import-amg-transactions.ts")) {
  void main().catch(() => {
    console.error("AMG transaction import failed.");
    process.exitCode = 1;
  });
}
