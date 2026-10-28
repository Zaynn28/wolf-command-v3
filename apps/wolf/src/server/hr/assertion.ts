import { createHmac, timingSafeEqual } from "node:crypto";
import type { HrCompanyDecision } from "./companies";

const issuer = "wolf";
const audience = "hris";
const ttlSeconds = 120;

function configuredSecretAccepted(value: string): boolean {
  if (value.length < 32 || value.length > 512) return false;
  if (/\s/.test(value)) return false;
  return new Set(value).size >= 8;
}

/**
 * Production and development both read WOLF_HR_ASSERTION_SECRET from the
 * process environment. A future Cloud Run or GKE deploy injects that value
 * from Secret Manager. A missing or weak value fails closed. This function
 * does not generate, trim, or print a secret.
 */
export function resolveHrAssertionSecret(env: Record<string, string | undefined>): string | null {
  const raw = env.WOLF_HR_ASSERTION_SECRET;
  if (typeof raw !== "string" || raw === "") return null;
  return configuredSecretAccepted(raw) ? raw : null;
}

export function hrAssertionCookieSecure(env: Record<string, string | undefined>, protocol: string): boolean {
  if (env.NODE_ENV === "production") return true;
  if (env.WOLF_COOKIE_SECURE === "0") return false;
  if (env.WOLF_COOKIE_SECURE === "1") return true;
  return protocol === "https:";
}

export type HrAssertion = {
  iss: typeof issuer;
  aud: typeof audience;
  sub: string;
  companyId: "amg" | "bzg" | "ggv";
  iat: number;
  exp: number;
  jti: string;
  workspace?: "hr" | "self";
};

export function signHrAssertion(
  secret: string,
  claims: { sub: string; companyId: HrAssertion["companyId"]; iat: number; jti: string; workspace?: "hr" | "self" },
): string {
  const payload: HrAssertion = {
    iss: issuer,
    aud: audience,
    sub: claims.sub,
    companyId: claims.companyId,
    iat: claims.iat,
    exp: claims.iat + ttlSeconds,
    jti: claims.jti,
    ...(claims.workspace === "hr" || claims.workspace === "self" ? { workspace: claims.workspace } : {}),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

/** Signature and claim shape only. Expiry and the expected user are checked separately so a live Wolf session can refresh an expired company assertion. */
export function readSignedHrAssertion(token: string, secret: string): HrAssertion | null {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expectedSignature = createHmac("sha256", secret).update(parts[0]).digest("base64url");
  const actual = Buffer.from(parts[1]);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (actual.length !== expectedBuffer.length || !timingSafeEqual(actual, expectedBuffer)) return null;
  let parsed: HrAssertion;
  try {
    parsed = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as HrAssertion;
  } catch {
    return null;
  }
  if (parsed.iss !== issuer || parsed.aud !== audience) return null;
  if (parsed.companyId !== "amg" && parsed.companyId !== "bzg" && parsed.companyId !== "ggv") return null;
  if (typeof parsed.sub !== "string" || parsed.sub.trim() === "") return null;
  if (typeof parsed.jti !== "string" || parsed.jti.length < 16) return null;
  if (!Number.isFinite(parsed.iat) || !Number.isFinite(parsed.exp)) return null;
  if (parsed.exp - parsed.iat > ttlSeconds) return null;
  return parsed;
}

export function verifyHrAssertion(
  token: string,
  secret: string,
  nowSeconds: number,
  expected: { userId: string; companyId: string },
): HrAssertion | null {
  const parsed = readSignedHrAssertion(token, secret);
  if (!parsed) return null;
  if (parsed.sub !== expected.userId || parsed.companyId !== expected.companyId) return null;
  if (parsed.iat > nowSeconds + 30 || parsed.exp <= nowSeconds) return null;
  return parsed;
}

export function hrAssertionCookie(token: string, companyId: HrAssertion["companyId"], secure: boolean): string {
  const parts = [
    `wolf_hr_assertion=${token}`,
    "HttpOnly",
    "SameSite=Strict",
    `Path=/hr/${companyId}/runtime`,
    `Max-Age=${ttlSeconds}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readHrAssertionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== "wolf_hr_assertion") continue;
    const value = part.slice(separator + 1).trim();
    if (!value || /[\r\n]/.test(value)) return null;
    return value;
  }
  return null;
}

export function hrEmbeddedSession(
  opened: HrCompanyDecision,
  assertion: HrAssertion | null,
  email: string,
): { status: number; body: { error: string } | { companyId: string; orgId: string; email: string; access: "administrator" | "staff" | "employee" } } {
  if (opened.status !== "unlinked" || !assertion || assertion.companyId !== opened.companyId) {
    return { status: 403, body: { error: "HR is not available for this session." } };
  }
  return { status: 200, body: { companyId: opened.companyId, orgId: opened.orgId, email, access: opened.access } };
}
