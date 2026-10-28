import postgres from "postgres";
import { applyMigrationStatements } from "./migrate";
import { loadWolfEnvFile } from "./load-env";
import { postgresHostOverride, resolveRuntimeDatabaseTarget } from "./runtime-database";
import type { MigrationClient } from "./migrate";

export async function runProductionMigrationCommand(
  env: Record<string, string | undefined>,
  open: (databaseUrl: string) => MigrationClient,
  report: (message: string) => void = console.error,
): Promise<number> {
  if (env.NODE_ENV !== "production" || env.WOLF_ALLOW_PRODUCTION_MIGRATE !== "1") {
    report("Refusing database command. Production migration is not enabled.");
    return 1;
  }
  loadWolfEnvFile(env);
  const target = resolveRuntimeDatabaseTarget({ DATABASE_URL: env.DATABASE_URL, NODE_ENV: "production" });
  if (!target.ok) {
    report(target.message);
    return 1;
  }

  const sql = open(target.databaseUrl);
  try {
    await applyMigrationStatements(sql);
    return 0;
  } catch {
    report("Migration failed.");
    return 1;
  } finally {
    await sql.end();
  }
}

async function main(): Promise<void> {
  const code = await runProductionMigrationCommand(process.env, (databaseUrl) => {
    const sql = postgres(databaseUrl, { max: 1, prepare: false, ...postgresHostOverride(databaseUrl) });
    return {
      begin: (run) => sql.begin(run),
      end: () => sql.end({ timeout: 5 }),
    };
  });
  process.exitCode = code;
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("migrate-production.ts")) {
  void main().catch(() => {
    console.error("Migration failed.");
    process.exitCode = 1;
  });
}
