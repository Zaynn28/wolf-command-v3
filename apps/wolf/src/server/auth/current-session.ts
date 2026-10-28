import "server-only";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { getDb } from "../db/runtime";
import { readAuthConfig } from "./config";
import { sessionCookieName } from "./constants";
import { tokenFromCookieHeader } from "./http";
import { readSession } from "./session";

export async function readSessionToken(): Promise<string | null> {
  try {
    return (await cookies()).get(sessionCookieName)?.value ?? null;
  } catch (error) {
    // Next 16 dev throws this while a server action re-renders the layout
    // before the request phase leaves "action". The incoming Cookie header
    // is the session for that render.
    if (!(error instanceof Error) || error.name !== "InvariantError" || !error.message.includes("mutableCookies")) throw error;
    return tokenFromCookieHeader((await headers()).get("cookie"), sessionCookieName);
  }
}

export async function readSignedInAccount(): Promise<{ email: string; mustChangePassword: boolean } | null> {
  await connection();
  const token = await readSessionToken();
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
