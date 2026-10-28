import assert from "node:assert/strict";
import { test } from "node:test";
import { addUnits, parseMoney, roundDocumentTotal, weightedAverageUnitCost } from "./money";

test("money rejects scientific notation and extra scale", () => {
  assert.equal(parseMoney("1.2e1", 2).ok, false);
  assert.equal(parseMoney("1.230", 2).ok, false);
  assert.equal(parseMoney("-1.00", 2).ok, false);
  assert.equal(parseMoney("NaN", 2).ok, false);
});

test("money adds decimal text without binary floating point", () => {
  const first = parseMoney("0.10", 2);
  const second = parseMoney("0.20", 2);
  const total = parseMoney("0.30", 2);
  assert.equal(first.ok && second.ok && total.ok, true);
  if (!first.ok || !second.ok || !total.ok) return;
  assert.equal(addUnits([first.units, second.units]), total.units);
});

test("document totals round internal scale 4 to whole rupiah", () => {
  assert.equal(roundDocumentTotal(205714300n, "half-up"), 20571n);
  assert.equal(roundDocumentTotal(205715000n, "half-up"), 20572n);
  assert.equal(roundDocumentTotal(205715000n, "half-even"), 20572n);
  assert.equal(roundDocumentTotal(205725000n, "half-even"), 20572n);
  assert.equal(roundDocumentTotal(205715000n, "down"), 20571n);
});

test("weighted average cost uses the worked receipt example", () => {
  assert.equal(weightedAverageUnitCost(10n, 30000n, 5n, 36000n), 32000n);
});
