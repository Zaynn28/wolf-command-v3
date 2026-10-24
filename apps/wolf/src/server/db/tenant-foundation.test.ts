import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { companies, departments, grants, memberships, users } from "./schema";
import { ensureTenant } from "./tenant";
import type { AuthDatabase } from "./types";
import { signIn, withDb } from "../test/harness";
import { openModule, type OperationalRecord } from "../access/open-module";

const started = new Date("2026-10-22T00:00:00.000Z");

const records: OperationalRecord[] = [
  { id: "a-finance", module: "finance", companyId: "company-a", departmentId: "finance", title: "Company A invoice" },
  { id: "b-finance", module: "finance", companyId: "company-b", departmentId: "finance", title: "Company B invoice" },
  { id: "a-hr", module: "hr", companyId: "company-a", departmentId: "hr", title: "Company A person" },
];

async function addUser(db: AuthDatabase, email: string) {
  const row = (await db.insert(users).values({ emailNormalized: email, status: "active" }).returning())[0];
  if (!row) throw new Error("User was not stored.");
  return row;
}

function errorText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) parts.push(current.message);
    const record = current as { cause?: unknown; constraint_name?: unknown; constraint?: unknown };
    if (typeof record.constraint === "string") parts.push(record.constraint);
    if (typeof record.constraint_name === "string") parts.push(record.constraint_name);
    current = record.cause;
  }
  return parts.join("\n");
}

async function rejectsConstraint(run: () => Promise<unknown>, constraint: string) {
  await assert.rejects(run, (error: unknown) => {
    const message = errorText(error);
    assert.match(message, new RegExp(constraint, "i"));
    assert.equal(message.includes("postgresql://"), false);
    assert.equal(message.includes("$argon2"), false);
    return true;
  });
}

test("tenant migration backfills existing keys and does not seed people", () => {
  const source = readFileSync(new URL("./migrations/0003_tenant_foundation.sql", import.meta.url), "utf8").toLowerCase();
  assert.match(source, /create table if not exists companies/);
  assert.match(source, /create table if not exists departments/);
  assert.match(source, /memberships_company_fk/);
  assert.match(source, /memberships_department_fk/);
  assert.match(source, /grants_department_fk/);
  assert.match(source, /row level security stays disabled/);
  assert.equal(source.includes("enable row level security"), false);
  assert.equal(source.includes("insert into users"), false);
  assert.equal(source.includes("drop table"), false);
  assert.equal(source.includes("truncate"), false);
});

test("companies and departments reject missing tenants, duplicates, and cross-company departments", async () => {
  await withDb(async (db) => {
    await ensureTenant(db, "company-a", "finance");
    await ensureTenant(db, "company-b", "finance");
    const person = await addUser(db, "tenant@wolf-command.test");

    await db.insert(memberships).values({
      userId: person.id,
      companyId: "company-a",
      departmentId: "finance",
      role: "staff",
      status: "active",
    });
    await rejectsConstraint(
      () =>
        db.insert(memberships).values({
          userId: person.id,
          companyId: "company-a",
          departmentId: "finance",
          role: "staff",
          status: "active",
        }),
      "memberships_user_company_department",
    );
    await rejectsConstraint(
      () =>
        db.insert(memberships).values({
          userId: person.id,
          companyId: "missing-company",
          departmentId: null,
          role: "staff",
          status: "active",
        }),
      "memberships_company_fk",
    );
    await rejectsConstraint(
      () =>
        db.insert(memberships).values({
          userId: person.id,
          companyId: "company-b",
          departmentId: "hr",
          role: "staff",
          status: "active",
        }),
      "memberships_department_fk",
    );
    await rejectsConstraint(
      () =>
        db.insert(grants).values({
          userId: person.id,
          grantType: "approve",
          companyId: "company-a",
          scope: "department",
          departmentId: "hr",
        }),
      "grants_department_fk",
    );
    await rejectsConstraint(
      () =>
        db.insert(grants).values({
          userId: person.id,
          grantType: "owner_private",
          companyId: "company-a",
          scope: "company",
          departmentId: null,
        }),
      "grants_shape_check",
    );

    const stored = await db.select().from(departments);
    assert.equal(stored.every((row) => row.companyId === "company-a" || row.companyId === "company-b"), true);
    const companiesStored = await db.select().from(companies);
    assert.equal(companiesStored.length, 2);
    const foreignDepartment = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from departments d where not exists (select 1 from companies c where c.id = d.company_id)`,
    );
    const countRows = Array.isArray(foreignDepartment) ? foreignDepartment : foreignDepartment.rows;
    assert.equal(countRows[0]?.count, "0");
  });
});

test("module writes stay inside the session company and department", async () => {
  await withDb(async (db) => {
    const person = await addUser(db, "writer@wolf-command.test");
    await ensureTenant(db, "company-a", "finance");
    await db.insert(memberships).values({
      userId: person.id,
      companyId: "company-a",
      departmentId: "finance",
      role: "administrator",
      status: "active",
    });
    const verified = await signIn(db, person.emailNormalized, started);

    for (const action of ["read", "create", "update", "delete"] as const) {
      const same = await openModule(db, verified.sessionToken, started, "finance", action, { companyId: "company-a", departmentId: "finance" }, records);
      assert.equal(same.state, "allowed", action);
      if (same.state === "allowed") assert.equal(same.persisted, false);
      const otherCompany = await openModule(db, verified.sessionToken, started, "finance", action, {
        companyId: "company-b",
        departmentId: "finance",
        userId: "forged-user",
        role: "owner",
      }, records);
      assert.equal(otherCompany.state, "denied", action);
      const otherDepartment = await openModule(db, verified.sessionToken, started, "hr", action, { companyId: "company-a", departmentId: "hr" }, records);
      assert.equal(otherDepartment.state, "denied", action);
    }

    const approved = await openModule(db, verified.sessionToken, started, "finance", "approve", { companyId: "company-a", departmentId: "finance" }, records);
    assert.equal(approved.state, "denied");
    if (approved.state === "denied") assert.equal(approved.reason, "approval_grant_required");

    const ownerPrivate = await openModule(db, verified.sessionToken, started, "owner_private", "read", { companyId: "company-a", grant: "owner_private" }, records);
    assert.equal(ownerPrivate.state, "denied");
    if (ownerPrivate.state === "denied") assert.equal(ownerPrivate.reason, "owner_private_grant_required");
    const ownerWrite = await openModule(db, verified.sessionToken, started, "owner_private", "update", { companyId: "company-a" });
    assert.equal(ownerWrite.state, "denied");
    assert.equal(records.length, 3);
  });
});
