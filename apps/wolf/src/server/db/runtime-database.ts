import { resolveDevelopmentDatabaseTarget } from "./database-target";

export type RuntimeDatabaseEnv = {
  DATABASE_URL?: string;
  NODE_ENV?: string;
};

export type RuntimeDatabaseRefusal =
  | "missing"
  | "malformed"
  | "host"
  | "port"
  | "database"
  | "credentials"
  | "tls";

export type RuntimeDatabaseTarget =
  | { ok: true; databaseUrl: string }
  | { ok: false; reason: RuntimeDatabaseRefusal; message: string };

const refusalMessage: Record<RuntimeDatabaseRefusal, string> = {
  missing: "Database configuration is missing.",
  malformed: "Database configuration is malformed.",
  host: "Database configuration host is not allowed.",
  port: "Database configuration port is not allowed.",
  database: "Database configuration database is not allowed.",
  credentials: "Database configuration credentials are incomplete.",
  tls: "Database configuration requires TLS.",
};

const productionTlsModes = new Set(["require", "verify-ca", "verify-full"]);
const cloudSqlSocket =
  /^\/cloudsql\/[a-z][a-z0-9-]{4,28}[a-z0-9]:[a-z]+(?:-[a-z0-9]+)*:[a-z][a-z0-9-]{0,96}[a-z0-9]$/;

function refuse(reason: RuntimeDatabaseRefusal): RuntimeDatabaseTarget {
  return { ok: false, reason, message: refusalMessage[reason] };
}

function isLoopbackOrWildcardHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || host === "::" || host === "::1") return true;
  if (host.startsWith("127.")) return true;
  return host.startsWith("::ffff:127.");
}

function parseDatabaseUrl(databaseUrl: string): URL | null {
  try {
    const url = new URL(databaseUrl);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;
    return url;
  } catch {
    return null;
  }
}

export function cloudSqlSocketPath(databaseUrl: string): string | null {
  const url = parseDatabaseUrl(databaseUrl);
  if (!url || !url.username || !url.password || url.port || url.search) return null;
  if (!/^\/[^/]+$/.test(url.pathname)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.hostname);
  } catch {
    return null;
  }
  return cloudSqlSocket.test(decoded) ? decoded : null;
}

export function postgresHostOverride(databaseUrl: string): { host?: string } {
  const socket = cloudSqlSocketPath(databaseUrl);
  return socket ? { host: socket } : {};
}

function resolveProductionDatabaseTarget(databaseUrl: string): RuntimeDatabaseTarget {
  const url = parseDatabaseUrl(databaseUrl);
  if (!url) return refuse("malformed");
  let decodedHost = url.hostname;
  try {
    decodedHost = decodeURIComponent(url.hostname);
  } catch {
    return refuse("malformed");
  }
  if (decodedHost.startsWith("/cloudsql/")) {
    if (!url.username || !url.password) return refuse("credentials");
    if (url.port) return refuse("port");
    if (!/^\/[^/]+$/.test(url.pathname)) return refuse("database");
    if (!cloudSqlSocket.test(decodedHost) || url.search) return refuse("host");
    return { ok: true, databaseUrl };
  }
  if (!url.hostname || isLoopbackOrWildcardHost(url.hostname)) return refuse("host");
  if (!/^[1-9][0-9]*$/.test(url.port) || Number(url.port) > 65535) return refuse("port");
  if (!/^\/[^/]+$/.test(url.pathname)) return refuse("database");
  if (!url.username || !url.password) return refuse("credentials");
  if (!productionTlsModes.has(url.searchParams.get("sslmode") ?? "")) return refuse("tls");
  return { ok: true, databaseUrl };
}

export function resolveRuntimeDatabaseTarget(env: RuntimeDatabaseEnv): RuntimeDatabaseTarget {
  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) return refuse("missing");
  if (env.NODE_ENV === "production") return resolveProductionDatabaseTarget(databaseUrl);

  const local = resolveDevelopmentDatabaseTarget({ DATABASE_URL: databaseUrl, NODE_ENV: "development" });
  if (!local.ok) return refuse(local.reason === "production" ? "host" : local.reason);
  return { ok: true, databaseUrl: local.databaseUrl };
}

export type PreparedRuntimeConnection =
  | { action: "open"; databaseUrl: string }
  | { action: "reuse" }
  | { action: "refuse"; message: string };

export function prepareRuntimeConnection(
  databaseUrl: string,
  env: RuntimeDatabaseEnv,
  openUrl: string | null,
): PreparedRuntimeConnection {
  const target = resolveRuntimeDatabaseTarget({ DATABASE_URL: databaseUrl, NODE_ENV: env.NODE_ENV });
  if (!target.ok) return { action: "refuse", message: target.message };
  if (openUrl === null) return { action: "open", databaseUrl: target.databaseUrl };
  if (openUrl === target.databaseUrl) return { action: "reuse" };
  return { action: "refuse", message: "Refusing to reuse a database connection opened for different configuration." };
}
