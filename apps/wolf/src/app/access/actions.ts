"use server";

import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loadActorContext } from "@/server/access/session-actor";
import {
  assignAccessPosition,
  createAccessPosition,
  createAccessRole,
  deactivateAccessRole,
  duplicateAccessRole,
  openAccessDraft,
  publishAccessDraft,
  removeDraftRow,
  rollbackAccessPolicy,
  saveAccessAssignment,
  saveAccessException,
} from "@/server/access/policy-service";
import { saveOperatingRoleGrants } from "@/server/access/operating-grants";
import { originsMatch } from "@/server/auth/http";

type PolicyResult = { status: string; reason?: string };

export async function saveOperatingGrantsAction(formData: FormData): Promise<void> {
  const companyId = text(formData, "companyId");
  const result = await run(companyId, (db, actor, now) => saveOperatingRoleGrants(db, actor, {
    companyId,
    roleCode: text(formData, "roleCode"),
    offered: formData.getAll("offered").map(String),
    enabled: formData.getAll("enabled").map(String),
  }, now));
  finish(companyId, result, "grants-saved");
}

export async function createAccessRoleAction(formData: FormData): Promise<void> {
  const companyId = text(formData, "companyId");
  const result = await run(companyId, (db, actor, now) => createAccessRole(db, actor, {
    name: text(formData, "name"),
    description: text(formData, "description"),
    capabilityIds: formData.getAll("capabilityIds").map(String),
  }, now));
  finish(companyId, result, "role-saved");
}

export async function duplicateAccessRoleAction(formData: FormData): Promise<void> {
  const companyId = text(formData, "companyId");
  const result = await run(companyId, (db, actor, now) => duplicateAccessRole(db, actor, text(formData, "roleId"), now));
  finish(companyId, result, "role-copied");
}

export async function deactivateAccessRoleAction(formData: FormData): Promise<void> {
  const companyId = text(formData, "companyId");
  const result = await run(companyId, (db, actor, now) => deactivateAccessRole(db, actor, text(formData, "roleId"), now));
  finish(companyId, result, "role-inactive");
}

export async function createAccessPositionAction(formData: FormData): Promise<void> {
  const companyId = text(formData, "companyId");
  const result = await run(companyId, (db, actor, now) => createAccessPosition(db, actor, {
    companyId,
    departmentId: text(formData, "departmentId"),
    name: text(formData, "name"),
    description: text(formData, "description"),
    reportsToId: text(formData, "reportsToId"),
    suggestedRoleId: text(formData, "suggestedRoleId"),
  }, now));
  finish(companyId, result, "position-saved");
}

export async function assignAccessPositionAction(formData: FormData): Promise<void> {
  const companyId = text(formData, "companyId");
  const result = await run(companyId, (db, actor, now) => assignAccessPosition(db, actor, {
    positionId: text(formData, "positionId"),
    email: text(formData, "email"),
  }, now));
  finish(companyId, result, "position-assigned");
}

export async function openAccessDraftAction(formData: FormData): Promise<void> {
  const companyId = text(formData, "companyId");
  const result = await run(companyId, (db, actor, now) => openAccessDraft(db, actor, companyId, text(formData, "reason"), now));
  finish(companyId, result, "draft-open");
}

export async function saveAccessAssignmentAction(formData: FormData): Promise<void> {
  const companyId = text(formData, "companyId");
  const result = await run(companyId, (db, actor, now) => saveAccessAssignment(db, actor, {
    companyId,
    email: text(formData, "email"),
    roleId: text(formData, "roleId"),
    departmentId: text(formData, "departmentId"),
  }, now));
  finish(companyId, result, "assignment-saved");
}

export async function saveAccessExceptionAction(formData: FormData): Promise<void> {
  const companyId = text(formData, "companyId");
  const result = await run(companyId, (db, actor, now) => saveAccessException(db, actor, {
    companyId,
    email: text(formData, "email"),
    capabilityId: text(formData, "capabilityId"),
    effect: text(formData, "effect"),
    departmentId: text(formData, "departmentId"),
    justification: text(formData, "justification"),
    expiresOn: text(formData, "expiresOn"),
  }, now));
  finish(companyId, result, "exception-saved");
}

export async function removeDraftRowAction(formData: FormData): Promise<void> {
  const companyId = text(formData, "companyId");
  const result = await run(companyId, (db, actor, now) => removeDraftRow(db, actor, {
    companyId,
    assignmentId: text(formData, "assignmentId"),
  }, now));
  finish(companyId, result, "assignment-removed");
}

export async function publishAccessDraftAction(formData: FormData): Promise<void> {
  const companyId = text(formData, "companyId");
  const result = await run(companyId, (db, actor, now) => publishAccessDraft(db, actor, companyId, text(formData, "reason"), now));
  finish(companyId, result, "published");
}

export async function rollbackAccessPolicyAction(formData: FormData): Promise<void> {
  const companyId = text(formData, "companyId");
  const result = await run(companyId, (db, actor, now) => rollbackAccessPolicy(db, actor, text(formData, "versionId"), text(formData, "reason"), now));
  finish(companyId, result, "rolled-back");
}

async function run(
  companyId: string,
  work: (
    db: Extract<Awaited<ReturnType<typeof loadActorContext>>, { status: "ready" }>["db"],
    actor: Extract<Awaited<ReturnType<typeof loadActorContext>>, { status: "ready" }>["actor"],
    now: Date,
  ) => Promise<PolicyResult>,
): Promise<PolicyResult> {
  const headerList = await headers();
  if (!originsMatch(headerList.get("origin"), headerList.get("host"))) return { status: "invalid", reason: "The request origin was rejected." };
  const context = await loadActorContext();
  if (context.status !== "ready") return { status: "denied" };
  return work(context.db, context.actor, new Date());
}

function finish(companyId: string, result: PolicyResult, notice: string): never {
  const params = new URLSearchParams();
  if (companyId) params.set("companyId", companyId);
  if (result.status === "ok") params.set("notice", notice);
  else if (result.status === "denied") params.set("notice", "denied");
  else {
    params.set("notice", "invalid");
    if (result.reason) params.set("reason", result.reason.slice(0, 200));
  }
  redirect(`/access?${params.toString()}`);
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}
