import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const envName = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function wolfEnvLocalPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../../.env.local");
}

export function assignEnvFromFile(contents: string, env: Record<string, string | undefined>): void {
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const assignment = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separator = assignment.indexOf("=");
    if (separator <= 0) continue;
    const key = assignment.slice(0, separator).trim();
    if (!envName.test(key) || env[key] !== undefined) continue;
    let value = assignment.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
}

export function loadWolfEnvFile(env: Record<string, string | undefined>): void {
  const path = wolfEnvLocalPath();
  if (!existsSync(path)) return;
  assignEnvFromFile(readFileSync(path, "utf8"), env);
}
