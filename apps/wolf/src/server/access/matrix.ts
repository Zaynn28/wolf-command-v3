import { authorize, type Action, type Actor, type Role } from "@wolf/shared";

export const moduleIds = [
  "overview",
  "finance",
  "hr",
  "academy",
  "content",
  "owner_private",
  "settings",
  "organization",
  "procurement",
] as const;

export type ModuleId = (typeof moduleIds)[number];

export type ModulePermission = "none" | "member" | "administrator" | "grant" | "self";

export type ModuleRule = {
  scope: "company" | "department" | "owner_private" | "self";
  departmentKey?: "finance" | "hr" | "content" | "procurement";
  read: ModulePermission;
  create: ModulePermission;
  update: ModulePermission;
  delete: ModulePermission;
  approve: ModulePermission;
};

/**
 * Least privilege. A signed-in user still needs a matching membership,
 * role, or explicit grant. A staff membership in one department opens only
 * the modules that department serves. Company-wide modules need a
 * company-wide membership or an administrator or owner membership.
 * Owner Private read is the explicit grant only. Approval is never implied.
 * Administrator means an administrator or owner membership. Provisioning is
 * stricter and is handled separately: owner does not administer accounts.
 */
export const moduleMatrix: Record<ModuleId, ModuleRule> = {
  overview: {
    scope: "company",
    read: "member",
    create: "none",
    update: "none",
    delete: "none",
    approve: "none",
  },
  finance: {
    scope: "department",
    departmentKey: "finance",
    read: "member",
    create: "member",
    update: "member",
    delete: "administrator",
    approve: "grant",
  },
  hr: {
    scope: "department",
    departmentKey: "hr",
    read: "member",
    create: "member",
    update: "member",
    delete: "administrator",
    approve: "grant",
  },
  academy: {
    scope: "company",
    read: "member",
    create: "administrator",
    update: "administrator",
    delete: "administrator",
    approve: "grant",
  },
  content: {
    scope: "department",
    departmentKey: "content",
    read: "member",
    create: "member",
    update: "member",
    delete: "administrator",
    approve: "grant",
  },
  owner_private: {
    scope: "owner_private",
    read: "grant",
    create: "none",
    update: "none",
    delete: "none",
    approve: "grant",
  },
  settings: {
    scope: "self",
    read: "self",
    create: "none",
    update: "none",
    delete: "none",
    approve: "none",
  },
  organization: {
    scope: "company",
    read: "member",
    create: "administrator",
    update: "administrator",
    delete: "none",
    approve: "grant",
  },
  procurement: {
    scope: "department",
    departmentKey: "procurement",
    read: "member",
    create: "member",
    update: "member",
    delete: "administrator",
    approve: "grant",
  },
};

export type AccessQuery = {
  companyId?: string | null;
  departmentId?: string | null;
};

export type ModuleEvaluation = {
  outcome: "allow" | "deny";
  reason: string;
  companyId: string | null;
  departmentIds: string[];
  companyWide: boolean;
};

export function isModuleId(value: string): value is ModuleId {
  return (moduleIds as readonly string[]).includes(value);
}

export function departmentServesModule(departmentId: string, module: ModuleId): boolean {
  const key = moduleMatrix[module].departmentKey;
  if (!key) return false;
  const value = departmentId.trim().toLowerCase();
  return value === key || value.endsWith(`-${key}`);
}

export function authorizeProvisioning(actor: Actor | null, companyId: string): boolean {
  if (!actor || companyId.trim() === "") return false;
  return actor.memberships.some(
    (membership) => membership.companyId === companyId && membership.role === "administrator",
  );
}

export function evaluateModuleAccess(
  actor: Actor | null,
  module: ModuleId,
  action: Action,
  query: AccessQuery = {},
): ModuleEvaluation {
  const rule = moduleMatrix[module];
  const permission = rule[action];
  if (permission === "none") {
    return deny("not_permitted", query.companyId ?? null);
  }

  if (rule.scope === "self") {
    return actor
      ? { outcome: "allow", reason: "self", companyId: null, departmentIds: [], companyWide: false }
      : deny("missing_actor", null);
  }

  if (!actor) return deny("missing_actor", query.companyId ?? null);

  if (module === "owner_private") {
    return evaluateOwnerPrivate(actor, action, query);
  }

  const companyIds = requestedCompanies(actor, query.companyId);
  if (query.companyId && companyIds.length === 0) {
    return deny("wrong_company", query.companyId);
  }
  if (companyIds.length === 0) return deny("membership", null);

  let allowed: ModuleEvaluation | null = null;
  for (const companyId of companyIds) {
    const decision = evaluateCompany(actor, module, action, companyId, query.departmentId ?? null);
    if (decision.outcome === "deny" && query.companyId) return { ...decision, companyId };
    if (decision.outcome === "allow") allowed = decision;
  }
  if (!allowed) {
    return deny("module_scope", query.companyId ?? companyIds[0] ?? null);
  }
  return { ...allowed, companyId: query.companyId ?? allowed.companyId };
}

export function readableModules(actor: Actor, companyId: string): ModuleId[] {
  return moduleIds.filter((module) => {
    if (module === "settings") return false;
    return evaluateModuleAccess(actor, module, "read", { companyId }).outcome === "allow";
  });
}

