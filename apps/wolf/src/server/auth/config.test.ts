import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readAuthConfig } from "./config";

const localUrl = "postgresql://wolf:wolf@127.0.0.1:5433/wolf_command";
const secret = "not-a-real-secret";
const productionUrl = `postgresql://app-user:${secret}@db.example.com:5432/wolf_command?sslmode=require`;

test("local development config accepts only the Wolf database and preserves the URL", () => {
  const config = readAuthConfig({ DATABASE_URL: localUrl, NODE_ENV: "development" });
  assert.ok(config);
  assert.equal(config.databaseUrl, localUrl);
  assert.equal(config.cookieSecure, false);
  assert.equal("smtp" in config, false);
  assert.equal("pepper" in config, false);

  const preserved = `${localUrl}?sslmode=disable`;
  assert.equal(readAuthConfig({ DATABASE_URL: preserved, NODE_ENV: "development" })?.databaseUrl, preserved);
  assert.equal(
    readAuthConfig({ DATABASE_URL: "postgres://wolf:wolf@127.0.0.1:5433/wolf_command" })?.databaseUrl,
    "postgres://wolf:wolf@127.0.0.1:5433/wolf_command",
  );
});

test("local development config rejects Homebrew, other databases, remote hosts, and malformed URLs", () => {
  const rejected = [
    "postgresql://wolf:wolf@127.0.0.1:5432/wolf_command",
    "postgresql://wolf:wolf@127.0.0.1:5434/wolf_command",
    "postgresql://wolf:wolf@127.0.0.1:5433/postgres",
    "postgresql://wolf:wolf@localhost:5433/wolf_command",
    "postgresql://wolf:wolf@db.example.com:5433/wolf_command",
    "not a url",
    "http://127.0.0.1:5433/wolf_command",
    "",
    "   ",
  ];
  for (const databaseUrl of rejected) {
    const config = readAuthConfig({ DATABASE_URL: databaseUrl, NODE_ENV: "development" });
    assert.equal(config, null);
    assert.equal(JSON.stringify(config)?.includes(secret), false);
  }
  assert.equal(readAuthConfig({ NODE_ENV: "development" }), null);
});

test("production config accepts an explicit remote TLS URL and does not reuse the local allowlist", () => {
  const config = readAuthConfig({ DATABASE_URL: productionUrl, NODE_ENV: "production" });
  assert.ok(config);
  assert.equal(config.databaseUrl, productionUrl);
  assert.equal(config.cookieSecure, true);
  assert.equal(
    readAuthConfig({ DATABASE_URL: productionUrl, NODE_ENV: "production", WOLF_COOKIE_SECURE: "0" })?.cookieSecure,
    false,
  );
  assert.equal(readAuthConfig({ DATABASE_URL: localUrl, NODE_ENV: "production" }), null);
  assert.equal(readAuthConfig({ DATABASE_URL: "postgresql://wolf:wolf@127.0.0.1:5432/wolf_command", NODE_ENV: "production" }), null);
  assert.equal(readAuthConfig({ NODE_ENV: "production" }), null);
  assert.equal(readAuthConfig({ DATABASE_URL: "postgresql://app-user:secret@db.example.com/wolf_command?sslmode=require", NODE_ENV: "production" }), null);
  assert.equal(readAuthConfig({ DATABASE_URL: productionUrl.replace("sslmode=require", "sslmode=disable"), NODE_ENV: "production" }), null);
  assert.equal(JSON.stringify(readAuthConfig({ DATABASE_URL: `postgresql://${secret}@127.0.0.1:5433/wolf_command`, NODE_ENV: "production" })), "null");
});

test("session cookie Secure flag can be forced in local development", () => {
  assert.equal(readAuthConfig({ DATABASE_URL: localUrl, NODE_ENV: "development", WOLF_COOKIE_SECURE: "1" })?.cookieSecure, true);
});

test("runtime connection setup refuses a disallowed URL before opening a client", () => {
  const source = readFileSync(new URL("../db/runtime.ts", import.meta.url), "utf8");
  const prepareAt = source.indexOf("prepareRuntimeConnection(");
  const connectAt = source.indexOf("postgres(");
  assert.ok(prepareAt >= 0);
  assert.ok(connectAt > prepareAt);
  assert.match(source, /onnotice\(\) \{\}/);
  assert.match(source, /prepared\.action === "refuse"/);
});
