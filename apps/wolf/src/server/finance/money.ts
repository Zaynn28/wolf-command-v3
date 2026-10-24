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
