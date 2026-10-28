import assert from "node:assert/strict";
import { test } from "node:test";
import { cloudSqlSocketPath, postgresHostOverride, prepareRuntimeConnection, resolveRuntimeDatabaseTarget } from "./runtime-database";

const localUrl = "postgresql://wolf:wolf@127.0.0.1:5433/wolf_command";
const secret = "printed-secret-token";
const hash = "$argon2id$v=19$secret";
const productionUrl = `postgresql://app-user:${secret}@db.example.com:5432/service_db?sslmode=verify-full`;

function decision(databaseUrl: string | undefined, nodeEnv?: string) {
  return resolveRuntimeDatabaseTarget({ DATABASE_URL: databaseUrl, NODE_ENV: nodeEnv });
}

test("runtime development target accepts 127.0.0.1:5433/wolf_command unchanged", () => {
  assert.deepEqual(decision(localUrl, "development"), { ok: true, databaseUrl: localUrl });
  assert.deepEqual(decision(localUrl, "test"), { ok: true, databaseUrl: localUrl });
  assert.deepEqual(decision(localUrl), { ok: true, databaseUrl: localUrl });
});

test("runtime development target rejects the wrong port, database, host, and malformed values", () => {
  const cases: Array<[string | undefined, string]> = [
    ["postgresql://wolf:wolf@127.0.0.1:5432/wolf_command", "port"],
    ["postgresql://wolf:wolf@127.0.0.1:5434/wolf_command", "port"],
    ["postgresql://wolf:wolf@127.0.0.1:5433/postgres", "database"],
    ["postgresql://wolf:wolf@db.example.com:5433/wolf_command", "host"],
    ["postgresql://wolf:wolf@localhost:5433/wolf_command", "host"],
    ["not-a-url", "malformed"],
    [undefined, "missing"],
    ["", "missing"],
  ];
  for (const [databaseUrl, reason] of cases) {
    const result = decision(databaseUrl, "development");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, reason);
      assert.equal(result.message.includes("postgresql://"), false);
      assert.equal(result.message.includes(secret), false);
      assert.equal("databaseUrl" in result, false);
    }
  }
});

test("runtime production target uses its own contract", () => {
  assert.deepEqual(decision(productionUrl, "production"), { ok: true, databaseUrl: productionUrl });

  const rejected: Array<[string | undefined, string]> = [
    [localUrl, "host"],
    ["postgresql://wolf:wolf@127.0.0.1:5432/wolf_command", "host"],
    ["postgresql://wolf:wolf@localhost:5432/wolf_command?sslmode=require", "host"],
    ["postgresql://app-user:secret@db.example.com/wolf_command?sslmode=require", "port"],
    ["postgresql://app-user:secret@db.example.com:5432/?sslmode=require", "database"],
    ["postgresql://db.example.com:5432/wolf_command?sslmode=require", "credentials"],
    ["postgresql://app-user:secret@db.example.com:5432/wolf_command", "tls"],
    ["postgresql://app-user:secret@db.example.com:5432/wolf_command?sslmode=disable", "tls"],
    ["http://db.example.com:5432/wolf_command", "malformed"],
    [undefined, "missing"],
  ];
  for (const [databaseUrl, reason] of rejected) {
    const result = decision(databaseUrl, "production");
    assert.equal(result.ok, false, String(databaseUrl));
    if (!result.ok) {
      assert.equal(result.reason, reason);
      assert.equal(result.message.includes(secret), false);
      assert.equal(result.message.includes(hash), false);
      assert.equal(result.message.includes("postgresql://"), false);
    }
  }
});

test("runtime production target accepts a Cloud SQL socket and rejects a loose one", () => {
  const socket = "/cloudsql/wolf-intel-jakarta:asia-southeast2:wolf-command";
  const socketUrl = `postgresql://wolf:${secret}@${encodeURIComponent(socket)}/wolf_command`;
  assert.equal(cloudSqlSocketPath(socketUrl), socket);
  assert.deepEqual(postgresHostOverride(socketUrl), { host: socket });
  assert.deepEqual(decision(socketUrl, "production"), { ok: true, databaseUrl: socketUrl });
  assert.equal(decision(socketUrl, "development").ok, false);

  const rejected: Array<[string, string]> = [
    [`postgresql://wolf:${secret}@${encodeURIComponent("/cloudsql/nope")}/wolf_command`, "host"],
    [`postgresql://wolf:${secret}@${encodeURIComponent(socket)}:5432/wolf_command`, "port"],
    [`postgresql://${encodeURIComponent(socket)}/wolf_command`, "credentials"],
    [`postgresql://wolf:${secret}@${encodeURIComponent(socket)}/wolf_command?sslmode=disable`, "host"],
    [`postgresql://wolf:${secret}@${encodeURIComponent("/cloudsql/../wolf-intel-jakarta:asia-southeast2:wolf-command")}/wolf_command`, "host"],
  ];
  for (const [databaseUrl, reason] of rejected) {
    const result = decision(databaseUrl, "production");
    assert.equal(result.ok, false, databaseUrl);
    if (!result.ok) {
      assert.equal(result.reason, reason);
      assert.equal(result.message.includes(secret), false);
      assert.equal(result.message.includes("postgresql://"), false);
    }
  }
});

test("a refused or different runtime URL does not open or replace a connection", () => {
  const open = prepareRuntimeConnection(localUrl, { NODE_ENV: "development" }, null);
  assert.deepEqual(open, { action: "open", databaseUrl: localUrl });
  assert.deepEqual(prepareRuntimeConnection(localUrl, { NODE_ENV: "development" }, localUrl), { action: "reuse" });

  const homebrew = prepareRuntimeConnection(
    `postgresql://wolf:${secret}@127.0.0.1:5432/wolf_command`,
    { NODE_ENV: "development" },
    null,
  );
  assert.equal(homebrew.action, "refuse");
  if (homebrew.action === "refuse") {
    assert.equal(homebrew.message.includes(secret), false);
    assert.equal(homebrew.message.includes("5432"), false);
  }

  const replaced = prepareRuntimeConnection(productionUrl, { NODE_ENV: "production" }, localUrl);
  assert.equal(replaced.action, "refuse");
  if (replaced.action === "refuse") {
    assert.equal(replaced.message.includes(secret), false);
    assert.equal(replaced.message.includes(localUrl), false);
    assert.equal(replaced.message.includes(productionUrl), false);
  }
});
