import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { auditEventTypes } from "../auth/audit";
import { withDb } from "../test/harness";
import { migrationFiles, schemaStatements, statementsFrom } from "./apply-schema";
import { auditEvents, grants, memberships, sessions, users } from "./schema";

test("the historical migration does not seed identities", () => {
  const source = readFileSync(new URL("./schema.sql", import.meta.url), "utf8").toLowerCase();
  assert.equal(source.includes("insert into"), false);
  assert.match(source, /create table if not exists users/);
  assert.match(source, /otp_challenges/);
  assert.match(source, /token_hash text not null unique/);
});

test("the password migration is forward-only and keeps current audit events", () => {
  assert.deepEqual(migrationFiles(), [
    "0002_password_auth.sql",
    "0003_tenant_foundation.sql",
    "0004_finance_drafts.sql",
    "0005_finance_workspace.sql",
    "0006_finance_modules.sql",
    "0007_finance_module_parity.sql",
    "0008_finance_operating_departments.sql",
    "0009_finance_mapping_configurations.sql",
    "0010_finance_chart_accounts.sql",
    "0011_atrium_draft_journals.sql",
    "0012_atrium_revenue_spending.sql",
    "0013_organization_demo.sql",
    "0014_amg_procurement.sql",
    "0015_access_policy.sql",
    "0016_ai_command.sql",
    "0017_ai_provider.sql",
    "0018_idr_foundation.sql",
    "0019_org_hr_links.sql",
    "0020_org_hr_tasks.sql",
    "0021_company_operating_system.sql",
    "0022_company_operating_grants.sql",
  ]);
  const source = readFileSync(new URL("./migrations/0002_password_auth.sql", import.meta.url), "utf8").toLowerCase();
  assert.equal(source.includes("insert into"), false);
  assert.match(source, /add column if not exists password_hash/);
  assert.match(source, /must_change_password/);
  assert.match(source, /drop table if exists otp_challenges/);
  for (const eventType of auditEventTypes) {
    assert.match(source, new RegExp(eventType));
  }
  const applied = schemaStatements().join("\n").toLowerCase();
  assert.equal(applied.includes("insert into users"), false);
  assert.equal(applied.includes("insert into sessions"), false);
  assert.equal(applied.includes("insert into memberships"), false);
  assert.equal(applied.includes("insert into grants"), false);
  assert.equal(applied.includes("insert into audit_events"), false);
});

test("migration statements keep quoted and dollar-quoted semicolons together", () => {
  assert.deepEqual(statementsFrom("select 'a;b'; select 2;"), ["select 'a;b'", "select 2"]);
  const quotedBlock = statementsFrom("select 1; do $$ begin perform 1; end $$; select 2;");
  assert.equal(quotedBlock.length, 3);
  assert.match(quotedBlock[1], /perform 1;/);
});

test("the migration runner applies the schema in one transaction", () => {
  const source = readFileSync(new URL("./migrate.ts", import.meta.url), "utf8");
  const beginAt = source.indexOf("await sql.begin");
  const applyAt = source.indexOf("await applySchemaSql");
  const executeAt = source.indexOf("await tx.unsafe");
  assert.ok(beginAt >= 0 && applyAt > beginAt && executeAt > applyAt);
  assert.match(source, /void main\(\)\.catch\(\(\) => \{/);
});

test("Drizzle records the SQL uniqueness and tenant constraints", () => {
  const userConfig = getTableConfig(users);
  const sessionConfig = getTableConfig(sessions);
  const membershipConfig = getTableConfig(memberships);
  const grantConfig = getTableConfig(grants);
  const auditConfig = getTableConfig(auditEvents);
  assert.ok(userConfig.uniqueConstraints.some((constraint) => constraint.name === "users_email_normalized_key"));
  assert.ok(sessionConfig.uniqueConstraints.some((constraint) => constraint.name === "sessions_token_hash_key"));
  assert.ok(sessionConfig.checks.some((constraint) => constraint.name === "sessions_hash_check"));
  assert.ok(membershipConfig.indexes.some((constraint) => constraint.config.name === "memberships_user_company_department"));
  assert.ok(grantConfig.indexes.some((constraint) => constraint.config.name === "grants_owner_private_once"));
  assert.ok(grantConfig.indexes.some((constraint) => constraint.config.name === "grants_approve_once"));
  assert.ok(grantConfig.checks.some((constraint) => constraint.name === "grants_shape_check"));
  assert.ok(auditConfig.checks.some((constraint) => constraint.name === "audit_events_type_check"));
  assert.ok(auditConfig.checks.some((constraint) => constraint.name === "audit_events_resource_check"));
  assert.ok(membershipConfig.foreignKeys.some((constraint) => constraint.getName() === "memberships_department_fk"));
  assert.ok(grantConfig.foreignKeys.some((constraint) => constraint.getName() === "grants_company_fk"));
});

test("the applied schema stores password hashes and drops otp challenges", async () => {
  await withDb(async (db) => {
    const result = await db.execute<{ name: string | null }>(sql`select to_regclass('public.otp_challenges') as name`);
    const rows = Array.isArray(result) ? result : result.rows;
    assert.equal(rows[0]?.name ?? null, null);
    const columns = await db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name = 'users' and column_name = 'password_hash'`,
    );
    const columnRows = Array.isArray(columns) ? columns : columns.rows;
    assert.equal(columnRows[0]?.column_name, "password_hash");
  });
});
