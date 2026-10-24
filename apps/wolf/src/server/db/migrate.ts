import postgres from "postgres";
import { applySchemaSql } from "./apply-schema";
import { resolveDevelopmentDatabaseTarget } from "./database-target";
import { loadWolfEnvFile } from "./load-env";

export type MigrationConnection = {
  unsafe(statement: string): Promise<unknown>;
};

export type MigrationClient = {
  begin(run: (tx: MigrationConnection) => Promise<void>): Promise<unknown>;
  end(): Promise<unknown>;
};

export async function applyMigrationStatements(sql: Pick<MigrationClient, "begin">): Promise<void> {
  await sql.begin(async (tx) => {
    await applySchemaSql(async (statement) => {
      await tx.unsafe(statement);
    });
  });
}

export async function runMigrationCommand(
  env: Record<string, string | undefined>,
  open: (databaseUrl: string) => MigrationClient,
  report: (message: string) => void = console.error,
): Promise<number> {
  loadWolfEnvFile(env);
  const target = resolveDevelopmentDatabaseTarget(env);
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
  const code = await runMigrationCommand(process.env, (databaseUrl) => {
    const sql = postgres(databaseUrl, { max: 1, prepare: false });
    return {
      begin: (run) => sql.begin(run),
      end: () => sql.end({ timeout: 5 }),
    };
  });
  process.exitCode = code;
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("migrate.ts")) {
  void main().catch(() => {
    console.error("Migration failed.");
    process.exitCode = 1;
  });
}
