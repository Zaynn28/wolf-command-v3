import { eq } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { writeAudit } from "../auth/audit";
import { aiProviderSettings } from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { isPlatformOperator } from "../admin/companies";
import { createGrokProvider, type GrokConfig } from "./grok";
import type { ModelProvider } from "./provider";

const providerId = "grok";
const defaultModel = "grok-4";

export type AssistantSetup = {
  canConfigure: boolean;
  ready: boolean;
  source: "portal" | "environment" | "none";
  model: string;
};

export async function readAssistantSetup(db: AuthDatabase, actor: Actor, env: NodeJS.ProcessEnv): Promise<AssistantSetup> {
  const stored = await storedProvider(db);
  const portalKey = cleanKey(stored?.apiKey ?? "");
  const environmentKey = cleanKey(env.XAI_API_KEY ?? "");
  const source = portalKey ? "portal" : environmentKey ? "environment" : "none";
  return {
    canConfigure: await isPlatformOperator(db, actor.userId),
    ready: source !== "none",
    source,
    model: cleanModel(stored?.model) ?? defaultModel,
  };
}

export async function saveAssistantSetup(
  db: AuthDatabase,
  actor: Actor,
  input: { model: string; apiKey: string },
  env: NodeJS.ProcessEnv,
  now: Date,
): Promise<{ status: "ok" } | { status: "denied" } | { status: "invalid"; reason: string }> {
  if (!(await isPlatformOperator(db, actor.userId))) return auditDenied(db, actor, now);
  const stored = await storedProvider(db);
  const model = cleanModel(input.model) ?? (input.model.trim() ? null : cleanModel(stored?.model) ?? defaultModel);
  if (!model) return { status: "invalid", reason: "Use a Grok model name." };
  const entered = input.apiKey.trim();
  const nextKey = entered ? cleanKey(entered) : cleanKey(stored?.apiKey ?? "");
  if (entered && !nextKey) return { status: "invalid", reason: "Enter an xAI key without spaces." };
  if (!nextKey && !cleanKey(env.XAI_API_KEY ?? "")) return { status: "invalid", reason: "Enter the xAI key." };
  await db.insert(aiProviderSettings).values({
    id: providerId,
    model,
    apiKey: entered ? nextKey : stored?.apiKey ?? null,
    updatedBy: actor.userId,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: aiProviderSettings.id,
    set: {
      model,
      apiKey: entered ? nextKey : stored?.apiKey ?? null,
      updatedBy: actor.userId,
      updatedAt: now,
    },
  });
  await auditAllowed(db, actor, now, "save");
  return { status: "ok" };
}

export async function clearAssistantSetup(
  db: AuthDatabase,
  actor: Actor,
  now: Date,
): Promise<{ status: "ok" } | { status: "denied" }> {
  if (!(await isPlatformOperator(db, actor.userId))) return auditDenied(db, actor, now);
  const stored = await storedProvider(db);
  if (stored) {
    await db.update(aiProviderSettings).set({
      apiKey: null,
      updatedBy: actor.userId,
      updatedAt: now,
    }).where(eq(aiProviderSettings.id, providerId));
  }
  await auditAllowed(db, actor, now, "clear");
  return { status: "ok" };
}

export async function openAssistantProvider(db: AuthDatabase, env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch): Promise<ModelProvider> {
  const stored = await storedProvider(db);
  const config: GrokConfig = {
    apiKey: cleanKey(stored?.apiKey ?? "") ?? cleanKey(env.XAI_API_KEY ?? "") ?? "",
    model: cleanModel(stored?.model) ?? defaultModel,
  };
  return createGrokProvider(config, fetchImpl);
}

async function storedProvider(db: AuthDatabase) {
  return (await db.select({
    model: aiProviderSettings.model,
    apiKey: aiProviderSettings.apiKey,
  }).from(aiProviderSettings).where(eq(aiProviderSettings.id, providerId)).limit(1))[0] ?? null;
}

function cleanModel(value: string | null | undefined): string | null {
  const model = value?.trim() ?? "";
  return /^grok-[a-z0-9][a-z0-9.-]{0,40}$/.test(model) ? model : null;
}

function cleanKey(value: string | null | undefined): string | null {
  const key = value?.trim() ?? "";
  if (key.length < 20 || key.length > 300) return null;
  if (/\s/.test(key) || !/^[\x21-\x7e]+$/.test(key)) return null;
  return key;
}

async function auditAllowed(db: AuthDatabase, actor: Actor, now: Date, action: string) {
  await writeAudit(db, {
    eventType: "authorization_allowed",
    userId: actor.userId,
    resourceType: "assistant",
    resourceId: providerId,
    emailFingerprint: null,
    ip: null,
    metadata: { module: "assistant", action },
    createdAt: now,
  });
}

async function auditDenied(db: AuthDatabase, actor: Actor, now: Date): Promise<{ status: "denied" }> {
  await writeAudit(db, {
    eventType: "authorization_denied",
    userId: actor.userId,
    resourceType: "assistant",
    resourceId: providerId,
    emailFingerprint: null,
    ip: null,
    metadata: { module: "assistant", action: "configure" },
    createdAt: now,
  });
  return { status: "denied" };
}
