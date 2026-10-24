export type DevelopmentDatabaseEnv = {
  DATABASE_URL?: string;
  NODE_ENV?: string;
};

export type DevelopmentDatabaseRefusal =
  | "missing"
  | "malformed"
  | "host"
  | "port"
  | "database"
  | "production";

export type DevelopmentDatabaseTarget =
  | { ok: true; databaseUrl: string }
  | { ok: false; reason: DevelopmentDatabaseRefusal; message: string };

const allowedHost = "127.0.0.1";
const allowedPort = "5433";
const allowedDatabase = "wolf_command";

const refusalMessage: Record<DevelopmentDatabaseRefusal, string> = {
  missing: "Refusing database command. DATABASE_URL is missing.",
  malformed: "Refusing database command. DATABASE_URL is malformed.",
  host: "Refusing database command. DATABASE_URL host must be 127.0.0.1.",
  port: "Refusing database command. DATABASE_URL port must be 5433.",
  database: "Refusing database command. DATABASE_URL database must be wolf_command.",
  production: "Refusing database command while NODE_ENV is production.",
};

function refuse(reason: DevelopmentDatabaseRefusal): DevelopmentDatabaseTarget {
  return { ok: false, reason, message: refusalMessage[reason] };
}

export function resolveDevelopmentDatabaseTarget(env: DevelopmentDatabaseEnv): DevelopmentDatabaseTarget {
  if (env.NODE_ENV === "production") return refuse("production");

  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) return refuse("missing");

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return refuse("malformed");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return refuse("malformed");
  if (url.hostname !== allowedHost) return refuse("host");
  if (url.port !== allowedPort) return refuse("port");
  if (url.pathname !== `/${allowedDatabase}`) return refuse("database");

  return { ok: true, databaseUrl };
}
