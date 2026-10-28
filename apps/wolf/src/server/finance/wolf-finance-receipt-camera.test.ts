import assert from "node:assert/strict";
import test from "node:test";
import { rewriteAmgRuntimeText } from "./amg-proxy";
import { injectWolfFinanceTheme, wolfFinanceReceiptCameraScript } from "./wolf-finance-theme";

const page = `<!doctype html><html><head><title>Atrium Finance</title></head><body><div id="root"></div></body></html>`;

function cameraScript(html: string): string {
  const start = html.indexOf('id="wolf-finance-receipt-camera"');
  const end = html.indexOf("</script>", start);
  assert.ok(start > 0 && end > start);
  return html.slice(start, end);
}

test("the receipt camera script opens the camera and survives the runtime rewrite", () => {
  const script = wolfFinanceReceiptCameraScript;
  assert.match(script, /getUserMedia\(\{audio:false,video:\{facingMode:\{ideal:"environment"\}\}\}\)/);
  assert.match(script, /Retake/);
  assert.match(script, /Preview ready/);
  assert.match(script, /Camera access was denied or is unavailable/);
  assert.match(script, /Choose file/);
  assert.match(script, /Quick Mock Data Presets/);
  assert.match(script, /Kitchen Fresh Herbs/);
  assert.match(script, /mock sample/);
  assert.match(script, /replace\(\/\\s\+\/g, " "\)/);
  assert.equal(script.includes("'/api/"), false);
  assert.equal(script.includes('"/api/'), false);
  assert.equal(script.includes('src="/'), false);

  const themed = injectWolfFinanceTheme(page);
  const injected = cameraScript(themed);
  assert.equal(injected.includes("getUserMedia"), true);
  assert.equal(injectWolfFinanceTheme(themed), themed);

  const rewritten = rewriteAmgRuntimeText(themed, "/finance/bzg/runtime", "bzg");
  const afterRewrite = cameraScript(rewritten);
  assert.equal(afterRewrite, injected);
  assert.equal(afterRewrite.includes("/finance/bzg/runtime"), false);
  assert.equal(afterRewrite.includes("'/api/"), false);
  assert.equal(afterRewrite.includes('"/api/'), false);
  assert.equal(afterRewrite.includes('src="/'), false);
});
