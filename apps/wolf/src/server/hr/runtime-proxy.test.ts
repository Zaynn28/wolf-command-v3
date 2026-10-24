import assert from "node:assert/strict";
import test from "node:test";
import { hrisRuntimeOrigin, normalizeHrProxyPath, rewriteHrisRuntimeText } from "./hris-proxy";

test("the HR runtime origin cannot be pointed at another host", () => {
  assert.equal(hrisRuntimeOrigin({}), "http://127.0.0.1:3011");
  assert.equal(hrisRuntimeOrigin({ WOLF_HR_RUNTIME_ORIGIN: "http://127.0.0.1:3011" }), "http://127.0.0.1:3011");
  assert.equal(hrisRuntimeOrigin({ WOLF_HR_RUNTIME_ORIGIN: "http://example.com" }), null);
  assert.equal(hrisRuntimeOrigin({ WOLF_HR_RUNTIME_ORIGIN: "http://127.0.0.1:3000" }), null);
  assert.equal(hrisRuntimeOrigin({ NODE_ENV: "production" }), null);
  assert.equal(hrisRuntimeOrigin({ NODE_ENV: "production", WOLF_HR_RUNTIME_ORIGIN: "http://127.0.0.1:3011" }), null);
});

test("HR asset text stays on the Wolf company runtime path", () => {
  const rewritten = rewriteHrisRuntimeText(
    `fetch('http://localhost:3001/api/employees'); <script src="/src/main.tsx"></script>`,
    "/hr/bzg/runtime",
  );
  assert.match(rewritten, /fetch\('\/hr\/bzg\/runtime\/api\/employees'\)/);
  assert.match(rewritten, /src="\/hr\/bzg\/runtime\/src\/main.tsx"/);
  assert.equal(rewritten.includes("3001"), false);
});

test("encoded traversal stays blocked", () => {
  assert.equal(normalizeHrProxyPath("/../server/index.js"), null);
  assert.equal(normalizeHrProxyPath("/%2e%2e/package.json"), null);
  assert.equal(normalizeHrProxyPath("/src/main.tsx"), "/src/main.tsx");
});
