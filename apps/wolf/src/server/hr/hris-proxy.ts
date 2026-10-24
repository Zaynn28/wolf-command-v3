const allowedOrigin = "http://127.0.0.1:3011";
const allowedApiOrigin = "http://127.0.0.1:3012";

export function hrisRuntimeOrigin(env: Record<string, string | undefined>): string | null {
  if (env.NODE_ENV === "production") return null;
  const value = env.WOLF_HR_RUNTIME_ORIGIN ?? allowedOrigin;
  return value === allowedOrigin ? value : null;
}

export function hrisApiOrigin(env: Record<string, string | undefined>): string | null {
  if (env.NODE_ENV === "production") return null;
  const value = env.WOLF_HR_API_ORIGIN ?? allowedApiOrigin;
  return value === allowedApiOrigin ? value : null;
}

export function normalizeHrProxyPath(raw: string): string | null {
  const withoutQuery = raw.split("?")[0] ?? raw;
  let value = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  if (value.includes("\\") || value.includes("\0")) return null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) break;
      value = decoded;
    } catch {
      return null;
    }
  }
  if (!value.startsWith("/") || value.includes("..") || value.includes("\\") || value.includes("\0")) return null;
  if (value.includes("@fs") || value.includes("://")) return null;
  return value.replace(/\/{2,}/g, "/");
}

export function hrProxySearch(search: string): string | null {
  if (search.length > 2048 || /[\0\r\n\\]/.test(search)) return null;
  if (search.includes("..") || search.includes("@fs") || search.includes("://")) return null;
  return search;
}

const staticFile = /^\/[^/]+\.(?:svg|png|ico|webp|jpe?g|gif|woff2?|ttf|css|js|map)$/;

function developmentAsset(path: string): boolean {
  return (
    path === "/" ||
    path === "/index.html" ||
    path === "/favicon.ico" ||
    path.startsWith("/src/") ||
    path.startsWith("/@vite/") ||
    path === "/@react-refresh" ||
    path.startsWith("/node_modules/") ||
    path.startsWith("/assets/") ||
    staticFile.test(path)
  );
}

function productionAsset(path: string): boolean {
  return path === "/" || path === "/index.html" || path === "/favicon.ico" || path.startsWith("/assets/") || staticFile.test(path);
}

const companyApiPaths = [
  /^\/api\/health$/,
  /^\/api\/employees$/,
  /^\/api\/employees\/[^/]+$/,
  /^\/api\/departments$/,
  /^\/api\/departments\/[^/]+$/,
  /^\/api\/positions$/,
  /^\/api\/positions\/[^/]+$/,
  /^\/api\/attendance\/[^/]+$/,
  /^\/api\/leave-requests$/,
  /^\/api\/leave-requests\/[^/]+\/approve$/,
  /^\/api\/payroll-periods$/,
  /^\/api\/payroll-periods\/[^/]+\/approve$/,
  /^\/api\/payroll-records\/[^/]+$/,
  /^\/api\/audit-logs$/,
];

export function classifyHrProxyPath(path: string, mode: "development" | "production" = "development"): "api" | "blocked" | "session" | "upstream" | "refused" {
  if (path === "/api" || path.startsWith("/api/")) return companyApiPaths.some((pattern) => pattern.test(path)) ? "api" : "blocked";
  if (path === "/__wolf/session") return "session";
  return (mode === "production" ? productionAsset(path) : developmentAsset(path)) ? "upstream" : "refused";
}

export type HrActorGate = "ready" | "signed_out" | "password_change_required" | "unavailable";

/**
 * Wolf session and company membership are checked before the assertion.
 * A still-unexpired assertion does not keep access after sign-out or a revoked membership.
 */
export function hrProtectedDecision(input: {
  actorStatus: HrActorGate;
  companyOpen: boolean;
  operation: "api" | "blocked" | "session" | "upstream" | "refused";
  method: string;
  assertionAccepted: boolean;
}): { status: 200 | 401 | 403; reason: "allow" | "signed_out" | "session" | "membership" | "api" | "path" | "method" | "assertion" } {
  if (input.actorStatus !== "ready") {
    return input.actorStatus === "signed_out"
      ? { status: 401, reason: "signed_out" }
      : { status: 403, reason: "session" };
  }
  if (!input.companyOpen) return { status: 403, reason: "membership" };
  if (input.operation === "blocked") return { status: 403, reason: "api" };
  if (input.operation === "refused") return { status: 403, reason: "path" };
  if (input.operation === "api") {
    if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(input.method)) return { status: 403, reason: "method" };
    if (!input.assertionAccepted) return { status: 403, reason: "assertion" };
    return { status: 200, reason: "allow" };
  }
  if (input.method !== "GET" && input.method !== "HEAD") return { status: 403, reason: "method" };
  if (input.operation === "session" && !input.assertionAccepted) return { status: 403, reason: "assertion" };
  return { status: 200, reason: "allow" };
}

export function hrApiForwardHeaders(requestHeaders: Headers, assertion: string): Headers {
  const headers = new Headers();
  const contentType = requestHeaders.get("content-type");
  if (contentType && !/[\r\n]/.test(contentType)) headers.set("content-type", contentType);
  if (assertion && !/[\r\n]/.test(assertion)) headers.set("x-wolf-hr-assertion", assertion);
  return headers;
}

export function hrUpstreamHeaders(requestHeaders: Headers): Headers {
  const headers = new Headers();
  const contentType = requestHeaders.get("content-type");
  if (contentType && !/[\r\n]/.test(contentType)) headers.set("content-type", contentType);
  return headers;
}

export function hrResponseHeaders(contentType: string): Headers {
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-frame-options", "SAMEORIGIN");
  headers.set("content-security-policy", "frame-ancestors 'self'");
  return headers;
}

export function rewriteHrisRuntimeText(body: string, prefix: string): string {
  return body
    .replaceAll("http://localhost:3001/api", `${prefix}/api`)
    .replaceAll("http://127.0.0.1:3001/api", `${prefix}/api`)
    .replaceAll("'/api/", `'${prefix}/api/`)
    .replaceAll('"/api/', `"${prefix}/api/`)
    .replaceAll("`/api/", `\`${prefix}/api/`)
    .replaceAll('src="/', `src="${prefix}/`)
    .replaceAll("src='/", `src='${prefix}/`)
    .replaceAll('href="/@', `href="${prefix}/@`)
    .replaceAll('href="/src', `href="${prefix}/src`)
    .replaceAll('href="/node_modules', `href="${prefix}/node_modules`)
    .replaceAll('from "/', `from "${prefix}/`)
    .replaceAll("from '/", `from '${prefix}/`)
    .replaceAll('import "/', `import "${prefix}/`)
    .replaceAll("import '/", `import '${prefix}/`)
    .replaceAll('import("/', `import("${prefix}/`)
    .replaceAll("import('/", `import('${prefix}/`);
}
