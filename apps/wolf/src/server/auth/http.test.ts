import assert from "node:assert/strict";
import { test } from "node:test";
import { clientIpFromHeaders, normalizeIp, originsMatch, sessionCookieOptions } from "./http";

test("origin checks reject missing and cross-site requests", () => {
  assert.equal(originsMatch(null, "localhost:3000"), false);
  assert.equal(originsMatch("http://localhost:3000", null), false);
  assert.equal(originsMatch("http://localhost:3000", "localhost:3000"), true);
  assert.equal(originsMatch("https://evil.example", "localhost:3000"), false);
  assert.equal(originsMatch("not a url", "localhost:3000"), false);
});

test("client IP uses only the first forwarded hop", () => {
  assert.equal(
    clientIpFromHeaders({
      get(name) {
        return name === "x-forwarded-for" ? "203.0.113.4, 198.51.100.8" : null;
      },
    }),
    "203.0.113.4",
  );
  assert.equal(normalizeIp(" 203.0.113.4 "), "203.0.113.4");
  assert.equal(normalizeIp("bad ip"), null);
});

test("session cookies are HTTP-only with a site path and an explicit Secure flag", () => {
  const expires = new Date("2026-10-22T12:00:00.000Z");
  const local = sessionCookieOptions(expires, false);
  assert.equal(local.httpOnly, true);
  assert.equal(local.sameSite, "lax");
  assert.equal(local.path, "/");
  assert.equal(local.secure, false);
  assert.equal(local.expires, expires);
  assert.equal(sessionCookieOptions(expires, true).secure, true);
});
