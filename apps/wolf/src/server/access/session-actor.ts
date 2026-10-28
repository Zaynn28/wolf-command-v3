import "server-only";
import { connection } from "next/server";
import type { Actor } from "@wolf/shared";
import { readAuthConfig } from "../auth/config";
import { readSessionToken } from "../auth/current-session";
import { readSession } from "../auth/session";
import { getDb } from "../db/runtime";
import type { AuthDatabase } from "../db/types";
import { loadTrustedActor } from "./actor";

export type ActorContext =
  | { status: "ready"; db: AuthDatabase; actor: Actor; email: string }
  | { status: "signed_out" | "password_change_required" | "unavailable" };

export async function loadActorContext(): Promise<ActorContext> {
  await connection();
  const token = await readSessionToken();
  if (!token) return { status: "signed_out" };
  const config = readAuthConfig(process.env);
  if (!config) return { status: "unavailable" };
  try {
    const db = getDb(config.databaseUrl);
    const session = await readSession(db, token, new Date());
    if (!session) return { status: "signed_out" };
    if (session.mustChangePassword) return { status: "password_change_required" };
    const actor = await loadTrustedActor(db, session.userId);
    if (!actor) return { status: "signed_out" };
    return { status: "ready", db, actor, email: session.email };
  } catch {
    return { status: "unavailable" };
  }
}
