import assert from "node:assert/strict";
import { test } from "node:test";
import { authorize } from "@wolf/shared";
import { revokeSession } from "../auth/session";
import { grants, memberships, users } from "../db/schema";
import { ensureTenant } from "../db/tenant";
import type { AuthDatabase } from "../db/types";
import { signIn, withDb } from "../test/harness";
import { decideTrustedRecord, loadOwnerPrivateView, loadTrustedActor, toActor } from "./trusted";

const started = new Date("2026-10-22T00:00:00.000Z");

async function addUser(db: AuthDatabase, email: string) {
  const row = (await db.insert(users).values({ emailNormalized: email, status: "active" }).returning())[0];
  if (!row) throw new Error("User was not stored.");
  return row;
}

async function addMembership(
  db: AuthDatabase,
  userId: string,
  companyId: string,
  departmentId: string | null,
  role: "staff" | "administrator" | "owner",
  status = "active",
) {
  await ensureTenant(db, companyId, departmentId);
  await db.insert(memberships).values({ userId, companyId, departmentId, role, status });
}

test("a session without a membership is denied, and a missing cookie stays signed out", async () => {
  await withDb(async (db) => {
    const person = await addUser(db, "person@wolf-command.test");
    const verified = await signIn(db, person.emailNormalized, started);
    assert.equal((await loadOwnerPrivateView(db, null, started)).state, "signed_out");
    const view = await loadOwnerPrivateView(db, verified.sessionToken, started);
    assert.equal(view.state, "denied");
    const actor = await loadTrustedActor(db, person.id);
    assert.deepEqual(actor?.memberships, []);
    assert.equal(decideTrustedRecord(actor, "read", { companyId: "company-a" }).reason.code, "wrong_company");
  });
});

test("staff, administrator, and owner roles do not grant Owner Private access", async () => {
  await withDb(async (db) => {
    for (const role of ["staff", "administrator", "owner"] as const) {
      const email = `${role}@wolf-command.test`;
      const person = await addUser(db, email);
      await addMembership(db, person.id, "company-a", null, role);
      const verified = await signIn(db, email, started);
      const view = await loadOwnerPrivateView(db, verified.sessionToken, started);
      assert.equal(view.state, "denied");
      if (view.state === "denied") assert.equal(view.reason, "owner_private_grant_required");
      const actor = await loadTrustedActor(db, person.id);
      assert.equal(actor?.memberships[0]?.role, role);
      assert.notEqual(actor?.memberships[0]?.role, "forged-owner");
    }
  });
});

test("an explicit Owner Private grant allows only its stored company", async () => {
  await withDb(async (db) => {
    const person = await addUser(db, "grant@wolf-command.test");
    await addMembership(db, person.id, "company-a", "finance", "staff");
    await db.insert(grants).values({
      userId: person.id,
      grantType: "owner_private",
      companyId: "company-a",
      scope: null,
      departmentId: null,
    });
    const verified = await signIn(db, person.emailNormalized, started);
    const view = await loadOwnerPrivateView(db, verified.sessionToken, started);
    assert.equal(view.state, "allowed");
    if (view.state === "allowed") assert.equal(view.companyId, "company-a");
    const actor = await loadTrustedActor(db, person.id);
    assert.equal(
      authorize({ actor, action: "read", resource: { kind: "owner_private", companyId: "company-b" } }).outcome,
      "deny",
    );
    assert.equal((await loadOwnerPrivateView(db, "forged-session-token", started)).state, "signed_out");
    assert.equal((await loadOwnerPrivateView(db, verified.sessionToken, verified.expiresAt)).state, "signed_out");
    await revokeSession(db, verified.sessionToken, started);
    assert.equal((await loadOwnerPrivateView(db, verified.sessionToken, started)).state, "signed_out");
  });
});

test("membership does not cross companies or departments, and a disabled membership is ignored", async () => {
  await withDb(async (db) => {
    const person = await addUser(db, "staff@wolf-command.test");
    await addMembership(db, person.id, "company-a", "finance", "staff");
    await addMembership(db, person.id, "company-a", "hr", "staff", "disabled");
    const actor = await loadTrustedActor(db, person.id);
    assert.equal(decideTrustedRecord(actor, "read", { companyId: "company-a", departmentId: "finance" }).outcome, "allow");
    assert.equal(
      decideTrustedRecord(actor, "read", { companyId: "company-a", departmentId: "hr" }).reason.code,
      "outside_department",
    );
    assert.equal(
      decideTrustedRecord(actor, "read", { companyId: "company-b", departmentId: "finance" }).reason.code,
      "wrong_company",
    );

    const wide = await addUser(db, "wide@wolf-command.test");
    await addMembership(db, wide.id, "company-a", null, "staff");
    const wideActor = await loadTrustedActor(db, wide.id);
    assert.equal(decideTrustedRecord(wideActor, "read", { companyId: "company-a", departmentId: "hr" }).outcome, "allow");
    assert.equal(actor?.memberships.length, 1);
  });
});

test("view and edit do not grant approval, and an access grant does not approve Owner Private", async () => {
  await withDb(async (db) => {
    const person = await addUser(db, "editor@wolf-command.test");
    await addMembership(db, person.id, "company-a", "finance", "administrator");
    await db.insert(grants).values({
      userId: person.id,
      grantType: "owner_private",
      companyId: "company-a",
      scope: null,
      departmentId: null,
    });
    const actor = await loadTrustedActor(db, person.id);
    const finance = { companyId: "company-a", departmentId: "finance" };
    assert.equal(decideTrustedRecord(actor, "read", finance).outcome, "allow");
    assert.equal(decideTrustedRecord(actor, "update", finance).outcome, "allow");
    assert.equal(decideTrustedRecord(actor, "approve", finance).reason.code, "approval_grant_required");
    assert.equal(
      authorize({
        actor,
        action: "approve",
        resource: { kind: "owner_private", companyId: "company-a" },
      }).reason.code,
      "approval_grant_required",
    );

    await ensureTenant(db, "company-a", "hr");
    await db.insert(grants).values({
      userId: person.id,
      grantType: "approve",
      companyId: "company-a",
      scope: "department",
      departmentId: "hr",
    });
    const approved = await loadTrustedActor(db, person.id);
    assert.equal(decideTrustedRecord(approved, "approve", finance).reason.code, "approval_grant_required");
    assert.equal(
      decideTrustedRecord(approved, "approve", { companyId: "company-a", departmentId: "hr" }).outcome,
      "allow",
    );
    assert.equal(approved?.userId, person.id);
  });
});

test("browser-supplied role and grant labels are not memberships", () => {
  const actor = toActor(
    "user-1",
    [
      { status: "active", role: "superuser", companyId: "company-a", departmentId: null },
      { status: "disabled", role: "owner", companyId: "company-a", departmentId: null },
    ],
    [{ grantType: "browser", companyId: "company-b", scope: null, departmentId: null }],
  );
  assert.deepEqual(actor.memberships, []);
  assert.deepEqual(actor.grants, []);
  assert.equal(decideTrustedRecord(actor, "read", { companyId: "company-b" }).reason.code, "wrong_company");
});
