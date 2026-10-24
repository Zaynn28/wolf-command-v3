import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { sessions, users } from "../db/schema";
import { signIn, withDb } from "../test/harness";
import { authDefaults } from "./constants";
import { hashSessionToken } from "./crypto";
import { readSession, revokeSession } from "./session";

const email = "person@wolf-command.test";
const started = new Date("2026-10-22T00:00:00.000Z");

test("a verified session can be read, and missing or forged cookies cannot", async () => {
  await withDb(async (db) => {
    const user = (await db.insert(users).values({ emailNormalized: email, status: "active" }).returning())[0];
    const verified = await signIn(db, email, started);
    const session = await readSession(db, verified.sessionToken, started);
    assert.equal(session?.userId, user?.id);
    assert.equal(session?.email, email);
    assert.equal(await readSession(db, null, started), null);
    assert.equal(await readSession(db, `${verified.sessionToken}x`, started), null);
    const stored = await db.select().from(sessions);
    assert.equal(stored[0]?.tokenHash, hashSessionToken(verified.sessionToken));
    assert.equal(stored.some((row) => Object.values(row).includes(verified.sessionToken)), false);
    const later = new Date(started.getTime() + 60_000);
    const seen = await readSession(db, verified.sessionToken, later);
    assert.equal(seen?.sessionId, session?.sessionId);
    const row = await db.select().from(sessions).where(eq(sessions.id, session?.sessionId ?? ""));
    assert.equal(new Date(row[0]?.lastSeenAt ?? 0).toISOString(), later.toISOString());
  });
});

test("expired, revoked, and disabled sessions stop working", async () => {
  await withDb(async (db) => {
    const user = (await db.insert(users).values({ emailNormalized: email, status: "active" }).returning())[0];
    assert.ok(user);
    const verified = await signIn(db, email, started);
    const beforeExpiry = new Date(verified.expiresAt.getTime() - 1);
    assert.equal((await readSession(db, verified.sessionToken, beforeExpiry))?.userId, user.id);
    assert.equal(await readSession(db, verified.sessionToken, verified.expiresAt), null);
    assert.equal((await readSession(db, verified.sessionToken, beforeExpiry))?.userId, user.id);

    await revokeSession(db, verified.sessionToken, started);
    assert.equal(await readSession(db, verified.sessionToken, beforeExpiry), null);
    await revokeSession(db, null, started);

    const replacement = await signIn(db, email, new Date(started.getTime() + 1_000));
    await db.update(users).set({ status: "disabled" }).where(eq(users.id, user.id));
    assert.equal(await readSession(db, replacement.sessionToken, new Date(started.getTime() + 1_000)), null);
    assert.equal(authDefaults.sessionTtlMs, 12 * 60 * 60 * 1000);
  });
});
