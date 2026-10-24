import assert from "node:assert/strict";
import { test } from "node:test";
import { amgProxyDecision, amgRuntimeOrigin, amgUpstreamHeaders, financeApiModule, isolatedCompanyResult, normalizeAmgProxyPath, procurementBlockedResult, procurementModuleLock, procurementRuntimeAllowed, redactAmgStatus, rewriteAmgRuntimeText, scrubAmgPayload, usesAmgProcessMemory } from "./amg-proxy";

test("a procurement account can open the procurement screen and no other finance feature", () => {
  assert.equal(procurementRuntimeAllowed("/"), true);
  assert.equal(procurementRuntimeAllowed("/src/main.tsx"), true);
  assert.equal(procurementRuntimeAllowed("/api/status"), true);
  assert.equal(procurementRuntimeAllowed("/api/inventory/purchase-orders"), true);
  assert.equal(procurementRuntimeAllowed("/api/accounts"), false);
  assert.equal(procurementRuntimeAllowed("/api/journals"), false);
  assert.equal(procurementRuntimeAllowed("/api/revenue"), false);
  assert.equal(procurementRuntimeAllowed("/api/spending"), false);
  assert.equal(procurementRuntimeAllowed("/api/ar/items"), false);
  assert.equal(procurementRuntimeAllowed("/api/ap/items"), false);
  assert.equal(procurementRuntimeAllowed("/api/dashboard"), false);
  assert.deepEqual(procurementBlockedResult("GET", "/api/journals"), { status: 200, body: [] });
  assert.deepEqual(procurementBlockedResult("GET", "/api/accounts"), { status: 200, body: [] });
  assert.equal(procurementBlockedResult("POST", "/api/journals").status, 403);
  assert.equal(procurementBlockedResult("POST", "/api/spending").status, 403);
  const lock = procurementModuleLock();
  assert.match(lock, /nav-operations-inventory/);
  assert.match(lock, /nav-pillar-operations/);
  assert.equal(lock.includes("/api/"), false);
});

test("the AMG runtime origin cannot be pointed at another host", () => {
  assert.equal(amgRuntimeOrigin({}), "http://127.0.0.1:3099");
  assert.equal(amgRuntimeOrigin({ WOLF_AMG_RUNTIME_ORIGIN: "http://sheets.example" }), null);
  assert.equal(amgRuntimeOrigin({ WOLF_AMG_RUNTIME_ORIGIN: "http://127.0.0.1:5432" }), null);
});

test("sheet sync, legacy login, and mock resets are blocked", () => {
  assert.equal(amgProxyDecision("/api/sheets/init"), "block");
  assert.equal(amgProxyDecision("/api/auth/verify-user"), "block");
  assert.equal(amgProxyDecision("/api/admin/mock-data/seed-demo"), "block");
  assert.equal(amgProxyDecision("/api/admin/access-control/switch-user"), "block");
  assert.equal(amgProxyDecision("/api/accounts"), "allow");
  assert.equal(amgProxyDecision("/api/journals"), "allow");
  assert.equal(amgProxyDecision("/src/main.tsx"), "allow");
});

