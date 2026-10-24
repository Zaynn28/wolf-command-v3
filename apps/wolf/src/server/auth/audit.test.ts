import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { sanitizeAuditMetadata } from "./audit";

test("audit metadata refuses credential fields", () => {
  assert.throws(() => sanitizeAuditMetadata({ code: "123456" }), /credential/);
  assert.throws(() => sanitizeAuditMetadata({ sessionToken: "abc" }), /credential/);
  assert.throws(() => sanitizeAuditMetadata({ password: "secret-value" }), /credential/);
  assert.throws(() => sanitizeAuditMetadata({ passwordHash: "$argon2id$secret" }), /credential/);
  assert.throws(() => sanitizeAuditMetadata({ note: "$argon2id$v=19$secret" }), /credential/);
  assert.throws(() => sanitizeAuditMetadata({ payload: "private record" }), /credential/);
  assert.deepEqual(sanitizeAuditMetadata({ reason: "mismatch", attempts: 1 }), {
    reason: "mismatch",
    attempts: 1,
  });
});

test("sign-in modules do not log", () => {
  const files = [
    "./login.ts",
    "./password.ts",
    "./provision.ts",
    "./session.ts",
    "../access/trusted.ts",
    "../../app/login/actions.ts",
    "../../app/account/password/actions.ts",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.equal(source.includes("console."), false, file);
  }
});
