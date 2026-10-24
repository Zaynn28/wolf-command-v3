import type { Action, Actor } from "@wolf/shared";
import type { AuthDatabase } from "../db/types";
import { writeAudit } from "../auth/audit";
import { readSession } from "../auth/session";
import { loadTrustedActor } from "./actor";
import { authorizeProvisioning, departmentServesModule, evaluateModuleAccess, readableModules, type ModuleId } from "./matrix";

export type OperationalRecord = {
  id: string;
  module: "finance" | "hr" | "academy" | "content";
  companyId: string;
  departmentId: string | null;
  title: string;
};

export type ModuleQuery = {
  companyId?: string | null;
  departmentId?: string | null;
  userId?: string | null;
  role?: string | null;
  grant?: string | null;
};

export type ModuleView =
  | { state: "signed_out" }
  | { state: "password_change_required"; email: string }
  | { state: "denied"; email: string; reason: string }
  | {
      state: "allowed";
      email: string;
      module: ModuleId;
      action: Action;
      companyId: string | null;
      departmentIds: string[];
      companyWide: boolean;
      records: OperationalRecord[];
      readable: ModuleId[];
      canAdminister: boolean;
      persisted: false;
    };

const operational = new Set<ModuleId>(["finance", "hr", "academy", "content"]);

export async function openModule(
  db: AuthDatabase,
  token: string | null,
  now: Date,
  module: ModuleId,
  action: Action,
  query: ModuleQuery,
  source: readonly OperationalRecord[] = [],
): Promise<ModuleView> {
  const session = await readSession(db, token, now);
  if (!session) return { state: "signed_out" };
  if (session.mustChangePassword) return { state: "password_change_required", email: session.email };

  const actor = await loadTrustedActor(db, session.userId);
  if (!actor) return { state: "signed_out" };

  const trustedQuery = { companyId: query.companyId ?? null, departmentId: query.departmentId ?? null };
  const companies = [
    ...new Set(actor.memberships.map((membership) => membership.companyId)),
  ];
  if (!trustedQuery.companyId && companies.length > 1 && module !== "owner_private" && module !== "settings") {
    if (action !== "read") {
      await writeAudit(db, {
        eventType: "authorization_denied",
        userId: actor.userId,
        emailFingerprint: null,
        ip: null,
        metadata: { module, action, reason: "module_scope", companyId: null },
        createdAt: now,
      });
      return { state: "denied", email: session.email, reason: "module_scope" };
    }
    const records: OperationalRecord[] = [];
    let reason = "module_scope";
    for (const companyId of companies) {
      const decision = evaluateModuleAccess(actor, module, action, { ...trustedQuery, companyId });
      if (decision.outcome === "allow" && action === "read") {
        reason = decision.reason;
        records.push(...selectOperationalRecords(actor, module, action, source));
      } else if (decision.outcome === "allow") {
        reason = decision.reason;
      }
    }
    const allowed = reason !== "module_scope" || records.length > 0;
    await writeAudit(db, {
      eventType: allowed ? "authorization_allowed" : "authorization_denied",
      userId: actor.userId,
      emailFingerprint: null,
      ip: null,
      metadata: { module, action, reason, companyId: null },
      createdAt: now,
    });
    if (!allowed) return { state: "denied", email: session.email, reason };
    return {
      state: "allowed",
      email: session.email,
      module,
      action,
      companyId: null,
      departmentIds: [],
      companyWide: false,
      records: uniqueRecords(records),
      readable: companies.flatMap((companyId) => readableModules(actor, companyId)),
      canAdminister: actor.memberships.some((membership) => authorizeProvisioning(actor, membership.companyId)),
      persisted: false,
    };
  }

  const decision = evaluateModuleAccess(actor, module, action, trustedQuery);
  await writeAudit(db, {
    eventType: decision.outcome === "allow" ? "authorization_allowed" : "authorization_denied",
    userId: actor.userId,
    emailFingerprint: null,
    ip: null,
    metadata: {
      module,
      action,
      reason: decision.reason,
      companyId: decision.companyId,
    },
    createdAt: now,
  });

  if (decision.outcome === "deny") {
    return { state: "denied", email: session.email, reason: decision.reason };
  }

  const records =
    action === "read" && operational.has(module) ? selectOperationalRecords(actor, module, action, source) : [];

  return {
    state: "allowed",
    email: session.email,
    module,
    action,
    companyId: decision.companyId,
    departmentIds: decision.departmentIds,
    companyWide: decision.companyWide,
    records,
    readable: decision.companyId ? readableModules(actor, decision.companyId) : [],
    canAdminister: actor.memberships.some((membership) => authorizeProvisioning(actor, membership.companyId)),
    persisted: false,
  };
}

export function selectOperationalRecords(
  actor: Actor,
  module: ModuleId,
  action: Action,
  source: readonly OperationalRecord[],
): OperationalRecord[] {
  if (!operational.has(module)) return [];
  return source.filter((record) => {
    if (record.module !== module) return false;
    if ((module === "finance" || module === "hr" || module === "content") && (!record.departmentId || !departmentServesModule(record.departmentId, module))) {
      return false;
    }
    if (module === "academy" && record.departmentId) return false;
    return (
      evaluateModuleAccess(actor, module, action, {
        companyId: record.companyId,
        departmentId: record.departmentId,
      }).outcome === "allow"
    );
  });
}

function uniqueRecords(records: OperationalRecord[]): OperationalRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  });
}
