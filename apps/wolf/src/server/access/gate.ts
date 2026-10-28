import "server-only";
import { connection } from "next/server";
import type { Action } from "@wolf/shared";
import { readAuthConfig } from "../auth/config";
import { readSessionToken } from "../auth/current-session";
import { getDb } from "../db/runtime";
import type { ModuleId } from "./matrix";
import { openModule, type ModuleQuery, type ModuleView } from "./open-module";

export type GuardedModuleState = ModuleView | { state: "unavailable" };

export async function loadGuardedModule(
  module: ModuleId,
  query: ModuleQuery,
  action: Action = "read",
): Promise<GuardedModuleState> {
  await connection();
  const token = await readSessionToken();
  if (!token) return { state: "signed_out" };
  const config = readAuthConfig(process.env);
  if (!config) return { state: "unavailable" };
  try {
    return await openModule(getDb(config.databaseUrl), token, new Date(), module, action, query);
  } catch {
    return { state: "unavailable" };
  }
}
