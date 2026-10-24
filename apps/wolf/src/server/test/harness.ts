import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { loginWithPassword } from "../auth/login";
import { hashPassword } from "../auth/password";
import { applySchemaSql } from "../db/apply-schema";
import * as schema from "../db/schema";
import { users } from "../db/schema";
import type { AuthDatabase } from "../db/types";

export const testPassword = "local-wolf-test-password";

let cachedHash: Promise<string> | null = null;

export function testPasswordHash(): Promise<string> {
  cachedHash ??= hashPassword(testPassword);
  return cachedHash;
}

export function manualClock(start: string) {
  let current = new Date(start);
  return {
    now: () => new Date(current.getTime()),
    set(next: Date) {
      current = new Date(next.getTime());
    },
  };
}

export async function withDb(run: (db: AuthDatabase) => Promise<void>): Promise<void> {
  const client = new PGlite();
  await applySchemaSql((statement) => client.exec(statement));
  try {
    await run(drizzle({ client, schema }));
  } finally {
    await client.close();
  }
}

export async function signIn(db: AuthDatabase, email: string, now = new Date("2026-10-22T00:00:00.000Z")) {
  const existing = await db.select().from(users).where(eq(users.emailNormalized, email)).limit(1);
  const user = existing[0];
  if (!user) throw new Error("Sign-in user was not stored.");
  if (!user.passwordHash) {
    await db.update(users).set({ passwordHash: await testPasswordHash() }).where(eq(users.id, user.id));
  }
  const verified = await loginWithPassword(
    { db, now: () => now },
    { email, password: testPassword, ip: null },
  );
  assert.equal(verified.status, "verified");
  if (verified.status !== "verified") throw new Error("Sign-in did not create a session.");
  return verified;
}
