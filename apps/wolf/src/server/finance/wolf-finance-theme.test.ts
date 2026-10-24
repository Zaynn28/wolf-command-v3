import assert from "node:assert/strict";
import test from "node:test";
import { injectWolfFinanceTheme } from "./wolf-finance-theme";

const page = `<!doctype html><html><head><title>Atrium Finance</title></head><body class="bg-slate-50 text-slate-900"><div id="root"></div></body></html>`;

test("the finance theme is injected once and keeps the Atrium document", () => {
  const themed = injectWolfFinanceTheme(page);
  assert.equal(themed.includes("wolf-finance-theme"), true);
  assert.equal(themed.includes("#F5F7F9"), true);
  assert.equal(themed.includes("#FFFFFF"), true);
  assert.equal(themed.includes("#1D3045"), true);
  assert.equal(themed.includes("#ECB956"), true);
  assert.equal(themed.includes("#16181b"), false);
  assert.equal(themed.includes("#d7a15a"), false);
  assert.match(themed, /\[class\*="bg-white\/"\]/);
  assert.match(themed, /\[class\*="text-right"\]\[class\*="text-emerald"\]/);
  assert.equal(themed.includes('[class*="text-emerald-6"]'), false);
  assert.match(themed, /\.report-preview-active\.bg-white thead/);
  assert.match(themed, /@media screen/);
  assert.equal(themed.includes("<div id=\"root\"></div>"), true);
  assert.equal(injectWolfFinanceTheme(themed), themed);
});
