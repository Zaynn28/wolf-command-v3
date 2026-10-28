import assert from "node:assert/strict";
import test from "node:test";
import { injectWolfFinanceTheme } from "./wolf-finance-theme";

const page = `<!doctype html><html><head><title>Atrium Finance</title></head><body class="bg-slate-50 text-slate-900"><div id="root"></div></body></html>`;

test("the finance theme is injected once and keeps the Atrium document", () => {
  const themed = injectWolfFinanceTheme(page);
  assert.equal(themed.includes("wolf-finance-theme"), true);
  assert.equal(themed.includes("#F5F7F9"), true);
  assert.equal(themed.includes("#182435"), true);
  assert.equal(themed.includes("#FFFFFF"), true);
  assert.equal(themed.includes("#1D3045"), true);
  assert.equal(themed.includes("#ECB956"), true);
  assert.equal(themed.includes("fill: currentColor"), false);
  assert.equal(themed.includes("stop-color: currentColor"), false);
  assert.match(themed, /button\.bg-slate-900[\s\S]*background-color: var\(--color-brand-navy\)/);
  assert.match(themed, /header\.sticky \{[\s\S]*width: 16\.25rem/);
  assert.match(themed, /main\[class\*="max-w-7xl"\] \{[\s\S]*max-width: none/);
  assert.match(themed, /main \[class~="text-white"\][\s\S]*color: var\(--color-text-primary\)/);
  assert.match(themed, /main \[class\*="bg-gradient"\][\s\S]*background-image: none/);
  assert.match(themed, /main \[class\*="text-rose"\][\s\S]*color: #9B3A32/);
  assert.match(themed, /Google Sheets Datastore/);
  assert.equal(themed.includes("'/api/"), false);
  assert.equal(themed.includes('"/api/'), false);
  assert.equal(themed.includes("#16181b"), false);
  assert.equal(themed.includes("#d7a15a"), false);
  assert.match(themed, /\[class\*="bg-white\/"\]/);
  assert.match(themed, /\[class\*="text-right"\]\[class\*="text-emerald"\]/);
  assert.equal(themed.includes('[class*="text-emerald-6"]'), false);
  assert.match(themed, /\.report-preview-active\.bg-white thead/);
  assert.match(themed, /@media screen/);
  assert.match(themed, /html, body, #root \{[\s\S]*height: 100%;[\s\S]*min-height: 100%;/);
  assert.match(themed, /#root > div > main \{[\s\S]*min-height: 0;[\s\S]*overflow-y: auto;/);
  assert.equal(themed.includes("<div id=\"root\"></div>"), true);
  assert.equal(injectWolfFinanceTheme(themed), themed);
});
