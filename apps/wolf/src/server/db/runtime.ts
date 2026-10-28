import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { postgresHostOverride, prepareRuntimeConnection } from "./runtime-database";
import * as schema from "./schema";
import type { AuthDatabase } from "./types";

const globalForDb = globalThis as typeof globalThis & {
  wolfAuthDb?: AuthDatabase;
  wolfAuthDbUrl?: string;
};

export function getDb(databaseUrl: string): AuthDatabase {
  const prepared = prepareRuntimeConnection(databaseUrl, process.env, globalForDb.wolfAuthDbUrl ?? null);
  if (prepared.action === "reuse") {
    if (!globalForDb.wolfAuthDb) throw new Error("Database connection is unavailable.");
    return globalForDb.wolfAuthDb;
  }
  if (prepared.action === "refuse") throw new Error(prepared.message);

  const client = postgres(prepared.databaseUrl, {
    max: 5,
    prepare: false,
    connect_timeout: 10,
    debug: false,
    onnotice() {},
    ...postgresHostOverride(prepared.databaseUrl),
  });
  const db = drizzle({ client, schema }) as unknown as AuthDatabase;
  globalForDb.wolfAuthDb = db;
  globalForDb.wolfAuthDbUrl = prepared.databaseUrl;
  return db;
}
