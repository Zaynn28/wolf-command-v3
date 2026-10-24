import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { SQL } from "drizzle-orm";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { schemaStatements, statementsFrom } from "./apply-schema";
import { applyMigrationStatements, runMigrationCommand } from "./migrate";
import {
  auditEvents,
  authAttempts,
  companies,
  departments,
  grants,
  memberships,
  sessions,
  users,
} from "./schema";

const require = createRequire(import.meta.url);
const dialect = new PgDialect();
const secret = "migrate-secret-password";
const tables = [users, companies, departments, memberships, grants, authAttempts, sessions, auditEvents];

function normalize(value: string): string {
  const flattened = value
    .toLowerCase()
    .replace(/::[a-z0-9_ ]+/g, "")
    .replace(/public\./g, "")
    .replace(/"/g, "")
    .replace(/\b[a-z_][a-z0-9_]*\.(?=[a-z_])/g, "")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
  return unwrap(flattened);
}

function unwrap(value: string): string {
  let current = value;
  while (current.startsWith("(") && current.endsWith(")")) {
    let depth = 0;
    let wrapped = true;
    for (let index = 0; index < current.length; index += 1) {
      if (current[index] === "(") depth += 1;
      if (current[index] === ")") {
        depth -= 1;
        if (depth === 0 && index < current.length - 1) wrapped = false;
      }
    }
    if (!wrapped || depth !== 0) break;
    current = current.slice(1, -1).trim();
  }
  return current;
}

function literals(value: string): string[] {
  return [...value.matchAll(/'(?:[^']|'')*'/g)].map((match) => match[0]).sort();
}

function lastCheckBody(sqlText: string, name: string): string {
  const marker = new RegExp(`(?:constraint|add constraint)\\s+${name}\\s+check\\s*\\(`, "gi");
  let opening = -1;
  for (let match = marker.exec(sqlText); match; match = marker.exec(sqlText)) {
    opening = match.index + match[0].length - 1;
  }
  assert.ok(opening >= 0, name);
  let depth = 0;
  for (let index = opening; index < sqlText.length; index += 1) {
    if (sqlText[index] === "(") depth += 1;
    if (sqlText[index] === ")") {
      depth -= 1;
      if (depth === 0) return sqlText.slice(opening + 1, index);
    }
  }
  throw new Error(`Unclosed check ${name}`);
}

function rendered(value: SQL): string {
  return dialect.sqlToQuery(value).sql;
}

function columnText(column: unknown): string {
  if (typeof column === "object" && column !== null && "name" in column && typeof column.name === "string") {
    return column.name;
  }
  return rendered(column as SQL);
}

test("statement splitting keeps semicolons inside quotes, comments, and dollar quotes", () => {
  assert.deepEqual(statementsFrom("select 'a;b'; select 2;"), ["select 'a;b'", "select 2"]);
  assert.deepEqual(statementsFrom("select 'it'';s;a'; select 2;"), ["select 'it'';s;a'", "select 2"]);
  assert.deepEqual(statementsFrom("select 'a\\'; select 2;"), ["select 'a\\'", "select 2"]);
  assert.deepEqual(statementsFrom('select "a;b"; select 2;'), ['select "a;b"', "select 2"]);
  assert.deepEqual(statementsFrom('select "weir"";d;name"; select 2;'), ['select "weir"";d;name"', "select 2"]);
  assert.deepEqual(statementsFrom("select 'a--b;c'; select 2;"), ["select 'a--b;c'", "select 2"]);
  assert.deepEqual(statementsFrom("select '/*; */'; select 2;"), ["select '/*; */'", "select 2"]);
  assert.deepEqual(statementsFrom("select 1; -- hidden;\nselect 2;"), ["select 1", "select 2"]);
  assert.deepEqual(statementsFrom("select 1; -- tail"), ["select 1"]);
  assert.deepEqual(statementsFrom("select 1; /* hidden; */ select 2;"), ["select 1", "select 2"]);
  assert.deepEqual(statementsFrom("select 1 /* ; */ + 2; select 3;"), ["select 1  + 2", "select 3"]);
  assert.deepEqual(statementsFrom("select 1; /* hidden; select 2"), ["select 1"]);

  const tagged = statementsFrom("select 1; create function f() returns void as $fn$ begin perform 'a;b'; end $fn$; select 2;");
  assert.equal(tagged.length, 3);
  assert.match(tagged[1] ?? "", /perform 'a;b';/);
  const nested = statementsFrom("do $outer$ begin perform $inner$;$inner$; end $outer$; select 1;");
  assert.equal(nested.length, 2);
  assert.match(nested[0] ?? "", /\$inner\$;\$inner\$/);
});

test("installed postgres.js begin rolls back the same connection before commit", () => {
  const source = readFileSync(require.resolve("postgres"), "utf8");
  const beginAt = source.indexOf("async function begin");
  const begin = source.slice(beginAt, source.indexOf("function move", beginAt));
  const rollbackAt = begin.indexOf("sql`rollback`");
  const commitAt = begin.indexOf("sql`commit`");
  assert.ok(begin.includes("await sql.unsafe('begin '"));
  assert.ok(rollbackAt > 0 && commitAt > rollbackAt);
  assert.match(begin, /catch \(e\) \{[\s\S]*sql`rollback`/);
  assert.match(begin, /function onexecute\(c\) \{\s*connection = c/);
  assert.match(begin, /c\.execute\(q\)/);
  const command = readFileSync(new URL("./migrate.ts", import.meta.url), "utf8");
  const apply = command.slice(
    command.indexOf("export async function applyMigrationStatements"),
    command.indexOf("export async function runMigrationCommand"),
  );
  assert.match(apply, /await sql\.begin\(async \(tx\) => \{[\s\S]*await tx\.unsafe\(statement\)/);
  assert.equal(apply.includes("sql.unsafe"), false);
  assert.match(command, /begin: \(run\) => sql\.begin\(run\)/);
});

test("the target guard rejects a connection before a client exists, and failures omit the error", async () => {
  const reports: string[] = [];
  let opened = false;
  const refused = await runMigrationCommand(
    { NODE_ENV: "development", DATABASE_URL: `postgresql://wolf:${secret}@127.0.0.1:59999/wolf_command` },
    () => {
      opened = true;
      throw new Error("client opened");
    },
    (message) => reports.push(message),
  );
  assert.equal(refused, 1);
  assert.equal(opened, false);
  assert.deepEqual(reports, ["Refusing database command. DATABASE_URL port must be 5433."]);
  assert.equal(reports.join("\n").includes(secret), false);

  reports.length = 0;
  let ended = 0;
  const failed = await runMigrationCommand(
    { NODE_ENV: "development", DATABASE_URL: `postgresql://wolf:${secret}@127.0.0.1:5433/wolf_command` },
    (databaseUrl) => {
      assert.equal(databaseUrl.includes(secret), true);
      return {
        async begin() {
          throw Object.assign(new Error(secret), { query: "alter table users drop constraint users_password_hash_check", parameters: [secret] });
        },
        async end() {
          ended += 1;
        },
      };
    },
    (message) => reports.push(message),
  );
  assert.equal(failed, 1);
  assert.equal(ended, 1);
  assert.deepEqual(reports, ["Migration failed."]);
  assert.equal(reports.join("\n").includes(secret), false);
  assert.equal(reports.join("\n").includes("drop constraint"), false);
});

test("the migrate process exits nonzero for a rejected target without printing the URL", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/server/db/migrate.ts"], {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      NODE_ENV: "development",
      DATABASE_URL: `postgresql://wolf:${secret}@127.0.0.1:59999/wolf_command`,
    },
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  assert.equal(result.status, 1);
  assert.match(output, /DATABASE_URL port must be 5433/);
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes("postgresql://"), false);
  assert.equal(output.includes("postgres://"), false);
  assert.equal(output.includes("59999"), false);
});

test("one ephemeral transaction applies every statement, and a later failure restores a dropped constraint", async () => {
  const client = new PGlite();
  const executed: string[] = [];
  let connection: object | null = null;
  let begins = 0;
  let commits = 0;
  let rollbacks = 0;

  function clientFor(failOn?: (statement: string) => boolean) {
    return {
    async begin(run: (tx: { unsafe(statement: string): Promise<unknown> }) => Promise<void>): Promise<void> {
        begins += 1;
        await client.exec("begin");
        const tx = {
          async unsafe(statement: string) {
            assert.equal(tx, connection);
            executed.push(statement);
            if (failOn?.(statement)) {
              throw Object.assign(new Error(secret), { query: statement, parameters: [secret] });
            }
            await client.exec(statement);
          },
        };
        connection = tx;
        try {
          const result = await run(tx);
          await client.exec("commit");
          commits += 1;
          return result;
        } catch (error) {
          await client.exec("rollback");
          rollbacks += 1;
          throw error;
        }
      },
    };
  }

  try {
    await applyMigrationStatements(clientFor());
    assert.deepEqual(executed, schemaStatements());
    assert.equal(begins, 1);
    assert.equal(commits, 1);
    assert.equal(rollbacks, 0);
    assert.equal(executed.some((statement) => statement.includes("create table if not exists users")), true);
    assert.equal(executed.some((statement) => statement.includes("password_hash")), true);
    assert.equal(executed.some((statement) => statement.includes("create table if not exists companies")), true);

    const before = await constraintDefinition(client, "users_password_hash_check");
    assert.match(before, /argon2id/);
    let dropped = false;
    await assert.rejects(
      applyMigrationStatements(clientFor((statement) => {
        if (dropped) return true;
        dropped = statement.toLowerCase().includes("drop constraint if exists users_password_hash_check");
        return false;
      })),
      (error: unknown) => {
        assert.equal(error instanceof Error && error.message.includes(secret), true);
        return true;
      },
    );
    assert.equal(commits, 1);
    assert.equal(rollbacks, 1);
    assert.equal(await constraintDefinition(client, "users_password_hash_check"), before);

    const statements = schemaStatements();
    for (let index = 0; index < statements.length; index += 1) {
      const drop = /^alter table \w+ drop constraint if exists (\w+)$/i.exec(statements[index] ?? "");
      if (!drop) continue;
      const name = drop[1] ?? "";
      const add = statements[index + 1] ?? "";
      assert.match(add, new RegExp(`add constraint ${name}\\b`, "i"));
      const current = await constraintDefinition(client, name);
      await client.exec("begin");
      await client.exec(statements[index] ?? "");
      await client.exec(add);
      await client.exec("commit");
      assert.equal(await constraintDefinition(client, name), current, name);
    }

    await client.exec("alter table users drop constraint users_password_hash_check");
    const missing = await client.query<{ conname: string }>(
      "select conname from pg_constraint where conname = 'users_password_hash_check'",
    );
    assert.equal(missing.rows.length, 0);
  } finally {
    await client.close();
  }
});

test("Drizzle constraints match the applied SQL names, actions, nullability, and predicates", async () => {
  const client = new PGlite();
  try {
    for (const statement of schemaStatements()) await client.exec(statement);
    const sqlText = schemaStatements().join("\n");
    const constraints = await client.query<{
      conname: string;
      contype: string;
      def: string;
      confdeltype: string | null;
      columns: string[] | string | null;
      foreign_columns: string[] | string | null;
    }>(`
      select c.conname, c.contype, pg_get_constraintdef(c.oid) as def, c.confdeltype,
        (
          select coalesce(array_agg(a.attname order by u.ordinality), '{}')
          from unnest(c.conkey) with ordinality as u(attnum, ordinality)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.attnum
        ) as columns,
        (
          select coalesce(array_agg(a.attname order by u.ordinality), '{}')
          from unnest(c.confkey) with ordinality as u(attnum, ordinality)
          join pg_attribute a on a.attrelid = c.confrelid and a.attnum = u.attnum
        ) as foreign_columns
      from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      where n.nspname = 'public'
    `);
    const byName = new Map(constraints.rows.map((row) => [row.conname, row]));
    const indexes = await client.query<{ indexname: string; indexdef: string }>(
      "select indexname, indexdef from pg_indexes where schemaname = 'public'",
    );
    const indexByName = new Map(indexes.rows.map((row) => [row.indexname, row.indexdef]));
    const columns = await client.query<{ table_name: string; column_name: string; is_nullable: string }>(
      "select table_name, column_name, is_nullable from information_schema.columns where table_schema = 'public'",
    );
    const nullable = new Map(columns.rows.map((row) => [`${row.table_name}.${row.column_name}`, row.is_nullable]));
    const deleteCode: Record<string, string> = {
      cascade: "c",
      restrict: "r",
      "set null": "n",
      "no action": "a",
      "set default": "d",
    };

    for (const table of tables) {
      const config = getTableConfig(table);
      for (const column of config.columns) {
        assert.equal(nullable.get(`${config.name}.${column.name}`), column.notNull ? "NO" : "YES", `${config.name}.${column.name}`);
      }
      for (const check of config.checks) {
        const body = lastCheckBody(sqlText, check.name);
        const drizzleSql = rendered(check.value);
        assert.equal(normalize(drizzleSql), normalize(body), check.name);
        const applied = byName.get(check.name);
        assert.ok(applied, check.name);
        assert.equal(applied?.contype, "c", check.name);
        for (const literal of literals(drizzleSql)) {
          assert.equal(applied?.def.includes(literal), true, `${check.name} ${literal}`);
        }
      }
      for (const foreignKey of config.foreignKeys) {
        const reference = foreignKey.reference();
        const applied = byName.get(foreignKey.getName());
        assert.ok(applied, foreignKey.getName());
        assert.equal(applied?.contype, "f");
        assert.equal(applied?.confdeltype, deleteCode[foreignKey.onDelete ?? ""], foreignKey.getName());
        assert.deepEqual(pgArray(applied?.columns), reference.columns.map((column) => column.name));
        assert.deepEqual(pgArray(applied?.foreign_columns), reference.foreignColumns.map((column) => column.name));
        assert.match(applied?.def ?? "", /ON DELETE /);
      }
      for (const unique of config.uniqueConstraints) {
        const applied = byName.get(unique.getName() ?? "");
        assert.equal(applied?.contype, "u", unique.name);
        assert.deepEqual(pgArray(applied?.columns), unique.columns.map((column) => column.name));
      }
      for (const index of config.indexes) {
        const name = index.config.name ?? "";
        const indexdef = indexByName.get(name) ?? "";
        assert.notEqual(indexdef, "", name);
        const renderedColumns = index.config.columns.map((column) => normalize(columnText(column))).join(", ");
        assert.equal(normalize(indexdef).includes(renderedColumns), true, `${name} ${renderedColumns} :: ${indexdef}`);
        if (index.config.unique) assert.match(indexdef, /CREATE UNIQUE INDEX/);
        if (index.config.where) {
          const where = normalize(rendered(index.config.where));
          assert.equal(normalize(indexdef).includes(where), true, `${name} ${where} :: ${indexdef}`);
          const source = schemaStatements().find((statement) => new RegExp(`\\b${name}\\b`).test(statement)) ?? "";
          assert.equal(normalize(source).includes(where), true, name);
        }
      }
    }

    assert.equal(indexByName.has("otp_one_active_per_email"), false);
    assert.equal(byName.has("auth_attempts_kind_check"), true);
    assert.equal(byName.get("auth_attempts_kind_check")?.def.includes("'login'"), true);
    const department = byName.get("memberships_department_fk");
    assert.deepEqual(pgArray(department?.columns), ["company_id", "department_id"]);
    assert.equal(department?.confdeltype, "r");
    assert.equal(nullable.get("memberships.department_id"), "YES");
    assert.equal(nullable.get("grants.department_id"), "YES");
    assert.equal(nullable.get("audit_events.company_id"), "YES");
    assert.equal(nullable.get("audit_events.resource_type"), "YES");
    assert.equal(nullable.get("audit_events.resource_id"), "YES");
  } finally {
    await client.close();
  }
});

async function constraintDefinition(client: PGlite, name: string): Promise<string> {
  const result = await client.query<{ def: string }>(
    "select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1",
    [name],
  );
  assert.equal(result.rows.length, 1, name);
  return result.rows[0]?.def ?? "";
}

function pgArray(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (!value || value === "{}") return [];
  return value.slice(1, -1).split(",").map((item) => item.replace(/^"|"$/g, ""));
}
