import assert from "node:assert/strict";
import test from "node:test";
import { hrAssertionCookie, signHrAssertion, verifyHrAssertion } from "./assertion";
import { executeHrRuntime } from "./runtime-handler";

const secret = "local-test-assertion-secret-32chars";
const now = 1_700_000_000;
const env = { NODE_ENV: "development", WOLF_HR_ASSERTION_SECRET: secret };

function cookie(companyId: "amg" | "bzg" | "ggv", sub = "user-1") {
  return hrAssertionCookie(signHrAssertion(secret, { sub, companyId, iat: now, jti: "0123456789abcdef" }), companyId, false);
}

function request(path: string, method = "GET", headers?: Headers): Request {
  return new Request(`http://localhost:3015${path}`, { method, headers });
}

async function run(input: {
  path: string;
  method?: string;
  companyId?: string;
  actorStatus?: "ready" | "signed_out" | "password_change_required" | "unavailable";
  companyOpen?: boolean;
  hrAccess?: "administrator" | "staff" | "employee" | null;
  headers?: Headers;
  env?: Record<string, string | undefined>;
  body?: string;
  nowSeconds?: number;
}) {
  let called = false;
  let forwarded = "";
  const captured: { headers: Headers | null } = { headers: null };
  const result = await executeHrRuntime({
    request: input.body
      ? new Request(`http://localhost:3015/hr/${input.companyId ?? "bzg"}/runtime${input.path}`, {
          method: input.method ?? "GET",
          headers: input.headers,
          body: input.body,
        })
      : request(`/hr/${input.companyId ?? "bzg"}/runtime${input.path}`, input.method, input.headers),
    companyId: input.companyId ?? "bzg",
    path: input.path.replace(/^\//, ""),
    prefix: `/hr/${input.companyId ?? "bzg"}/runtime`,
    actorStatus: input.actorStatus ?? "ready",
    companyOpen: input.companyOpen ?? true,
    hrAccess: input.companyOpen === false ? null : input.hrAccess ?? "staff",
    userId: input.actorStatus === "signed_out" || input.actorStatus === "password_change_required" || input.actorStatus === "unavailable" ? null : "user-1",
    email: input.actorStatus === "ready" || input.actorStatus === undefined ? "person@example.test" : null,
    env: input.env ?? env,
    nowSeconds: input.nowSeconds ?? now,
    fetchImpl: async (url, init) => {
      called = true;
      forwarded = String(url);
      captured.headers = new Headers(init?.headers);
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  return {
    status: result.response.status,
    body: await result.response.json().catch(() => null),
    called,
    forwarded,
    forwardedHeaders: captured.headers,
    setCookie: result.response.headers.get("set-cookie"),
  };
}

function issuedAssertion(setCookie: string | null): string {
  const pair = setCookie?.split(";")[0] ?? "";
  const separator = pair.indexOf("=");
  return separator === -1 ? "" : pair.slice(separator + 1);
}

test("a signed-out request is denied before an unexpired assertion is accepted", async () => {
  const headers = new Headers({ cookie: cookie("bzg") });
  const result = await run({ path: "/__wolf/session", actorStatus: "signed_out", headers });
  assert.equal(result.status, 401);
  assert.equal(result.called, false);
  assert.equal(result.setCookie, null);
  assert.equal(JSON.stringify(result.body).includes("person@example.test"), false);
});

test("a revoked company membership is denied before an unexpired assertion is accepted", async () => {
  const headers = new Headers({ cookie: cookie("amg") });
  const result = await run({ path: "/__wolf/session", companyId: "amg", companyOpen: false, headers });
  assert.equal(result.status, 403);
  assert.equal(result.called, false);
});

test("a password change blocks the runtime even with a valid assertion", async () => {
  const headers = new Headers({ cookie: cookie("ggv") });
  const result = await run({ path: "/__wolf/session", companyId: "ggv", actorStatus: "password_change_required", headers });
  assert.equal(result.status, 403);
  assert.equal(result.called, false);
});

test("employee API calls require the company assertion and do not trust a browser header", async () => {
  const listed = await run({ path: "/api/employees" });
  const forgedHeader = await run({
    path: "/api/employees",
    headers: new Headers({ "x-wolf-hr-assertion": cookie("bzg").split("=")[1]?.split(";")[0] ?? "", "x-org-id": "amg" }),
  });
  const unknown = await run({ path: "/api/admin/mock-data" });
  const accepted = await run({ path: "/api/employees", headers: new Headers({ cookie: cookie("bzg"), "x-org-id": "amg", authorization: "Bearer secret" }) });
  assert.equal(listed.status, 403);
  assert.equal(listed.called, false);
  assert.equal(forgedHeader.status, 403);
  assert.equal(forgedHeader.called, false);
  assert.equal(unknown.status, 403);
  assert.match(JSON.stringify(unknown.body), /not connected/);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.called, true);
  assert.equal(accepted.forwarded, "http://127.0.0.1:3012/api/employees");
  assert.equal(accepted.forwardedHeaders?.get("cookie"), null);
  assert.equal(accepted.forwardedHeaders?.get("authorization"), null);
  assert.equal(accepted.forwardedHeaders?.get("x-org-id"), null);
  assert.equal(accepted.forwardedHeaders?.get("x-wolf-hr-assertion")?.includes("."), true);
});

test("an employee session opens the company and does not receive HR staff or payroll APIs", async () => {
  const headers = new Headers({ cookie: cookie("amg") });
  const session = await run({ path: "/__wolf/session", companyId: "amg", hrAccess: "employee", headers });
  assert.equal(session.status, 200);
  assert.equal((session.body as { access?: string }).access, "employee");
  assert.equal(JSON.stringify(session.body).includes("personId"), false);
  const employees = await run({ path: "/api/employees", companyId: "amg", hrAccess: "employee", headers });
  const payroll = await run({ path: "/api/payroll-periods", companyId: "amg", hrAccess: "employee", headers });
  const directSave = await run({
    path: "/api/employees/11111111-1111-1111-1111-111111111111",
    method: "PATCH",
    companyId: "amg",
    hrAccess: "employee",
    headers,
    body: "{}",
  });
  const ownRequest = await run({
    path: "/api/profile-change-requests",
    method: "POST",
    companyId: "amg",
    hrAccess: "employee",
    headers,
    body: "{}",
  });
  assert.equal(employees.status, 403);
  assert.equal(employees.called, false);
  assert.equal(payroll.status, 403);
  assert.equal(payroll.called, false);
  assert.equal(directSave.status, 403);
  assert.equal(directSave.called, false);
  assert.equal(ownRequest.status, 200);
  assert.equal(ownRequest.called, true);
});

test("an assertion for another company does not open this company", async () => {
  const headers = new Headers({ cookie: cookie("amg") });
  const result = await run({ path: "/__wolf/session", companyId: "bzg", headers });
  assert.equal(result.status, 403);
  assert.equal(result.called, false);
  assert.equal(result.setCookie, null);
});

test("a signed-in company session issues an assertion when the cookie is missing", async () => {
  const result = await run({ path: "/__wolf/session", companyId: "amg" });
  assert.equal(result.status, 200);
  assert.equal((result.body as { email?: string }).email, "person@example.test");
  assert.equal(result.called, false);
  const token = issuedAssertion(result.setCookie);
  assert.equal(verifyHrAssertion(token, secret, now + 10, { userId: "user-1", companyId: "amg" })?.companyId, "amg");
  assert.equal(verifyHrAssertion(token, secret, now + 121, { userId: "user-1", companyId: "amg" }), null);
});

test("an expired assertion is refreshed for the signed-in company and is not forwarded to the HR API", async () => {
  const headers = new Headers({ cookie: cookie("amg") });
  const session = await run({ path: "/__wolf/session", companyId: "amg", headers, nowSeconds: now + 121 });
  assert.equal(session.status, 200);
  assert.equal(session.called, false);
  const token = issuedAssertion(session.setCookie);
  assert.equal(verifyHrAssertion(token, secret, now + 121, { userId: "user-1", companyId: "amg" })?.sub, "user-1");
  assert.equal(verifyHrAssertion(token, secret, now + 242, { userId: "user-1", companyId: "amg" }), null);
  const api = await run({ path: "/api/employees", companyId: "amg", headers, nowSeconds: now + 121 });
  assert.equal(api.status, 403);
  assert.equal(api.called, false);
});

test("development file reads, traversal, and state changes do not reach the upstream", async () => {
  const fileRead = await run({ path: "/@fs/etc/passwd" });
  const encoded = await run({ path: "/%40fs/etc/passwd" });
  const post = await run({ path: "/src/main.tsx", method: "POST" });
  assert.equal(fileRead.status, 403);
  assert.equal(encoded.status, 403);
  assert.equal(post.status, 403);
  assert.equal(fileRead.called || encoded.called || post.called, false);
});

test("production does not call the Vite development server", async () => {
  const result = await run({
    path: "/",
    env: { NODE_ENV: "production", WOLF_HR_ASSERTION_SECRET: secret, WOLF_COOKIE_SECURE: "0" },
  });
  assert.equal(result.status, 503);
  assert.equal(result.called, false);
});

test("an expired assertion does not reach the HR API", async () => {
  const headers = new Headers({ cookie: cookie("bzg") });
  const result = await run({ path: "/api/employees", headers, nowSeconds: now + 121 });
  assert.equal(result.status, 403);
  assert.equal(result.called, false);
});

test("a missing assertion secret fails closed before the HR API", async () => {
  const page = await run({ path: "/", env: { NODE_ENV: "development" } });
  const api = await run({
    path: "/api/employees",
    headers: new Headers({ cookie: cookie("bzg") }),
    env: { NODE_ENV: "production" },
  });
  assert.equal(page.status, 503);
  assert.equal(api.status, 403);
  assert.equal(page.called || api.called, false);
});

test("production does not call the HR API", async () => {
  const result = await run({
    path: "/api/employees",
    headers: new Headers({ cookie: cookie("bzg") }),
    env: { NODE_ENV: "production", WOLF_HR_ASSERTION_SECRET: secret, WOLF_COOKIE_SECURE: "0" },
  });
  assert.equal(result.status, 503);
  assert.equal(result.called, false);
});
