import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { seedOrganizationDemo } from "../organization/seed";
import { resolveDevelopmentDatabaseTarget } from "./database-target";
import { loadWolfEnvFile } from "./load-env";
import * as schema from "./schema";
import type { AuthDatabase } from "./types";

async function main(): Promise<void> {
  loadWolfEnvFile(process.env);
  if (process.env.WOLF_ALLOW_DEV_SEED !== "1") {
    console.error("Set WOLF_ALLOW_DEV_SEED=1 to run the organization demo seed.");
    process.exitCode = 1;
    return;
  }
  const target = resolveDevelopmentDatabaseTarget(process.env);
  if (!target.ok) {
    console.error(target.message);
    process.exitCode = 1;
    return;
  }
  const sql = postgres(target.databaseUrl, { max: 1, prepare: false });
  const db = drizzle({ client: sql, schema }) as unknown as AuthDatabase;
  try {
    const result = await seedOrganizationDemo(db);
    console.log(`Organization demo seed updated ${result.people} demo people and ${result.tasks} demo tasks.`);
    if (result.skippedCompanies.length > 0) {
      console.log(`Skipped companies that are not in Wolf: ${result.skippedCompanies.join(", ")}.`);
    }
  } catch {
    console.error("Organization demo seed failed.");
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("seed-organization-demo.ts")) {
  void main();
}
