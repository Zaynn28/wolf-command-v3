export type MoneyResult = { ok: true; units: bigint; canonical: string } | { ok: false; reason: string };

const amountPattern = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/;

export function parseMoney(input: string, scale: number): MoneyResult {
  if (!Number.isInteger(scale) || scale < 0 || scale > 4) return { ok: false, reason: "scale" };
  const trimmed = input.trim();
  const match = amountPattern.exec(trimmed);
  if (!match) return { ok: false, reason: "invalid" };
  const fraction = match[1] ?? "";
  if (fraction.length > scale) return { ok: false, reason: "scale" };
  const [whole] = trimmed.split(".");
  const digits = `${whole}${fraction.padEnd(scale, "0")}`;
  return { ok: true, units: BigInt(digits), canonical: formatUnits(BigInt(digits), scale) };
}

export function formatUnits(units: bigint, scale: number): string {
  const negative = units < BigInt(0);
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale) || "0";
  const fraction = scale === 0 ? "" : `.${digits.slice(digits.length - scale)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

export function addUnits(values: readonly bigint[]): bigint {
  return values.reduce((sum, value) => sum + value, BigInt(0));
}

export function storedNumeric(canonical: string): string {
  const parsed = parseMoney(canonical, 4);
  if (!parsed.ok) return canonical.includes(".") ? canonical.padEnd(canonical.split(".")[0].length + 5, "0") : `${canonical}.0000`;
  return formatUnits(parsed.units, 4);
}

export const bookCurrency = "IDR";
export const idrDisplayScale = 0;
export const internalScale = 4;
export const roundingModes = ["half-up", "half-even", "down"] as const;
export type RoundingMode = (typeof roundingModes)[number];

const internalDivisor = 10n ** BigInt(internalScale);

export function isRoundingMode(value: string): value is RoundingMode {
  return (roundingModes as readonly string[]).includes(value);
}

export function roundDocumentTotal(internalUnits: bigint, mode: RoundingMode = "half-up"): bigint {
  const negative = internalUnits < 0n;
  const absolute = negative ? -internalUnits : internalUnits;
  const whole = absolute / internalDivisor;
  const remainder = absolute % internalDivisor;
  const half = internalDivisor / 2n;
  let rounded = whole;
  if (mode === "half-up" && remainder >= half) rounded = whole + 1n;
  if (mode === "half-even" && (remainder > half || (remainder === half && whole % 2n === 1n))) rounded = whole + 1n;
  return negative ? -rounded : rounded;
}

export function weightedAverageUnitCost(
  onHandQty: bigint,
  onHandUnitCost: bigint,
  receiptQty: bigint,
  receiptUnitCost: bigint,
): bigint | null {
  if (onHandQty < 0n || receiptQty <= 0n || onHandUnitCost < 0n || receiptUnitCost < 0n) return null;
  const nextQty = onHandQty + receiptQty;
  if (nextQty <= 0n) return null;
  const value = onHandQty * onHandUnitCost + receiptQty * receiptUnitCost;
  return roundDiv(value, nextQty, "half-up");
}

function roundDiv(value: bigint, divisor: bigint, mode: RoundingMode): bigint {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / divisor;
  const remainder = absolute % divisor;
  const half = divisor / 2n;
  let rounded = whole;
  if (mode === "half-up" && remainder >= half) rounded = whole + 1n;
  if (mode === "half-even" && (remainder > half || (remainder === half && whole % 2n === 1n))) rounded = whole + 1n;
  return negative ? -rounded : rounded;
}
