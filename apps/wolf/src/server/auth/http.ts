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

export function tokenFromCookieHeader(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
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
