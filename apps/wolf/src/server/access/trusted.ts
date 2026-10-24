import { authorize, type Action, type Actor } from "@wolf/shared";
import type { AuthDatabase } from "../db/types";
import { openModule } from "./open-module";

export type { GrantRecord, MembershipRecord } from "./actor";
export { loadTrustedActor, toActor } from "./actor";

export type OwnerPrivateView =
  | { state: "signed_out" }
  | { state: "password_change_required"; email: string }
  | { state: "denied"; email: string; reason: string }
  | { state: "allowed"; email: string; companyId: string };

export function decideOwnerPrivateRead(actor: Actor | null) {
  if (!actor) {
    return authorize({ actor: null, action: "read", resource: null });
  }

  const companies = actor.grants.filter((grant) => grant.type === "owner_private").map((grant) => grant.companyId);
  if (companies.length === 0) {
    const companyId = actor.memberships.find((membership) => membership.companyId)?.companyId ?? "unscoped";
    return authorize({
      actor,
      action: "read",
      resource: { kind: "owner_private", companyId },
    });
  }

  let decision = authorize({
    actor,
    action: "read",
    resource: { kind: "owner_private", companyId: companies[0] },
  });
  for (const companyId of companies) {
    decision = authorize({
      actor,
      action: "read",
      resource: { kind: "owner_private", companyId },
    });
    if (decision.outcome === "allow") return decision;
  }
  return decision;
}

export function decideTrustedRecord(
  actor: Actor | null,
  action: Action,
  record: { companyId: string; departmentId?: string },
) {
  if (record.departmentId) {
    return authorize({
      actor,
      action,
      resource: { kind: "department", companyId: record.companyId, departmentId: record.departmentId },
    });
  }
  return authorize({
    actor,
    action,
    resource: { kind: "company", companyId: record.companyId },
  });
}

export async function loadOwnerPrivateView(
  db: AuthDatabase,
  token: string | null,
  now: Date,
): Promise<OwnerPrivateView> {
  const opened = await openModule(db, token, now, "owner_private", "read", {});
  if (opened.state === "allowed") {
    return { state: "allowed", email: opened.email, companyId: opened.companyId ?? "unscoped" };
  }
  if (opened.state === "denied") return { state: "denied", email: opened.email, reason: opened.reason };
  if (opened.state === "password_change_required") return opened;
  return { state: "signed_out" };
}
