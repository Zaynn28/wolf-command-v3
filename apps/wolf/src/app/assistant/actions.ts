"use server";

import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loadActorContext } from "@/server/access/session-actor";
import { clearAssistantSetup, saveAssistantSetup } from "@/server/ai/setup";
import { originsMatch } from "@/server/auth/http";

export async function saveAssistantSetupAction(formData: FormData): Promise<void> {
  const result = await run((db, actor, now) => saveAssistantSetup(db, actor, {
    model: text(formData, "model"),
    apiKey: text(formData, "apiKey"),
  }, process.env, now));
  finish(formData, result.status === "ok" ? "saved" : result.status, "reason" in result ? result.reason : undefined);
}

export async function clearAssistantSetupAction(formData: FormData): Promise<void> {
  const result = await run((db, actor, now) => clearAssistantSetup(db, actor, now));
  finish(formData, result.status === "ok" ? "cleared" : result.status);
}

async function run(
  work: (
    db: Extract<Awaited<ReturnType<typeof loadActorContext>>, { status: "ready" }>["db"],
    actor: Extract<Awaited<ReturnType<typeof loadActorContext>>, { status: "ready" }>["actor"],
    now: Date,
  ) => Promise<{ status: string; reason?: string }>,
): Promise<{ status: string; reason?: string }> {
  const headerList = await headers();
  if (!originsMatch(headerList.get("origin"), headerList.get("host"))) return { status: "invalid", reason: "The request origin was rejected." };
  const context = await loadActorContext();
  if (context.status !== "ready") return { status: "denied" };
  return work(context.db, context.actor, new Date());
}

function finish(formData: FormData, notice: string, reason?: string): never {
  const params = new URLSearchParams();
  const companyId = text(formData, "companyId");
  const conversation = text(formData, "conversation");
  if (companyId) params.set("companyId", companyId);
  if (conversation) params.set("conversation", conversation);
  params.set("notice", notice);
  if (reason) params.set("reason", reason.slice(0, 200));
  redirect(`/assistant?${params.toString()}`);
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}
