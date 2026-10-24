import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { getDb } from "../db/runtime";
import { readAuthConfig } from "./config";
import { sessionCookieName } from "./constants";
import { readSession } from "./session";

export async function readSignedInAccount(): Promise<{ email: string; mustChangePassword: boolean } | null> {
  await connection();
  const jar = await cookies();
  const token = jar.get(sessionCookieName)?.value ?? null;
  if (!token) return null;
  const config = readAuthConfig(process.env);
  if (!config) return null;
  try {
    const session = await readSession(getDb(config.databaseUrl), token, new Date());
    if (!session) return null;
    return { email: session.email, mustChangePassword: session.mustChangePassword };
  } catch {
    return null;
  }
}

export async function readSignedInEmail(): Promise<string | null> {
  return (await readSignedInAccount())?.email ?? null;
}
