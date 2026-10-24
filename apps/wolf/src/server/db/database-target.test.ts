import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sep } from "node:path";
import { test } from "node:test";
import { provisionCreatedOutput, provisionResetOutput, seedReadyOutput } from "./command-output";
import { resolveDevelopmentDatabaseTarget } from "./database-target";
import { devAccounts } from "./dev-accounts";
import { assignEnvFromFile, wolfEnvLocalPath } from "./load-env";

const allowedUrl = "postgresql://wolf:wolf@127.0.0.1:5433/wolf_command";
const secretMarker = "printed-secret-token";
const hashMarker = "$argon2id$v=19$secret";

function refused(databaseUrl: string | undefined, nodeEnv = "development") {
  return resolveDevelopmentDatabaseTarget({ DATABASE_URL: databaseUrl, NODE_ENV: nodeEnv });
}

test("development database commands accept only 127.0.0.1:5433/wolf_command", () => {
  assert.deepEqual(refused(allowedUrl), { ok: true, databaseUrl: allowedUrl });
  assert.deepEqual(refused("postgres://wolf:wolf@127.0.0.1:5433/wolf_command"), {
    ok: true,
    databaseUrl: "postgres://wolf:wolf@127.0.0.1:5433/wolf_command",
  });
  const preserved = `${allowedUrl}?sslmode=disable`;
  assert.deepEqual(refused(preserved), { ok: true, databaseUrl: preserved });
  assert.deepEqual(resolveDevelopmentDatabaseTarget({ DATABASE_URL: allowedUrl }), {
    ok: true,
    databaseUrl: allowedUrl,
  });
});

test("development database commands reject other targets without rewriting them", () => {
  const cases: Array<[string | undefined, string, string]> = [
    ["postgresql://wolf:wolf@127.0.0.1:5432/wolf_command", "port", "Refusing database command. DATABASE_URL port must be 5433."],
    ["postgresql://wolf:wolf@127.0.0.1:5434/wolf_command", "port", "Refusing database command. DATABASE_URL port must be 5433."],
    ["postgresql://wolf:wolf@127.0.0.1:5433/postgres", "database", "Refusing database command. DATABASE_URL database must be wolf_command."],
    ["postgresql://wolf:wolf@db.example.com:5433/wolf_command", "host", "Refusing database command. DATABASE_URL host must be 127.0.0.1."],
    ["postgresql://wolf:wolf@localhost:5433/wolf_command", "host", "Refusing database command. DATABASE_URL host must be 127.0.0.1."],
    ["not a url", "malformed", "Refusing database command. DATABASE_URL is malformed."],
    ["http://127.0.0.1:5433/wolf_command", "malformed", "Refusing database command. DATABASE_URL is malformed."],
    [undefined, "missing", "Refusing database command. DATABASE_URL is missing."],
    ["   ", "missing", "Refusing database command. DATABASE_URL is missing."],
  ];

  for (const [databaseUrl, reason, message] of cases) {
    const decision = refused(databaseUrl);
    assert.deepEqual(decision, { ok: false, reason, message });
    assert.equal(JSON.stringify(decision).includes("5432"), false);
    assert.equal("databaseUrl" in decision, false);
  }

  assert.deepEqual(refused(allowedUrl, "production"), {
    ok: false,
    reason: "production",
    message: "Refusing database command while NODE_ENV is production.",
  });

  const secretUrl = `postgresql://wolf:${secretMarker}@db.example.com:5432/wolf_command`;
  const secretDecision = refused(secretUrl, "production");
  assert.equal(secretDecision.ok, false);
  if (!secretDecision.ok) {
    assert.equal(secretDecision.reason, "production");
    assert.equal(secretDecision.message.includes(secretMarker), false);
    assert.equal(secretDecision.message.includes(secretUrl), false);
    assert.equal(secretDecision.message.includes(hashMarker), false);
  }
});