test("the Atrium header name comes from the Wolf company route", () => {
  const header = `<span className="font-extrabold text-slate-900 tracking-tight text-sm uppercase truncate">PT ATRIUM MANAGEMENT GROUP</span> PT ATRIUM MANAGEMENT GROUP`;
  const bzg = rewriteAmgRuntimeText(header, "/finance/bzg/runtime", "bzg");
  assert.match(bzg, /truncate">BZG Finance/);
  assert.equal(bzg.includes("uppercase"), false);
  assert.match(bzg, / PT ATRIUM MANAGEMENT GROUP$/);
  const compiled = `jsxDEV("span", { className: "font-extrabold text-slate-900 tracking-tight text-sm uppercase truncate", children: "PT ATRIUM MANAGEMENT GROUP" }, void 0, false)`;
  assert.match(rewriteAmgRuntimeText(compiled, "/finance/ggv/runtime", "ggv"), /truncate", children: "GGV Finance"/);
  assert.match(rewriteAmgRuntimeText(header, "/finance/amg/runtime", "amg"), /AMG Finance/);
  assert.match(rewriteAmgRuntimeText(header, "/finance/ggv/runtime", "ggv"), /GGV Finance/);
  assert.match(rewriteAmgRuntimeText(header, "/finance/amg/runtime", "other-company"), /PT ATRIUM MANAGEMENT GROUP/);
  assert.equal(rewriteAmgRuntimeText(header, "/finance/bzg/runtime", "bzg").includes("bzg"), false);
});

test("AMG asset text stays on the Wolf runtime path", () => {
  const rewritten = rewriteAmgRuntimeText(`fetch('/api/accounts'); fetch(\`/api/journals/\${id}\`); <script src="/src/main.tsx"></script> import "/src/index.css";`);
  assert.match(rewritten, /fetch\('\/finance\/amg-runtime\/api\/accounts'\)/);
  assert.match(rewritten, /fetch\(`\/finance\/amg-runtime\/api\/journals\//);
  assert.match(rewritten, /src="\/finance\/amg-runtime\/src\/main.tsx"/);
  assert.match(rewritten, /import "\/finance\/amg-runtime\/src\/index.css"/);
});

test("encoded traversal and sheet routes stay blocked", () => {
  assert.equal(normalizeAmgProxyPath("/%2e%2e/%2e%2e/etc/passwd"), null);
  assert.equal(normalizeAmgProxyPath("/api/accounts/../sheets/init"), null);
  assert.equal(amgProxyDecision("/api/Sheets/init"), "block");
  assert.equal(amgProxyDecision("/%2e%2e/api/sheets/init"), "block");
  assert.equal(amgProxyDecision("/api/accounts"), "allow");
});

test("client identity headers are not forwarded", () => {
  const incoming = new Headers({
    "content-type": "application/json",
    cookie: "wolf_session=secret",
    authorization: "Bearer secret",
    "x-user-id": "attacker",
    "x-user-name": "attacker",
  });
  const headers = amgUpstreamHeaders(incoming, "operator@wolf-command.test");
  assert.equal(headers.get("x-user-name"), "operator@wolf-command.test");
  assert.equal(headers.get("x-user-id"), null);
  assert.equal(headers.get("cookie"), null);
  assert.equal(headers.get("authorization"), null);
});

test("AMG payloads drop credential fields without dropping account codes", () => {
  const scrubbed = scrubAmgPayload({ account_code: "1000", clientEmail: "svc@example.com", nested: { private_key: "key" } });
  assert.deepEqual(scrubbed, { account_code: "1000", nested: {} });
});

test("BZG and GGV do not receive AMG process-memory records", () => {
  assert.equal(usesAmgProcessMemory("amg"), true);
  assert.equal(usesAmgProcessMemory("bzg"), false);
  assert.equal(usesAmgProcessMemory("ggv"), false);
  assert.deepEqual(isolatedCompanyResult("GET", "/api/accounts"), { status: 200, body: [] });
  assert.deepEqual(isolatedCompanyResult("GET", "/api/journals?company=amg"), { status: 200, body: [] });
  assert.equal(isolatedCompanyResult("POST", "/api/accounts").status, 403);
  assert.equal(isolatedCompanyResult("POST", "/api/journals/abc/post").status, 403);
  assert.equal(isolatedCompanyResult("DELETE", "/api/accounts/1000").status, 403);
  const status = isolatedCompanyResult("GET", "/api/status").body as { spreadsheetId: string | null; connected: boolean };
  assert.equal(status.spreadsheetId, null);
  assert.equal(status.connected, false);
  assert.equal(financeApiModule("/api/inventory/items"), "inventory");
  assert.equal(financeApiModule("/api/tax/period-close"), "tax");
  assert.equal(financeApiModule("/api/accounts"), null);
});

test("AMG status redaction removes sheet identity", () => {
  const status = redactAmgStatus({
    connected: true,
    hasCredentials: true,
    spreadsheetId: "sheet",
    clientEmail: "svc@example.com",
    storeStats: { accounts: 0 },
  });
  assert.equal(status.connected, false);
  assert.equal(status.clientEmail, null);
  assert.equal(status.spreadsheetId, null);
  assert.deepEqual(status.storeStats, { accounts: 0 });
});
