import assert from "node:assert/strict";
import test from "node:test";
import {
  hrAssertionCookie,
  hrAssertionCookieSecure,
  hrEmbeddedSession,
  readHrAssertionCookie,
  resolveHrAssertionSecret,
  signHrAssertion,
  verifyHrAssertion,
} from "./assertion";
import { classifyHrProxyPath, hrProtectedDecision, hrProxySearch, hrUpstreamHeaders, normalizeHrProxyPath } from "./hris-proxy";

const secret = "local-test-assertion-secret-32chars";
const now = 1_700_000_000;

function token(companyId: "amg" | "bzg" | "ggv" = "bzg", sub = "user-1") {
  return signHrAssertion(secret, { sub, companyId, iat: now, jti: "0123456789abcdef" });
}

test("production refuses a missing, short, or low-diversity HR assertion secret", () => {
  assert.equal(resolveHrAssertionSecret({ NODE_ENV: "production" }), null);
  assert.equal(resolveHrAssertionSecret({ NODE_ENV: "development" }), null);
  assert.equal(resolveHrAssertionSecret({}), null);
  assert.equal(resolveHrAssertionSecret({ NODE_ENV: "production", WOLF_HR_ASSERTION_SECRET: "too-short" }), null);
  assert.equal(resolveHrAssertionSecret({ NODE_ENV: "production", WOLF_HR_ASSERTION_SECRET: "a".repeat(32) }), null);
  assert.equal(resolveHrAssertionSecret({ NODE_ENV: "development", WOLF_HR_ASSERTION_SECRET: `${secret} ` }), null);
  assert.equal(resolveHrAssertionSecret({ NODE_ENV: "production", WOLF_HR_ASSERTION_SECRET: secret }), secret);
  assert.equal(hrAssertionCookieSecure({ NODE_ENV: "production" }, "http:"), true);
  assert.equal(hrAssertionCookieSecure({ NODE_ENV: "production", WOLF_COOKIE_SECURE: "0" }, "http:"), true);
  assert.match(hrAssertionCookie(token(), "amg", hrAssertionCookieSecure({ NODE_ENV: "production", WOLF_COOKIE_SECURE: "0" }, "http:")), /Secure/);
  assert.equal(hrAssertionCookieSecure({ NODE_ENV: "development" }, "http:"), false);
  assert.equal(hrAssertionCookieSecure({ NODE_ENV: "development", WOLF_COOKIE_SECURE: "1" }, "http:"), true);
});

test("a tampered, expired, or cross-company assertion is rejected", () => {
  const valid = token();
  assert.ok(verifyHrAssertion(valid, secret, now + 10, { userId: "user-1", companyId: "bzg" }));
  assert.equal(verifyHrAssertion(`${valid}x`, secret, now + 10, { userId: "user-1", companyId: "bzg" }), null);
  assert.equal(verifyHrAssertion(valid, "another-secret-that-is-long-enough", now + 10, { userId: "user-1", companyId: "bzg" }), null);
  assert.equal(verifyHrAssertion(valid, secret, now + 10, { userId: "user-2", companyId: "bzg" }), null);
  assert.equal(verifyHrAssertion(valid, secret, now + 10, { userId: "user-1", companyId: "amg" }), null);
  assert.equal(verifyHrAssertion(valid, secret, now + 121, { userId: "user-1", companyId: "bzg" }), null);
  const forged = Buffer.from(JSON.stringify({
    iss: "wolf",
    aud: "somewhere-else",
    sub: "user-1",
    companyId: "bzg",
    iat: now,
    exp: now + 60,
    jti: "0123456789abcdef",
  })).toString("base64url");
  assert.equal(verifyHrAssertion(`${forged}.sig`, secret, now + 10, { userId: "user-1", companyId: "bzg" }), null);
  const unsigned = Buffer.from(JSON.stringify({ alg: "none", iss: "wolf", aud: "hris", sub: "user-1", companyId: "bzg", iat: now, exp: now + 60, jti: "0123456789abcdef" })).toString("base64url");
  assert.equal(verifyHrAssertion(`${unsigned}.`, secret, now + 10, { userId: "user-1", companyId: "bzg" }), null);
  assert.equal(verifyHrAssertion(unsigned, secret, now + 10, { userId: "user-1", companyId: "bzg" }), null);
});

