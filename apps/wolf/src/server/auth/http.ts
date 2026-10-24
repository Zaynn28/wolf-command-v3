export function originsMatch(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function normalizeIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const value = ip.trim();
  if (!value || value.length > 64 || /[\s,]/.test(value)) return null;
  return value;
}

export function clientIpFromHeaders(headerList: { get(name: string): string | null }): string | null {
  const forwarded = headerList.get("x-forwarded-for");
  if (forwarded) return normalizeIp(forwarded.split(",")[0]);
  return normalizeIp(headerList.get("x-real-ip"));
}

export function sessionCookieOptions(expires: Date, secure: boolean) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    path: "/",
    secure,
    expires,
  };
}
