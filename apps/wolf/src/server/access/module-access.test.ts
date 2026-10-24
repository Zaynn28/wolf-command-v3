import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { revokeSession } from "../auth/session";
import { grants, memberships, users } from "../db/schema";
import { ensureTenant } from "../db/tenant";
import type { AuthDatabase } from "../db/types";
import { signIn, withDb } from "../test/harness";
import { authorizeProvisioning, evaluateModuleAccess } from "./matrix";
import { openModule, type OperationalRecord } from "./open-module";
import { handleRecordsRequest } from "./records-request";

const started = new Date("2026-10-22T00:00:00.000Z");

const records: OperationalRecord[] = [
  { id: "a-finance", module: "finance", companyId: "company-a", departmentId: "dev-finance", title: "Company A invoice" },
  { id: "a-hr", module: "hr", companyId: "company-a", departmentId: "dev-hr", title: "Company A person" },
  { id: "a-academy", module: "academy", companyId: "company-a", departmentId: null, title: "Company A lesson" },
  { id: "a-content", module: "content", companyId: "company-a", departmentId: "dev-content", title: "Company A draft" },
  { id: "b-finance", module: "finance", companyId: "company-b", departmentId: "dev-finance", title: "Company B invoice" },
  { id: "b-hr", module: "hr", companyId: "company-b", departmentId: "dev-hr", title: "Company B person" },
];

async function addUser(db: AuthDatabase, email: string, mustChangePassword = false) {
  const row = (
    await db.insert(users).values({ emailNormalized: email, status: "active", mustChangePassword }).returning()
  )[0];
  if (!row) throw new Error("User was not stored.");
  return row;
}

async function addMembership(
  db: AuthDatabase,
  userId: string,
  companyId: string,
  departmentId: string | null,
  role: "staff" | "administrator" | "owner",
) {
  await ensureTenant(db, companyId, departmentId);
  await db.insert(memberships).values({ userId, companyId, departmentId, role, status: "active" });
}

test("signed-out, invalid, expired, revoked, and disabled sessions cannot open a module", async () => {
  await withDb(async (db) => {
    const person = await addUser(db, "session@wolf-command.test");
    await addMembership(db, person.id, "company-a", "dev-finance", "staff");
    assert.equal((await openModule(db, null, started, "finance", "read", {})).state, "signed_out");
    assert.equal((await openModule(db, "forged-session-token", started, "finance", "read", {})).state, "signed_out");

    const verified = await signIn(db, person.emailNormalized, started);
    assert.equal((await openModule(db, verified.sessionToken, verified.expiresAt, "finance", "read", {})).state, "signed_out");
    await revokeSession(db, verified.sessionToken, started);
    assert.equal((await openModule(db, verified.sessionToken, started, "finance", "read", {})).state, "signed_out");

    const again = await signIn(db, person.emailNormalized, new Date(started.getTime() + 1_000));
    await db.update(users).set({ status: "disabled" }).where(eq(users.id, person.id));
    assert.equal((await openModule(db, again.sessionToken, new Date(started.getTime() + 1_000), "finance", "read", {})).state, "signed_out");
  });
});

test("a finance department cannot read HR, another company, or an uncovered department", async () => {
  await withDb(async (db) => {
    const person = await addUser(db, "finance-staff@wolf-command.test");
    await addMembership(db, person.id, "company-a", "dev-finance", "staff");
    const verified = await signIn(db, person.emailNormalized, started);
    const finance = await openModule(db, verified.sessionToken, started, "finance", "read", {}, records);
    assert.equal(finance.state, "allowed");
    if (finance.state === "allowed") assert.deepEqual(finance.records.map((record) => record.id), ["a-finance"]);

    const otherCompany = await openModule(
      db,
      verified.sessionToken,
      started,
      "finance",
      "read",
      { companyId: "company-b", userId: "someone-else", role: "owner", grant: "owner_private" },
      records,
    );
    assert.equal(otherCompany.state, "denied");
    if (otherCompany.state === "denied") assert.equal(otherCompany.reason, "wrong_company");

    const otherDepartment = await openModule(
      db,
      verified.sessionToken,
      started,
      "finance",
      "read",
      { departmentId: "dev-hr" },
      records,
    );
    assert.equal(otherDepartment.state, "denied");
    const hr = await openModule(db, verified.sessionToken, started, "hr", "read", {}, records);
    assert.equal(hr.state, "denied");
    if (hr.state === "denied") assert.equal(hr.reason, "module_scope");
  });
});