test("database commands load the app env file without overriding or rewriting a target", () => {
  const env: Record<string, string | undefined> = {
    DATABASE_URL: `postgresql://wolf:${secretMarker}@127.0.0.1:5432/wolf_command`,
  };
  assignEnvFromFile(`DATABASE_URL=${allowedUrl}\nWOLF_ALLOW_DEV_SEED=1\n`, env);
  assert.equal(env.DATABASE_URL, `postgresql://wolf:${secretMarker}@127.0.0.1:5432/wolf_command`);
  assert.equal(env.WOLF_ALLOW_DEV_SEED, "1");

  const fromFile: Record<string, string | undefined> = {};
  assignEnvFromFile(`# comment\nexport DATABASE_URL="${allowedUrl}"\n`, fromFile);
  assert.equal(fromFile.DATABASE_URL, allowedUrl);
  assert.equal(wolfEnvLocalPath().endsWith(`${sep}apps${sep}wolf${sep}.env.local`), true);
});

test("seed and provision output excludes passwords, hashes, tokens, and connection URLs", () => {
  const output = [
    seedReadyOutput(devAccounts),
    provisionCreatedOutput("phase2e.staff@wolf-command.test"),
    provisionResetOutput("phase2e.staff@wolf-command.test"),
    resolveDevelopmentDatabaseTarget({
      DATABASE_URL: `postgresql://wolf:${hashMarker}@127.0.0.1:5432/wolf_command`,
      NODE_ENV: "development",
    }),
  ]
    .map((entry) => (typeof entry === "string" ? entry : entry.ok ? entry.databaseUrl : entry.message))
    .join("\n");

  for (const account of devAccounts) {
    assert.equal(output.includes(account.password), false, account.email);
  }
  assert.equal(output.includes(secretMarker), false);
  assert.equal(output.includes(hashMarker), false);
  assert.equal(output.includes("postgresql://"), false);
  assert.equal(output.includes("postgres://"), false);
  assert.match(output, /staff\.dev@wolf-command\.test/);
  assert.match(output, /were not printed or emailed/);

  const here = new URL(".", import.meta.url);
  for (const name of ["seed-dev.ts", "provision-account.ts", "bootstrap-operator.ts"]) {
    const source = readFileSync(new URL(name, here), "utf8");
    const loadAt = source.indexOf("loadWolfEnvFile(process.env)");
    const guardAt = source.indexOf("const target = resolveDevelopmentDatabaseTarget(process.env)");
    const connectAt = source.indexOf("const sql = postgres(");
    assert.ok(loadAt >= 0 && guardAt > loadAt, name);
    assert.ok(connectAt > guardAt, name);
    assert.ok(source.indexOf("if (!target.ok)", guardAt) < connectAt, name);
    assert.match(source, /void main\(\)\.catch\(\(\) => \{/);
    assert.doesNotMatch(
      source,
      /console\.(log|error|debug|info|warn)\([^;\n]*(account\.password|temporaryPassword|passwordHash|databaseUrl|sessionToken|postgres(?:ql)?:\/\/)/,
    );
  }

  const migrate = readFileSync(new URL("migrate.ts", here), "utf8");
  const loadAt = migrate.indexOf("loadWolfEnvFile(env)");
  const guardAt = migrate.indexOf("const target = resolveDevelopmentDatabaseTarget(env)");
  const openAt = migrate.indexOf("const sql = open(target.databaseUrl)");
  const postgresAt = migrate.indexOf("const sql = postgres(");
  assert.ok(loadAt >= 0 && guardAt > loadAt);
  assert.ok(migrate.indexOf("if (!target.ok)", guardAt) < openAt);
  assert.ok(openAt < postgresAt);
  assert.match(migrate, /void main\(\)\.catch\(\(\) => \{/);
  assert.doesNotMatch(
    migrate,
    /console\.(log|error|debug|info|warn)\([^;\n]*(account\.password|temporaryPassword|passwordHash|databaseUrl|sessionToken|postgres(?:ql)?:\/\/)/,
  );
});
