import { and, eq, isNull, ne } from "drizzle-orm";
import { sessions, users } from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { writeAudit } from "./audit";
import { generateSessionToken, hashSessionToken } from "./crypto";

export type ActiveSession = {
  sessionId: string;
  userId: string;
  email: string;
  expiresAt: Date;
  mustChangePassword: boolean;
};

export function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export async function insertSession(
  db: AuthDatabase,
  input: { userId: string; now: Date; ttlMs: number },
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(input.now.getTime() + input.ttlMs);
  await db.insert(sessions).values({
    userId: input.userId,
    tokenHash: hashSessionToken(token),
    expiresAt,
    createdAt: input.now,
    lastSeenAt: input.now,
  });
  return { token, expiresAt };
}

export async function readSession(
  db: AuthDatabase,
  token: string | null,
  now: Date,
): Promise<ActiveSession | null> {
  if (!token) return null;
  const rows = await db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      email: users.emailNormalized,
      status: users.status,
      mustChangePassword: users.mustChangePassword,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashSessionToken(token)))
    .limit(1);
  const row = rows[0];
  if (!row || row.status !== "active" || row.revokedAt) return null;
  const expiresAt = asDate(row.expiresAt);
  if (expiresAt.getTime() <= now.getTime()) return null;
  await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
  return {
    sessionId: row.sessionId,
    userId: row.userId,
    email: row.email,
    expiresAt,
    mustChangePassword: row.mustChangePassword,
  };
}

export async function revokeOtherSessions(
  db: AuthDatabase,
  userId: string,
  keepSessionId: string,
  now: Date,
): Promise<void> {
  const updated = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  if (updated.length === 0) return;
  await writeAudit(db, {
    eventType: "session_revoked",
    userId,
    emailFingerprint: null,
    ip: null,
    metadata: { revoked: updated.length },
    createdAt: now,
  });
}

export async function revokeUserSessions(db: AuthDatabase, userId: string, now: Date): Promise<void> {
  const updated = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  if (updated.length === 0) return;
  await writeAudit(db, {
    eventType: "session_revoked",
    userId,
    emailFingerprint: null,
    ip: null,
    metadata: { revoked: updated.length },
    createdAt: now,
  });
}

export async function revokeSession(db: AuthDatabase, token: string | null, now: Date): Promise<void> {
  if (!token) return;
  const updated = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.tokenHash, hashSessionToken(token)), isNull(sessions.revokedAt)))
    .returning({ userId: sessions.userId });
  if (updated.length !== 1) return;
  await writeAudit(db, {
    eventType: "session_revoked",
    userId: updated[0].userId,
    emailFingerprint: null,
    ip: null,
    metadata: {},
    createdAt: now,
  });
}
