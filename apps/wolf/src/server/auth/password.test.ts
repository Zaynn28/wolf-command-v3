import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { auditEvents, grants, sessions, users } from "../db/schema";
import { devAccounts } from "../db/dev-accounts";
import { signIn, testPassword, testPasswordHash, withDb } from "../test/harness";
import { loadOwnerPrivateView } from "../access/trusted";
import { authDefaults } from "./constants";
import { changePassword, loginWithPassword } from "./login";
import { provisionAccount, setTemporaryPassword } from "./provision";
import { readSession } from "./session";

const started = new Date("2026-10-22T00:00:00.000Z");
const email = "person@wolf-command.test";

async function rejectionReason(db: Parameters<typeof loginWithPassword>[0]["db"]) {
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "login_rejected"));
  return rows.at(-1)?.metadata.reason;
}

test("a correct Wolf password creates a session and stores only an Argon2id hash", async () => {
  await withDb(async (db) => {
    await db.insert(users).values({ emailNormalized: email, status: "active", passwordHash: await testPasswordHash() });
    const before = await db.select().from(sessions);
    const verified = await loginWithPassword({ db, now: () => started }, { email, password: testPassword, ip: null });
    assert.equal(verified.status, "verified");
    if (verified.status !== "verified") return;
    const stored = await db.select().from(users);
    assert.match(stored[0]?.passwordHash ?? "", /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    assert.notEqual(stored[0]?.passwordHash, testPassword);
    assert.equal((stored[0]?.passwordHash ?? "").includes(testPassword), false);
    const sessionRows = await db.select().from(sessions);
    assert.equal(before.length, 0);
    assert.equal(sessionRows.length, 1);
    assert.equal(sessionRows.some((row) => Object.values(row).includes(verified.sessionToken)), false);
    const loginSource = readFileSync(new URL("./login.ts", import.meta.url), "utf8").toLowerCase();
    assert.equal(loginSource.includes("otp"), false);
    assert.equal(loginSource.includes("nodemailer"), false);
    assert.equal(loginSource.includes("smtp"), false);
  });
});

test("unknown, disabled, and wrong-password sign-ins return the same result and create no session", async () => {
  await withDb(async (db) => {
    await db.insert(users).values({ emailNormalized: email, status: "active", passwordHash: await testPasswordHash() });
    const unknown = await loginWithPassword(
      { db, now: () => started },
      { email: "missing@wolf-command.test", password: testPassword, ip: "203.0.113.10" },
    );
    const wrong = await loginWithPassword(
      { db, now: () => started },
      { email, password: "not-the-wolf-password", ip: "203.0.113.11" },
    );
    await db.update(users).set({ status: "disabled" }).where(eq(users.emailNormalized, email));
    const disabled = await loginWithPassword(
      { db, now: () => started },
      { email, password: testPassword, ip: "203.0.113.12" },
    );
    assert.deepEqual(unknown, { status: "invalid" });
    assert.deepEqual(wrong, { status: "invalid" });
    assert.deepEqual(disabled, { status: "invalid" });
    assert.equal(await rejectionReason(db), "disabled");
    const people = await db.select().from(users);
    assert.equal(people.length, 1);
    assert.equal((await db.select().from(sessions)).length, 0);
    await db.update(users).set({ status: "active" }).where(eq(users.emailNormalized, email));
    const verified = await signIn(db, email, new Date(started.getTime() + 1_000));
    await db.update(users).set({ status: "disabled" }).where(eq(users.emailNormalized, email));
    assert.equal(await readSession(db, verified.sessionToken, new Date(started.getTime() + 1_000)), null);
  });
});

test("login attempts are rate limited for known and unknown addresses", async () => {
  await withDb(async (db) => {
    await db.insert(users).values({ emailNormalized: email, status: "active", passwordHash: await testPasswordHash() });
    const limits = { loginLimitPerEmail: 2, loginLimitPerIp: 30 };
    const attempt = (address: string, ip: string) =>
      loginWithPassword({ db, now: () => started, limits }, { email: address, password: "not-the-wolf-password", ip });
    assert.equal((await attempt(email, "203.0.113.20")).status, "invalid");
    assert.equal((await attempt(email, "203.0.113.21")).status, "invalid");
    assert.equal((await attempt(email, "203.0.113.22")).status, "rate_limited");
    assert.equal((await attempt("missing@wolf-command.test", "203.0.113.23")).status, "invalid");
    assert.equal((await attempt("missing@wolf-command.test", "203.0.113.24")).status, "invalid");
    assert.equal((await attempt("missing@wolf-command.test", "203.0.113.25")).status, "rate_limited");
    const ipLimits = { loginLimitPerEmail: 10, loginLimitPerIp: 1 };
    assert.equal(
      (await loginWithPassword({ db, now: () => started, limits: ipLimits }, { email, password: "not-the-wolf-password", ip: "203.0.113.30" })).status,
      "invalid",
    );
    assert.equal(
      (await loginWithPassword(
        { db, now: () => started, limits: ipLimits },
        { email: "other@wolf-command.test", password: "not-the-wolf-password", ip: "203.0.113.30" },
      )).status,
      "rate_limited",
    );
  });
});

test("a temporary password must be changed and that change revokes other sessions", async () => {
  await withDb(async (db) => {
    const created = await provisionAccount(db, {
      email,
      temporaryPassword: "temporary-wolf-password",
      now: started,
      companyId: "company-a",
      role: "owner",
      ownerPrivate: true,
    });
    assert.equal(created.status, "created");
    const first = await loginWithPassword(
      { db, now: () => started },
      { email, password: "temporary-wolf-password", ip: null },
    );
    const second = await loginWithPassword(
      { db, now: () => new Date(started.getTime() + 1_000) },
      { email, password: "temporary-wolf-password", ip: null },
    );
    assert.equal(first.status, "verified");
    assert.equal(second.status, "verified");
    if (first.status !== "verified" || second.status !== "verified") return;
    assert.equal(first.mustChangePassword, true);
    const blocked = await loadOwnerPrivateView(db, first.sessionToken, started);
    assert.equal(blocked.state, "password_change_required");
    const changed = await changePassword(
      { db, now: () => new Date(started.getTime() + 2_000) },
      {
        token: first.sessionToken,
        currentPassword: "temporary-wolf-password",
        nextPassword: "replacement-wolf-password",
        confirmPassword: "replacement-wolf-password",
      },
    );
    assert.equal(changed.status, "changed");
    assert.equal(await readSession(db, second.sessionToken, new Date(started.getTime() + 2_000)), null);
    assert.equal((await readSession(db, first.sessionToken, new Date(started.getTime() + 2_000)))?.mustChangePassword, false);
    const allowed = await loadOwnerPrivateView(db, first.sessionToken, new Date(started.getTime() + 2_000));
    assert.equal(allowed.state, "allowed");
    const stored = await db.select().from(users);
    assert.equal((stored[0]?.passwordHash ?? "").includes("replacement-wolf-password"), false);
    assert.equal(await db.select().from(grants).then((rows) => rows.length), 1);
  });
});

test("an administrator reset replaces the hash without email and signs every session out", async () => {
  await withDb(async (db) => {
    await db.insert(users).values({ emailNormalized: email, status: "active", passwordHash: await testPasswordHash() });
    const verified = await signIn(db, email, started);
    const reset = await setTemporaryPassword(db, {
      email,
      temporaryPassword: "administrator-set-password",
      now: new Date(started.getTime() + 1_000),
    });
    assert.equal(reset.status, "updated");
    assert.equal(await readSession(db, verified.sessionToken, new Date(started.getTime() + 1_000)), null);
    const next = await loginWithPassword(
      { db, now: () => new Date(started.getTime() + 2_000) },
      { email, password: "administrator-set-password", ip: null },
    );
    assert.equal(next.status, "verified");
    if (next.status !== "verified") return;
    assert.equal(next.mustChangePassword, true);
    const wrongCurrent = await changePassword(
      { db, now: () => new Date(started.getTime() + 3_000) },
      {
        token: next.sessionToken,
        currentPassword: testPassword,
        nextPassword: "another-wolf-password",
        confirmPassword: "another-wolf-password",
      },
    );
    assert.equal(wrongCurrent.status, "invalid");
    assert.equal(authDefaults.passwordMinLength, 12);
    assert.equal(authDefaults.sessionTtlMs, 12 * 60 * 60 * 1000);
  });
});

test("development credentials stay out of the application screens", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const roots = [join(here, "../../app"), join(here, "../../components")];
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) visit(path);
      else files.push(path);
    }
  };
  roots.forEach(visit);
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
  for (const account of devAccounts) {
    assert.equal(source.includes(account.password), false, account.email);
  }
  const seed = readFileSync(join(here, "../db/seed-dev.ts"), "utf8");
  assert.match(seed, /resolveDevelopmentDatabaseTarget/);
  assert.doesNotMatch(seed, /console\.log\(`\$\{account\.email\} \$\{account\.password\}`\)/);
  const guard = readFileSync(join(here, "../db/database-target.ts"), "utf8");
  assert.match(guard, /NODE_ENV === "production"/);
  const doc = readFileSync(join(here, "../../../../../docs/local-development-accounts.md"), "utf8");
  assert.match(doc, /staff\.dev@wolf-command\.test/);
  assert.match(doc, /does not send email/);
});
