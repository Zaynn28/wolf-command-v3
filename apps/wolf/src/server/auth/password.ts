import { randomBytes } from "node:crypto";
import { hash, verify, type Algorithm } from "@node-rs/argon2";
import { authDefaults } from "./constants";

// Argon2id. The library exposes this as a const enum, which isolatedModules cannot import.
const argon2id: Algorithm = 2;

const passwordOptions = {
  algorithm: argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

let dummyHashPromise: Promise<string> | null = null;

export function acceptsNewPassword(password: string): boolean {
  return password.length >= authDefaults.passwordMinLength && password.length <= authDefaults.passwordMaxLength;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, passwordOptions);
}

export async function verifyPassword(encodedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(encodedHash, password);
  } catch {
    return false;
  }
}

export function dummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString("base64url"));
  return dummyHashPromise;
}
