import { resolveRuntimeDatabaseTarget } from "../db/runtime-database";

export type AuthEnv = {
  DATABASE_URL?: string;
  NODE_ENV?: string;
  WOLF_COOKIE_SECURE?: string;
};

export type AuthConfig = {
  databaseUrl: string;
  cookieSecure: boolean;
};

export function readAuthConfig(env: AuthEnv): AuthConfig | null {
  const target = resolveRuntimeDatabaseTarget(env);
  if (!target.ok) return null;

  const cookieSecure =
    env.WOLF_COOKIE_SECURE === "1" || (env.NODE_ENV === "production" && env.WOLF_COOKIE_SECURE !== "0");

  return { databaseUrl: target.databaseUrl, cookieSecure };
}