test("company-wide membership reads every department module, and staff still cannot delete or approve", async () => {
  await withDb(async (db) => {
    const person = await addUser(db, "wide-staff@wolf-command.test");
    await addMembership(db, person.id, "company-a", null, "staff");
    const verified = await signIn(db, person.emailNormalized, started);
    const hr = await openModule(db, verified.sessionToken, started, "hr", "read", {}, records);
    assert.equal(hr.state, "allowed");
    if (hr.state === "allowed") assert.deepEqual(hr.records.map((record) => record.id), ["a-hr"]);
    const removed = await openModule(db, verified.sessionToken, started, "finance", "delete", { companyId: "company-a" }, records);
    assert.equal(removed.state, "denied");
    if (removed.state === "denied") assert.equal(removed.reason, "role_required");
    const approved = await openModule(db, verified.sessionToken, started, "finance", "approve", { companyId: "company-a", departmentId: "dev-finance" }, records);
    assert.equal(approved.state, "denied");
    if (approved.state === "denied") assert.equal(approved.reason, "approval_grant_required");
    assert.equal(records.length, 6);
  });
});

test("administrator and owner roles do not open Owner Private, and the explicit grant is read-only for its company", async () => {
  await withDb(async (db) => {
    for (const role of ["administrator", "owner"] as const) {
      const person = await addUser(db, `${role}-private@wolf-command.test`);
      await addMembership(db, person.id, "company-a", null, role);
      const verified = await signIn(db, person.emailNormalized, started);
      const view = await openModule(db, verified.sessionToken, started, "owner_private", "read", {
        companyId: "company-a",
        role: "owner",
        grant: "owner_private",
      });
      assert.equal(view.state, "denied");
      if (view.state === "denied") assert.equal(view.reason, "owner_private_grant_required");
    }

    const person = await addUser(db, "private-grant@wolf-command.test");
    await addMembership(db, person.id, "company-a", null, "owner");
    await db.insert(grants).values({
      userId: person.id,
      grantType: "owner_private",
      companyId: "company-a",
      scope: null,
      departmentId: null,
    });
    const verified = await signIn(db, person.emailNormalized, started);
    const allowed = await openModule(db, verified.sessionToken, started, "owner_private", "read", {}, records);
    assert.equal(allowed.state, "allowed");
    if (allowed.state === "allowed") {
      assert.equal(allowed.companyId, "company-a");
      assert.deepEqual(allowed.records, []);
    }
    const other = await openModule(db, verified.sessionToken, started, "owner_private", "read", { companyId: "company-b" });
    assert.equal(other.state, "denied");
    const edited = await openModule(db, verified.sessionToken, started, "owner_private", "update", { companyId: "company-a" });
    assert.equal(edited.state, "denied");
    if (edited.state === "denied") assert.equal(edited.reason, "not_permitted");
  });
});

test("read and edit do not approve, and a department approval grant does not approve the company", async () => {
  await withDb(async (db) => {
    const person = await addUser(db, "approver@wolf-command.test");
    await addMembership(db, person.id, "company-a", null, "administrator");
    const verified = await signIn(db, person.emailNormalized, started);
    const edited = await openModule(db, verified.sessionToken, started, "finance", "update", { companyId: "company-a", departmentId: "dev-finance" }, records);
    assert.equal(edited.state, "allowed");
    if (edited.state === "allowed") assert.equal(edited.persisted, false);
    const pending = await openModule(db, verified.sessionToken, started, "finance", "approve", { companyId: "company-a" }, records);
    assert.equal(pending.state, "denied");

    await ensureTenant(db, "company-a", "dev-finance");
    await db.insert(grants).values({
      userId: person.id,
      grantType: "approve",
      companyId: "company-a",
      scope: "department",
      departmentId: "dev-finance",
    });
    const stillCompany = await openModule(db, verified.sessionToken, started, "finance", "approve", { companyId: "company-a" }, records);
    assert.equal(stillCompany.state, "denied");
    const department = await openModule(
      db,
      verified.sessionToken,
      started,
      "finance",
      "approve",
      { companyId: "company-a", departmentId: "dev-finance" },
      records,
    );
    assert.equal(department.state, "allowed");
    if (department.state === "allowed") assert.deepEqual(department.records, []);
    assert.equal(records.length, 6);
  });
});

