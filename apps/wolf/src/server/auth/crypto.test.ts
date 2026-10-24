import assert from "node:assert/strict";
import { test } from "node:test";
import { fingerprintEmail, generateSessionToken, hashSessionToken, normalizeEmail } from "./crypto";

test("session tokens are opaque and only their hash is comparable", () => {
  const first = generateSessionToken();
  const second = generateSessionToken();
  assert.notEqual(first, second);
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hashSessionToken(first), hashSessionToken(first));
  assert.notEqual(hashSessionToken(first), first);
  assert.notEqual(hashSessionToken(first), hashSessionToken(second));
});

test("email normalization rejects malformed addresses and keeps a stable form", () => {
  assert.equal(normalizeEmail("  Person@Wolf-Command.test "), "person@wolf-command.test");
  assert.equal(normalizeEmail("not-an-email"), null);
  assert.equal(normalizeEmail(""), null);
  const fingerprint = fingerprintEmail("person@wolf-command.test");
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(fingerprint.includes("person@wolf-command.test"), false);
});
