import assert from "node:assert/strict";
import { test } from "node:test";
import { addUnits, parseMoney } from "./money";

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
