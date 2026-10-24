import { createHash, randomBytes } from "node:crypto";

export function normalizeEmail(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (value.length < 3 || value.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  return value;
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function fingerprintEmail(email: string): string {
  return createHash("sha256").update(`email\n${email}`).digest("hex");
}
