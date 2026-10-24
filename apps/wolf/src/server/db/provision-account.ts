import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { provisionAccount, setTemporaryPassword } from "../auth/provision";
import { provisionCreatedOutput, provisionResetOutput } from "./command-output";
import { resolveDevelopmentDatabaseTarget } from "./database-target";
import { loadWolfEnvFile } from "./load-env";
import * as schema from "./schema";
import type { AuthDatabase } from "./types";

async function main(): Promise<void> {
  loadWolfEnvFile(process.env);
  if (process.env.WOLF_ALLOW_ACCOUNT_PROVISION !== "1") {
    console.error("Set WOLF_ALLOW_ACCOUNT_PROVISION=1 to provision or reset an account.");
    process.exitCode = 1;
    return;
  }
  const target = resolveDevelopmentDatabaseTarget(process.env);
  if (!target.ok) {
    console.error(target.message);
    process.exitCode = 1;
    return;
  }

  const email = process.env.WOLF_PROVISION_EMAIL ?? "";
  const temporaryPassword = process.env.WOLF_PROVISION_PASSWORD ?? "";
  const mode = process.env.WOLF_PROVISION_MODE === "reset" ? "reset" : "create";
  const sql = postgres(target.databaseUrl, { max: 1, prepare: false });
  const db = drizzle({ client: sql, schema }) as unknown as AuthDatabase;
  try {
    const now = new Date();
    if (mode === "reset") {
      const result = await setTemporaryPassword(db, { email, temporaryPassword, now });
      if (result.status !== "updated") {
        console.error(`Reset did not complete (${result.status}).`);
        process.exitCode = 1;
        return;
      }
      console.log(provisionResetOutput(email));
      return;
    }

    const result = await provisionAccount(db, {
      email,
      temporaryPassword,
      now,
      mustChangePassword: true,
      companyId: process.env.WOLF_PROVISION_COMPANY ?? null,
      departmentId: process.env.WOLF_PROVISION_DEPARTMENT ?? null,
      role: process.env.WOLF_PROVISION_ROLE ?? null,
      ownerPrivate: process.env.WOLF_PROVISION_OWNER_PRIVATE === "1",
    });
    if (result.status !== "created") {
      console.error(`Account was not created (${result.status}).`);
      process.exitCode = 1;
      return;
    }
    console.log(provisionCreatedOutput(email));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("provision-account.ts")) {
  void main().catch(() => {
    console.error("Provisioning failed.");
    process.exitCode = 1;
  });
}