function evaluateOwnerPrivate(actor: Actor, action: Action, query: AccessQuery): ModuleEvaluation {
  const companies = actor.grants.filter((grant) => grant.type === "owner_private").map((grant) => grant.companyId);
  const requested = query.companyId?.trim() || null;
  if (requested && !companies.includes(requested)) {
    const decision = authorize({
      actor,
      action: action === "approve" ? "approve" : "read",
      resource: { kind: "owner_private", companyId: requested },
    });
    return deny(decision.reason.code, requested);
  }

  const target = requested ?? companies[0] ?? actor.memberships[0]?.companyId ?? "unscoped";
  if (action === "approve") {
    const decision = authorize({
      actor,
      action: "approve",
      resource: { kind: "owner_private", companyId: target },
    });
    return decision.outcome === "allow"
      ? { outcome: "allow", reason: decision.reason.code, companyId: target, departmentIds: [], companyWide: false }
      : deny(decision.reason.code, target);
  }

  const decision = authorize({
    actor,
    action: "read",
    resource: { kind: "owner_private", companyId: target },
  });
  if (decision.outcome !== "allow" || decision.resource?.kind !== "owner_private") {
    return deny(decision.reason.code, target);
  }
  return {
    outcome: "allow",
    reason: decision.reason.code,
    companyId: decision.resource.companyId,
    departmentIds: [],
    companyWide: false,
  };
}

function evaluateCompany(
  actor: Actor,
  module: ModuleId,
  action: Action,
  companyId: string,
  departmentId: string | null,
): ModuleEvaluation {
  const rule = moduleMatrix[module];
  const permission = rule[action];
  if (rule.scope === "department") {
    const companyWide = hasCompanyWideMembership(actor, companyId);
    const departments = candidateDepartments(actor, module, companyId, departmentId, companyWide);
    if (departments === null) return deny("module_scope", companyId);
    const resources = companyWide && !departmentId
      ? [{ kind: "company" as const, companyId }]
      : departments.map((candidate) => ({ kind: "department" as const, companyId, departmentId: candidate }));
    let reason = "membership";
    for (const resource of resources) {
      const decision = authorize({
        actor,
        action: permission === "grant" ? "approve" : action,
        resource,
      });
      if (decision.outcome === "deny") return deny(decision.reason.code, companyId);
      reason = decision.reason.code;
      const scopedDepartment = resource.kind === "department" ? resource.departmentId : null;
      if (!roleAllows(actor, companyId, scopedDepartment, permission)) return deny("role_required", companyId);
    }
    return {
      outcome: "allow",
      reason,
      companyId,
      departmentIds: departments,
      companyWide: companyWide && !departmentId,
    };
  }

  const decision = authorize({
    actor,
    action: permission === "grant" ? "approve" : action,
    resource: { kind: "company", companyId },
  });
  if (decision.outcome === "deny") return deny(decision.reason.code, companyId);
  if (!roleAllows(actor, companyId, null, permission)) return deny("role_required", companyId);
  if (!companyWideOrAdministrator(actor, companyId)) return deny("module_scope", companyId);
  return { outcome: "allow", reason: decision.reason.code, companyId, departmentIds: [], companyWide: false };
}

function candidateDepartments(
  actor: Actor,
  module: ModuleId,
  companyId: string,
  departmentId: string | null,
  companyWide: boolean,
): string[] | null {
  if (departmentId) {
    return departmentServesModule(departmentId, module) && coversDepartment(actor, companyId, departmentId)
      ? [departmentId]
      : null;
  }
  if (companyWide) return [];
  const departments = unique(
    actor.memberships
      .filter((membership) => membership.companyId === companyId)
      .map((membership) => membership.departmentId)
      .filter((value): value is string => !!value && departmentServesModule(value, module)),
  );
  return departments.length > 0 ? departments : null;
}

function companyWideOrAdministrator(actor: Actor, companyId: string): boolean {
  return actor.memberships.some(
    (membership) =>
      membership.companyId === companyId &&
      (membership.departmentId === null || membership.role === "administrator" || membership.role === "owner"),
  );
}

function hasCompanyWideMembership(actor: Actor, companyId: string): boolean {
  return actor.memberships.some((membership) => membership.companyId === companyId && membership.departmentId === null);
}

function coversDepartment(actor: Actor, companyId: string, departmentId: string): boolean {
  return actor.memberships.some(
    (membership) =>
      membership.companyId === companyId &&
      (membership.departmentId === null || membership.departmentId === departmentId),
  );
}

function roleAllows(
  actor: Actor,
  companyId: string,
  departmentId: string | null,
  permission: ModulePermission,
): boolean {
  if (permission === "member" || permission === "grant" || permission === "self") return true;
  if (permission === "none") return false;
  return actor.memberships.some((membership) => {
    if (membership.companyId !== companyId) return false;
    if (departmentId && membership.departmentId !== null && membership.departmentId !== departmentId) return false;
    return satisfiesAdministrator(membership.role);
  });
}

function satisfiesAdministrator(role: Role): boolean {
  return role === "administrator" || role === "owner";
}

function requestedCompanies(actor: Actor, companyId: string | null | undefined): string[] {
  const own = unique(actor.memberships.map((membership) => membership.companyId));
  if (!companyId) return own;
  return own.includes(companyId) ? [companyId] : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function deny(reason: string, companyId: string | null): ModuleEvaluation {
  return { outcome: "deny", reason, companyId, departmentIds: [], companyWide: false };
}
