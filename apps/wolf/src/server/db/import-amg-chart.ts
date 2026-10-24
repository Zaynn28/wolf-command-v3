import { readFileSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { importAmgChartAccounts, readChartExport, reconcileChartAccounts } from "../finance/import-amg-chart";
import { parseChartAccount, readChartAccounts } from "../finance/chart-accounts";
import { resolveDevelopmentDatabaseTarget } from "./database-target";
import { loadWolfEnvFile } from "./load-env";
import { platformOperators } from "./schema";
import * as schema from "./schema";
import type { AuthDatabase } from "./types";

type ImportClient = {
  db: AuthDatabase;
  end(): Promise<unknown>;
};

export async function runAmgChartImportCommand(
  env: Record<string, string | undefined>,
  filePath: string | undefined,
  readFile: (path: string) => string,
  open: (databaseUrl: string) => ImportClient,
  report: (message: string) => void = console.error,
): Promise<number> {
  loadWolfEnvFile(env);
  if (env.WOLF_ALLOW_AMG_CHART_IMPORT !== "1") {
    report("Set WOLF_ALLOW_AMG_CHART_IMPORT=1 to import the local AMG chart.");
    return 1;
  }
  const target = resolveDevelopmentDatabaseTarget(env);
  if (!target.ok) {
    report(target.message);
    return 1;
  }
  if (!filePath) {
    report("Provide the local AMG chart export path.");
    return 1;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFile(filePath)) as unknown;
  } catch {
    report("The AMG chart export could not be read.");
    return 1;
  }
  const exported = readChartExport(parsed);
  if (!exported.ok) {
    report(exported.reason);
    return 1;
  }

  const sql = open(target.databaseUrl);
  try {
    const operators = await sql.db.select().from(platformOperators);
    const operator = operators.length === 1 ? operators[0] : null;
    if (!operator) {
      report("A single local platform operator is required before the AMG chart import.");
      return 1;
    }
    const result = await importAmgChartAccounts(
      sql.db,
      { companyId: "amg", userId: operator.userId, accounts: exported.accounts },
      new Date(),
    );
    report(
      `AMG chart import ${result.status}. Source ${result.sourceCount}, imported ${result.importedCount}, skipped ${result.skippedCount}, conflicts ${result.conflictCount}, rejected ${result.rejected.length}.`,
    );
    for (const rejected of result.rejected) report(`Rejected ${rejected.account_code}: ${rejected.reason}`);
    for (const conflict of result.conflicts) report(`Conflict ${conflict.account_code}: ${conflict.fields.join(", ")}`);
    if (result.status !== "imported" || result.conflictCount > 0) return 1;

    const actor = { userId: operator.userId, memberships: [{ companyId: "amg", departmentId: null, role: "administrator" as const }], grants: [] };
    const stored = await readChartAccounts(sql.db, actor, "amg");
    const source = exported.accounts.flatMap((account) => {
      const parsedAccount = parseChartAccount(account);
      return parsedAccount ? [parsedAccount] : [];
    });
    if (stored.status !== "ready") {
      report("The imported AMG chart could not be read back.");
      return 1;
    }
    const reconciliation = reconcileChartAccounts(source, stored.accounts);
    report(`AMG chart reconciliation ${reconciliation.matched ? "matched" : "did not match"}. Source ${reconciliation.sourceCount}, stored ${reconciliation.storedCount}.`);
    return reconciliation.matched ? 0 : 1;
  } catch {
    report("AMG chart import failed.");
    return 1;
  } finally {
    await sql.end();
  }
}

async function main(): Promise<void> {
  const code = await runAmgChartImportCommand(process.env, process.argv[2], (path) => readFileSync(path, "utf8"), (databaseUrl) => {
    const sql = postgres(databaseUrl, { max: 1, prepare: false });
    return {
      db: drizzle({ client: sql, schema }) as unknown as AuthDatabase,
      end: () => sql.end({ timeout: 5 }),
    };
  });
  process.exitCode = code;
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("import-amg-chart.ts")) {
  void main().catch(() => {
    console.error("AMG chart import failed.");
    process.exitCode = 1;
  });
}
