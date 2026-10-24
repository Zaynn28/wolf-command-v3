import { createHash } from "node:crypto";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { authAttempts, users } from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { writeAudit } from "./audit";
import { authDefaults, type AuthLimits } from "./constants";
import { fingerprintEmail, normalizeEmail } from "./crypto";
import { normalizeIp } from "./http";
import { dummyPasswordHash, hashPassword, verifyPassword } from "./password";
import { insertSession, readSession, revokeOtherSessions } from "./session";

export type LoginDeps = {
  db: AuthDatabase;
  now: () => Date;
  limits?: Partial<AuthLimits>;
};

export type LoginResult =
  | { status: "verified"; sessionToken: string; expiresAt: Date; userId: string; mustChangePassword: boolean }
  | { status: "invalid" }
  | { status: "rate_limited" }
  | { status: "validation" };

export type PasswordChangeResult = { status: "changed" } | { status: "unauthenticated" } | { status: "invalid" } | { status: "validation" };

function settings(deps: LoginDeps) {
  return { ...authDefaults, ...deps.limits };
}

function database(value: unknown): AuthDatabase {
  return value as AuthDatabase;
}

async function lockEmail(db: AuthDatabase, email: string): Promise<void> {
  const digest = createHash("sha256").update(email).digest();
  await db.execute(sql`select pg_advisory_xact_lock(${digest.readInt32BE(0)}, ${digest.readInt32BE(4)})`);
}

async function countAttempts(
  db: AuthDatabase,
  filter: { since: Date; email?: string; ip?: string },
): Promise<number> {
  const conditions = [eq(authAttempts.kind, "login"), gt(authAttempts.createdAt, filter.since)];
  if (filter.email) conditions.push(eq(authAttempts.emailNormalized, filter.email));
  if (filter.ip) conditions.push(eq(authAttempts.ip, filter.ip));
  const rows = await db
    .select({ value: count() })
    .from(authAttempts)
    .where(and(...conditions));
  return Number(rows[0]?.value ?? 0);
}

export async function loginWithPassword(
  deps: LoginDeps,
  input: { email: string; password: string; ip: string | null },
): Promise<LoginResult> {
  const email = normalizeEmail(input.email);
  if (!email) return { status: "validation" };
  if (input.password.length === 0 || input.password.length > authDefaults.passwordMaxLength) {
    return { status: "validation" };
  }

  const now = deps.now();
  const ip = normalizeIp(input.ip);
  const limits = settings(deps);
  const since = new Date(now.getTime() - limits.loginWindowMs);

  const outcome = await deps.db.transaction(async (tx) => {
    const db = database(tx);
    await lockEmail(db, email);
    const emailCount = await countAttempts(db, { email, since });
    const ipCount = ip ? await countAttempts(db, { ip, since }) : 0;
    if (emailCount >= limits.loginLimitPerEmail || (ip !== null && ipCount >= limits.loginLimitPerIp)) {
      await writeAudit(db, {
        eventType: "login_rate_limited",
        userId: null,
        emailFingerprint: fingerprintEmail(email),
        ip,
        metadata: { kind: "login" },
        createdAt: now,
      });
      return { kind: "limited" as const };
    }

    await db.insert(authAttempts).values({
      emailNormalized: email,
      ip,
      kind: "login",
      createdAt: now,
    });

    const rows = await db
      .select({
        id: users.id,
        status: users.status,
        passwordHash: users.passwordHash,
        mustChangePassword: users.mustChangePassword,
      })
      .from(users)
      .where(eq(users.emailNormalized, email))
      .limit(1);
    const user = rows[0] ?? null;
    const encodedHash = user?.passwordHash ?? (await dummyPasswordHash());
    const passwordOk = await verifyPassword(encodedHash, input.password);
    const canSignIn = Boolean(user && user.status === "active" && user.passwordHash && passwordOk);

    if (!user || !canSignIn) {
      const reason = !user ? "unknown" : user.status !== "active" ? "disabled" : !user.passwordHash ? "unprovisioned" : "mismatch";
      await writeAudit(db, {
        eventType: "login_rejected",
        userId: user?.id ?? null,
        emailFingerprint: fingerprintEmail(email),
        ip,
        metadata: { reason },
        createdAt: now,
      });
      return { kind: "invalid" as const };
    }

    const session = await insertSession(db, { userId: user.id, now, ttlMs: limits.sessionTtlMs });
    await writeAudit(db, {
      eventType: "login_succeeded",
      userId: user.id,
      emailFingerprint: fingerprintEmail(email),
      ip,
      metadata: { mustChange: user.mustChangePassword },
      createdAt: now,
    });
    await writeAudit(db, {
      eventType: "session_created",
      userId: user.id,
      emailFingerprint: null,
      ip,
      metadata: {},
      createdAt: now,
    });
    return {
      kind: "verified" as const,
      sessionToken: session.token,
      expiresAt: session.expiresAt,
      userId: user.id,
      mustChangePassword: user.mustChangePassword,
    };
  });

  if (outcome.kind === "limited") return { status: "rate_limited" };
  if (outcome.kind === "invalid") return { status: "invalid" };
  return {
    status: "verified",
    sessionToken: outcome.sessionToken,
    expiresAt: outcome.expiresAt,
    userId: outcome.userId,
    mustChangePassword: outcome.mustChangePassword,
  };
}

export async function changePassword(
  deps: LoginDeps,
  input: { token: string | null; currentPassword: string; nextPassword: string; confirmPassword: string },
): Promise<PasswordChangeResult> {
  if (input.nextPassword !== input.confirmPassword) return { status: "validation" };
  if (
    input.currentPassword.length === 0 ||
    input.currentPassword.length > authDefaults.passwordMaxLength ||
    input.nextPassword.length < authDefaults.passwordMinLength ||
    input.nextPassword.length > authDefaults.passwordMaxLength
  ) {
    return { status: "validation" };
  }

  const now = deps.now();
  const session = await readSession(deps.db, input.token, now);
  if (!session) return { status: "unauthenticated" };

  const rows = await deps.db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  const encodedHash = rows[0]?.passwordHash;
  if (!encodedHash) return { status: "invalid" };

  const currentOk = await verifyPassword(encodedHash, input.currentPassword);
  if (!currentOk) return { status: "invalid" };
  const samePassword = input.nextPassword === input.currentPassword || (await verifyPassword(encodedHash, input.nextPassword));
  if (samePassword) return { status: "validation" };

  const nextHash = await hashPassword(input.nextPassword);
  await deps.db
    .update(users)
    .set({ passwordHash: nextHash, mustChangePassword: false, updatedAt: now })
    .where(eq(users.id, session.userId));
  await revokeOtherSessions(deps.db, session.userId, session.sessionId, now);
  await writeAudit(deps.db, {
    eventType: "password_changed",
    userId: session.userId,
    emailFingerprint: null,
    ip: null,
    metadata: {},
    createdAt: now,
  });
  return { status: "changed" };
}
