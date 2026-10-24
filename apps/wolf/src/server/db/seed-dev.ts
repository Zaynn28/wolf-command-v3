import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { provisionAccount } from "../auth/provision";
import { seedReadyOutput } from "./command-output";
import { resolveDevelopmentDatabaseTarget } from "./database-target";
import { devAccounts } from "./dev-accounts";
import { loadWolfEnvFile } from "./load-env";
import * as schema from "./schema";
import type { AuthDatabase } from "./types";

async function main(): Promise<void> {
  loadWolfEnvFile(process.env);
  if (process.env.WOLF_ALLOW_DEV_SEED !== "1") {
    console.error("Set WOLF_ALLOW_DEV_SEED=1 to run the development-only seed.");
    process.exitCode = 1;
    return;
  }
  const target = resolveDevelopmentDatabaseTarget(process.env);
  if (!target.ok) {
    console.error(target.message);
    process.exitCode = 1;
    return;
  }
  if (devAccounts.some((account) => !account.email.endsWith(".test"))) {
    throw new Error("Development seed emails must use the .test domain.");
  }

  const sql = postgres(target.databaseUrl, { max: 1, prepare: false });
  const db = drizzle({ client: sql, schema }) as unknown as AuthDatabase;
  try {
    const emails = devAccounts.map((account) => account.email);
    await sql`delete from users where email_normalized in ${sql(emails)}`;
    const now = new Date();
    for (const account of devAccounts) {
      const result = await provisionAccount(db, {
        email: account.email,
        temporaryPassword: account.password,
        now,
        mustChangePassword: false,
        companyId: account.companyId,
        departmentId: account.departmentId,
        role: account.role,
        ownerPrivate: account.ownerPrivate,
      });
      if (result.status !== "created") {
        throw new Error(`Development account ${account.email} was not created.`);
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  console.log(seedReadyOutput(devAccounts));
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("seed-dev.ts")) {
  void main().catch(() => {
    console.error("Development seed failed.");
    process.exitCode = 1;
  });
}