test("the assertion cookie is not a query credential and the browser cannot read it", () => {
  const cookie = hrAssertionCookie(token(), "amg", false);
  assert.match(cookie, /^wolf_hr_assertion=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Path=\/hr\/amg\/runtime/);
  assert.equal(cookie.includes("?"), false);
  const read = readHrAssertionCookie(`theme=dark; ${cookie}`) ?? "";
  assert.equal(read.includes("."), true);
  assert.equal(read.includes("HttpOnly"), false);
});

test("the embedded session returns no employee records", () => {
  const assertion = verifyHrAssertion(token("ggv"), secret, now + 5, { userId: "user-1", companyId: "ggv" });
  const allowed = hrEmbeddedSession({ status: "unlinked", companyId: "ggv", orgId: "GGV", access: "staff" }, assertion, "person@example.test");
  assert.equal(allowed.status, 200);
  assert.deepEqual(Object.keys(allowed.body).sort(), ["access", "companyId", "email", "orgId"]);
  if (allowed.status === 200) assert.equal(allowed.body.access, "staff");
  const employee = hrEmbeddedSession({ status: "unlinked", companyId: "ggv", orgId: "GGV", access: "employee" }, assertion, "person@example.test");
  if (employee.status === 200) {
    assert.equal(employee.body.access, "employee");
    assert.equal("personId" in employee.body, false);
  }
  const denied = hrEmbeddedSession({ status: "denied" }, assertion, "person@example.test");
  assert.equal(denied.status, 403);
  assert.equal("email" in denied.body, false);
});

test("employee API paths stay on the company allowlist and browser identity headers are not forwarded", () => {
  assert.equal(classifyHrProxyPath("/api/employees"), "api");
  assert.equal(classifyHrProxyPath("/api/employees/emp-1"), "api");
  assert.equal(classifyHrProxyPath("/api/payroll-records/period-1"), "api");
  assert.equal(classifyHrProxyPath("/api/admin/mock-data"), "blocked");
  assert.equal(classifyHrProxyPath("/api"), "blocked");
  assert.equal(classifyHrProxyPath("/__wolf/session"), "session");
  assert.equal(classifyHrProxyPath("/src/main.tsx"), "upstream");
  assert.equal(classifyHrProxyPath("/@fs/etc/passwd"), "refused");
  assert.equal(classifyHrProxyPath("/@vite/client", "production"), "refused");
  assert.equal(classifyHrProxyPath("/node_modules/vite/dist/client/client.mjs", "production"), "refused");
  assert.equal(classifyHrProxyPath("/assets/app.js", "production"), "upstream");
  assert.equal(normalizeHrProxyPath("/%40fs/etc/passwd"), null);
  assert.equal(hrProxySearch("?import=&t=1"), "?import=&t=1");
  assert.equal(hrProxySearch("?url=http://evil.example"), null);
  const headers = hrUpstreamHeaders(new Headers({ cookie: "wolf_session=secret", authorization: "Bearer secret", "content-type": "text/css" }));
  assert.equal(headers.get("cookie"), null);
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("content-type"), "text/css");
});

test("sign-out and a revoked membership reject an unexpired assertion", () => {
  const stillValid = { actorStatus: "ready" as const, companyOpen: false, operation: "session" as const, method: "GET", assertionAccepted: true };
  assert.equal(hrProtectedDecision(stillValid).status, 403);
  assert.equal(hrProtectedDecision(stillValid).reason, "membership");
  const signedOut = hrProtectedDecision({ ...stillValid, actorStatus: "signed_out", companyOpen: true });
  assert.equal(signedOut.status, 401);
  assert.equal(signedOut.reason, "signed_out");
  const expiredPassword = hrProtectedDecision({ ...stillValid, actorStatus: "password_change_required", companyOpen: true });
  assert.equal(expiredPassword.status, 403);
  assert.equal(expiredPassword.reason, "session");
  const post = hrProtectedDecision({ actorStatus: "ready", companyOpen: true, operation: "upstream", method: "POST", assertionAccepted: true });
  assert.equal(post.status, 403);
  assert.equal(post.reason, "method");
  const api = hrProtectedDecision({ actorStatus: "ready", companyOpen: true, operation: "blocked", method: "GET", assertionAccepted: true });
  assert.equal(api.reason, "api");
});
