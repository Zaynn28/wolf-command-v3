import postgres from "postgres";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { normalizeEmail } from "../auth/crypto";
import { provisionAccount } from "../auth/provision";
import { resolveDevelopmentDatabaseTarget } from "./database-target";
import { loadWolfEnvFile } from "./load-env";
import * as schema from "./schema";
import { platformOperators, users } from "./schema";
import type { AuthDatabase } from "./types";

export function bootstrapAllowed(env: Record<string, string | undefined>): { ok: true } | { ok: false; message: string } {
  if (env.NODE_ENV === "production") return { ok: false, message: "Bootstrap is refused in production." };
  if (env.WOLF_ALLOW_DEV_BOOTSTRAP !== "1") {
    return { ok: false, message: "Set WOLF_ALLOW_DEV_BOOTSTRAP=1 to record a local operator." };
  }
  return { ok: true };
}

async function main(): Promise<void> {
  loadWolfEnvFile(process.env);
  const allowed = bootstrapAllowed(process.env);
  if (!allowed.ok) {
    console.error(allowed.message);
    process.exitCode = 1;
    return;
  }
  const target = resolveDevelopmentDatabaseTarget(process.env);
  if (!target.ok) {
    console.error(target.message);
    process.exitCode = 1;
    return;
  }
  const email = normalizeEmail(process.env.WOLF_BOOTSTRAP_EMAIL ?? "") ?? "";
  const temporaryPassword = process.env.WOLF_BOOTSTRAP_PASSWORD ?? "";
  if (!email) {
    console.error("Bootstrap did not complete (validation).");
    process.exitCode = 1;
    return;
  }
  const sql = postgres(target.databaseUrl, { max: 1, prepare: false });
  const db = drizzle({ client: sql, schema }) as unknown as AuthDatabase;
  try {
    const existing = await db.select({ total: count() }).from(platformOperators);
    if ((existing[0]?.total ?? 0) > 0) {
      console.error("Bootstrap did not complete (operator-exists).");
      process.exitCode = 1;
      return;
    }
    const created = await provisionAccount(db, {
      email,
      temporaryPassword,
      now: new Date(),
      mustChangePassword: true,
    });
    if (created.status === "validation") {
      console.error("Bootstrap did not complete (validation).");
      process.exitCode = 1;
      return;
    }
    const userId =
      created.status === "created"
        ? created.userId
        : ((await db.select({ id: users.id }).from(users).where(eq(users.emailNormalized, email)).limit(1))[0]?.id ?? "");
    if (!userId) {
      console.error("Bootstrap did not complete (validation).");
      process.exitCode = 1;
      return;
    }
    await db.insert(platformOperators).values({ userId, createdAt: new Date() });
    console.log(`Local operator recorded for ${email}. The password was not printed.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("bootstrap-operator.ts")) {
  void main().catch(() => {
    console.error("Bootstrap failed.");
    process.exitCode = 1;
  });
}