test("a temporary password blocks protected modules and direct record requests", async () => {
  await withDb(async (db) => {
    const person = await addUser(db, "temporary@wolf-command.test", true);
    await addMembership(db, person.id, "company-a", null, "administrator");
    const verified = await signIn(db, person.emailNormalized, started);
    for (const moduleId of ["overview", "finance", "hr", "academy", "content", "owner_private", "settings", "organization", "procurement"] as const) {
      const view = await openModule(db, verified.sessionToken, started, moduleId, "read", { companyId: "company-a" }, records);
      assert.equal(view.state, "password_change_required");
    }
    const response = await handleRecordsRequest(
      db,
      verified.sessionToken,
      started,
      { module: "finance", action: "read", query: { companyId: "company-a", userId: person.id, role: "administrator" } },
      records,
    );
    assert.equal(response.status, 403);
    assert.equal(response.body.state, "password_change_required");
    assert.equal("records" in response.body, false);
  });
});

test("account administration is an administrator membership, and settings stays on the signed-in account", async () => {
  await withDb(async (db) => {
    const admin = await addUser(db, "admin-settings@wolf-command.test");
    await addMembership(db, admin.id, "company-a", null, "administrator");
    const owner = await addUser(db, "owner-settings@wolf-command.test");
    await addMembership(db, owner.id, "company-a", null, "owner");
    const staff = await addUser(db, "staff-settings@wolf-command.test");
    await addMembership(db, staff.id, "company-a", "dev-finance", "staff");

    const adminSession = await signIn(db, admin.emailNormalized, started);
    const adminView = await openModule(db, adminSession.sessionToken, started, "settings", "read", { userId: owner.id, role: "owner" });
    assert.equal(adminView.state, "allowed");
    if (adminView.state === "allowed") {
      assert.equal(adminView.email, admin.emailNormalized);
      assert.equal(adminView.canAdminister, true);
      assert.deepEqual(adminView.records, []);
    }

    const ownerSession = await signIn(db, owner.emailNormalized, new Date(started.getTime() + 1_000));
    const ownerView = await openModule(db, ownerSession.sessionToken, started, "settings", "read", {});
    assert.equal(ownerView.state, "allowed");
    if (ownerView.state === "allowed") assert.equal(ownerView.canAdminister, false);

    const staffSession = await signIn(db, staff.emailNormalized, new Date(started.getTime() + 2_000));
    const staffView = await openModule(db, staffSession.sessionToken, started, "settings", "read", {});
    assert.equal(staffView.state, "allowed");
    if (staffView.state === "allowed") assert.equal(staffView.canAdminister, false);
    assert.equal(authorizeProvisioning(null, "company-a"), false);
  });
});

test("a department staff membership does not open company modules, and company-wide staff can read academy but not create it", async () => {
  await withDb(async (db) => {
    const departmentStaff = await addUser(db, "academy-staff@wolf-command.test");
    await addMembership(db, departmentStaff.id, "company-a", "dev-finance", "staff");
    const departmentSession = await signIn(db, departmentStaff.emailNormalized, started);
    const hidden = await openModule(db, departmentSession.sessionToken, started, "academy", "read", {}, records);
    assert.equal(hidden.state, "denied");
    if (hidden.state === "denied") assert.equal(hidden.reason, "module_scope");

    const person = await addUser(db, "academy-wide@wolf-command.test");
    await addMembership(db, person.id, "company-a", null, "staff");
    const verified = await signIn(db, person.emailNormalized, new Date(started.getTime() + 1_000));
    const reading = await openModule(db, verified.sessionToken, started, "academy", "read", {}, records);
    assert.equal(reading.state, "allowed");
    if (reading.state === "allowed") assert.deepEqual(reading.records.map((record) => record.id), ["a-academy"]);
    const writing = await openModule(db, verified.sessionToken, started, "academy", "create", { companyId: "company-a" });
    assert.equal(writing.state, "denied");
    if (writing.state === "denied") assert.equal(writing.reason, "role_required");
  });
});

test("direct record requests ignore client identity and do not persist", async () => {
  await withDb(async (db) => {
    const person = await addUser(db, "api-staff@wolf-command.test");
    await addMembership(db, person.id, "company-a", "dev-finance", "staff");
    const missing = await handleRecordsRequest(db, null, started, { module: "finance", action: "read", query: {} }, records);
    assert.equal(missing.status, 401);
    const verified = await signIn(db, person.emailNormalized, started);
    const denied = await handleRecordsRequest(
      db,
      verified.sessionToken,
      started,
      { module: "hr", action: "read", query: { companyId: "company-a", role: "owner", grant: "approve" } },
      records,
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.body.records, undefined);
    const changed = await handleRecordsRequest(
      db,
      verified.sessionToken,
      started,
      { module: "finance", action: "update", query: { companyId: "company-b", userId: "forged" } },
      records,
    );
    assert.equal(changed.status, 403);
    assert.equal(records.length, 6);
    assert.equal(evaluateModuleAccess(null, "overview", "read").reason, "missing_actor");
  });
});
