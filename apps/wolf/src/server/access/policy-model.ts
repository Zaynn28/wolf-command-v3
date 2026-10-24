import type { Action, Actor, Grant, Membership, Role } from "@wolf/shared";
import { authorizeProvisioning } from "./matrix";
import { departmentServesModule, evaluateModuleAccess, moduleIds, moduleMatrix, type ModuleId } from "./matrix";
import { financeWorkspace, type FinanceWorkspace } from "../finance/companies";
import { hrAccess, type HrAccess } from "../hr/companies";

export const departmentKeys = ["finance", "hr", "content", "procurement"] as const;
export type DepartmentKey = (typeof departmentKeys)[number];

type Probe = { module: ModuleId; action: Action; departmentId?: string | null };

type MembershipShape = { role: Role; departmentKey: DepartmentKey | null };
type GrantShape =
  | { type: "owner_private" }
  | { type: "approve"; scope: "company" | "owner_private" | "department"; departmentKey: DepartmentKey | null };

export type AccessCapability = {
  id: string;
  label: string;
  description: string;
  availability: "assignable" | "unavailable" | "baseline";
  scopeLabel: string;
  warning?: string;
  unavailableReason?: string;
  membership?: MembershipShape;
  grant?: GrantShape;
  probe?: Probe;
};

const companyWarning = "Company-wide membership opens every department module in that company.";
const administratorWarning = "An administrator membership also opens company-wide modules and account provisioning. It does not grant Owner Private or approval.";
const ownerWarning = "An owner membership matches administrator module access. It does not provision accounts, and it does not grant Owner Private or approval.";

export const accessCapabilities: readonly AccessCapability[] = [
  {
    id: "membership.company.staff",
    label: "Company member",
    description: "Read overview, academy, and organization, and use every department module at member level. Delete and approval stay off.",
    availability: "assignable",
    scopeLabel: "company",
    warning: companyWarning,
    membership: { role: "staff", departmentKey: null },
    probe: { module: "overview", action: "read" },
  },
  {
    id: "membership.company.administrator",
    label: "Company administrator",
    description: "Administrator access for the company, including delete where the matrix requires an administrator.",
    availability: "assignable",
    scopeLabel: "company",
    warning: administratorWarning,
    membership: { role: "administrator", departmentKey: null },
    probe: { module: "academy", action: "create" },
  },
  {
    id: "membership.company.owner",
    label: "Company owner",
    description: "Owner membership for module access. Owner Private still needs its own grant.",
    availability: "assignable",
    scopeLabel: "company",
    warning: ownerWarning,
    membership: { role: "owner", departmentKey: null },
    probe: { module: "organization", action: "create" },
  },
  departmentMembership("finance", "staff", "Finance member", "Finance application at member level. This does not open HR."),
  departmentMembership("finance", "administrator", "Finance administrator", "Finance delete, company-wide modules, and account provisioning. This does not open HR or approval."),
  departmentMembership("hr", "staff", "HR member", "HR staff workspace. This does not open Finance."),
  departmentMembership("hr", "administrator", "HR administrator", "HR delete, company-wide modules, and account provisioning."),
  departmentMembership("content", "staff", "Content member", "Content module. At AMG, BZG, or GGV this also opens the employee HR screen, not HR staff."),
  departmentMembership("content", "administrator", "Content administrator", "Content delete and company-wide modules. The employee HR screen stays the employee screen."),
  departmentMembership("procurement", "staff", "Procurement member", "Procurement inside Finance. The finance application stays locked. At AMG, BZG, or GGV this opens the employee HR screen."),
  departmentMembership("procurement", "administrator", "Procurement administrator", "Procurement delete and company-wide modules. Finance stays on Procurement."),
  {
    id: "grant.owner_private",
    label: "Owner Private read",
    description: "Explicit Owner Private read for one company. A role title does not include this.",
    availability: "assignable",
    scopeLabel: "owner_private",
    warning: "This is the only way to read Owner Private. Approval is a separate grant.",
    grant: { type: "owner_private" },
    probe: { module: "owner_private", action: "read" },
  },
  {
    id: "grant.approve.company",
    label: "Company approval",
    description: "Approve company and department records in modules a membership already opens. It does not approve Owner Private and does nothing without a covering membership.",
    availability: "assignable",
    scopeLabel: "company",
    warning: "Approval is never implied by membership.",
    grant: { type: "approve", scope: "company", departmentKey: null },
    probe: { module: "finance", action: "approve" },
  },
  {
    id: "grant.approve.owner_private",
    label: "Owner Private approval",
    description: "Approve Owner Private records. This does not grant Owner Private read.",
    availability: "assignable",
    scopeLabel: "owner_private",
    warning: "Read and approval are separate Owner Private grants.",
    grant: { type: "approve", scope: "owner_private", departmentKey: null },
    probe: { module: "owner_private", action: "approve" },
  },
  departmentApproval("finance"),
  departmentApproval("hr"),
  departmentApproval("content"),
  departmentApproval("procurement"),
  {
    id: "settings.read",
    label: "Settings",
    description: "Every signed-in user can open Settings. Policy cannot remove it.",
    availability: "baseline",
    scopeLabel: "self",
    probe: { module: "settings", action: "read" },
  },
  unavailable(
    "organization.people.read",
    "Organization people",
    "People and tasks use the organization module membership. There is no separate people permission.",
  ),
  unavailable("tasks.manage", "Tasks", "There is no separate task permission. Organization membership is what the backend checks."),
  unavailable(
    "finance.reports.read",
    "Finance reports",
    "Reports are not a separate permission. Finance membership opens the finance application.",
  ),
  unavailable(
    "hr.payroll.read",
    "HR payroll",
    "Payroll and employee record APIs stay denied. This portal cannot grant them.",
  ),
  unavailable(
    "hr.employee",
    "HR employee screen",
    "The employee screen is a side effect of a non-HR, non-finance department membership. It is not its own switch.",
  ),
  unavailable(
    "access.roles.manage",
    "Manage access policies",
    "Policy administration is an administrator or owner membership. A separate switch would not be enforced.",
  ),
  unavailable(
    "developer.bypass",
    "Developer bypass",
    "No developer bypass exists. Developer access cannot skip business data or Owner Private.",
  ),
  unavailable(
    "scope.organization",
    "Organization-wide scope",
    "The evaluator has no organization-wide resource. Assign the role in each company.",
  ),
];

export const assignableCapabilities = accessCapabilities.filter(
  (capability): capability is AccessCapability & { availability: "assignable" } => capability.availability === "assignable",
);
export const unavailableCapabilities = accessCapabilities.filter((capability) => capability.availability === "unavailable");
export const assignableCapabilityIds = assignableCapabilities.map((capability) => capability.id);

const capabilityMap = new Map(accessCapabilities.map((capability) => [capability.id, capability]));

export function capabilityById(id: string): AccessCapability | null {
  return capabilityMap.get(id) ?? null;
}

export function canManageAccessPolicies(actor: Actor | null): boolean {
  return managedCompanyIds(actor).length > 0;
}

export function managedCompanyIds(actor: Actor | null): string[] {
  if (!actor) return [];
  return [...new Set(actor.memberships.filter((membership) => isManagerRole(membership.role)).map((membership) => membership.companyId))].sort();
}

export function canManageCompany(actor: Actor | null, companyId: string): boolean {
  return !!actor && hasPolicyAuthority(actor, companyId);
}

export function hasPolicyAuthority(actor: Actor, companyId: string): boolean {
  return actor.memberships.some((membership) => membership.companyId === companyId && isManagerRole(membership.role));
}

export function roleScope(ids: readonly string[]): { ok: true; scope: "company" | DepartmentKey } | { ok: false; reason: string } {
  if (ids.length === 0) return { ok: false, reason: "Choose at least one enforced capability." };
  let scope: "company" | DepartmentKey | null = null;
  let membershipRole: Role | null = null;
  for (const id of new Set(ids)) {
    const capability = capabilityById(id);
    const next = capability ? capabilityScope(capability) : null;
    if (!capability || capability.availability !== "assignable" || !next) {
      return { ok: false, reason: "That permission is not an enforced capability." };
    }
    if (scope && scope !== next) return { ok: false, reason: "A role can cover one company or one department, not both." };
    scope = next;
    if (capability.membership) {
      if (membershipRole && membershipRole !== capability.membership.role) {
        return { ok: false, reason: "A role can include only one membership role." };
      }
      membershipRole = capability.membership.role;
    }
  }
  return scope ? { ok: true, scope } : { ok: false, reason: "Choose at least one enforced capability." };
}

export type PolicyEffect = {
  assignmentId: string;
  userId: string;
  companyId: string;
  departmentId: string | null;
  capabilityId: string;
  effect: "allow" | "deny";
  expiresAt: Date | null;
  source: "assignment" | "exception";
};

export type DraftAssignment = {
  id: string;
  userId: string;
  companyId: string;
  departmentId: string | null;
  kind: "assignment" | "exception";
  effect: "allow" | "deny";
  roleId: string | null;
  capabilityId: string | null;
  expiresAt: Date | null;
  justification: string | null;
};

export function effectsFromDraft(
  rows: readonly DraftAssignment[],
  roles: ReadonlyMap<string, { status: string; capabilityIds: readonly string[] }>,
  now: Date,
): { effects: PolicyEffect[]; errors: string[] } {
  const effects: PolicyEffect[] = [];
  const errors: string[] = [];
  for (const row of rows) {
    if (row.kind === "assignment") {
      const role = row.roleId ? roles.get(row.roleId) : undefined;
      if (!role || role.status !== "active") {
        errors.push("An assignment uses a role that is inactive or missing.");
        continue;
      }
      const scope = roleScope(role.capabilityIds);
      if (!scope.ok) {
        errors.push(scope.reason);
        continue;
      }
      const departmentError = assignmentDepartment(scope.scope, row.departmentId);
      if (departmentError) {
        errors.push(departmentError);
        continue;
      }
      for (const capabilityId of role.capabilityIds) {
        effects.push({
          assignmentId: row.id,
          userId: row.userId,
          companyId: row.companyId,
          departmentId: row.departmentId,
          capabilityId,
          effect: "allow",
          expiresAt: null,
          source: "assignment",
        });
      }
      continue;
    }
    const capability = row.capabilityId ? capabilityById(row.capabilityId) : null;
    const scope = capability ? capabilityScope(capability) : null;
    if (!capability || capability.availability !== "assignable" || !scope || !row.capabilityId) {
      errors.push("An exception uses a permission the backend does not enforce.");
      continue;
    }
    if (!row.justification || row.justification.trim().length < 8 || row.justification.trim().length > 400) {
      errors.push("An exception needs a justification.");
      continue;
    }
    if (!row.expiresAt || row.expiresAt.getTime() <= now.getTime()) {
      errors.push("An exception needs an expiry in the future.");
      continue;
    }
    if (row.effect !== "allow" && row.effect !== "deny") {
      errors.push("An exception must allow or deny.");
      continue;
    }
    const departmentError = assignmentDepartment(scope, row.departmentId);
    if (departmentError) {
      errors.push(departmentError);
      continue;
    }
    effects.push({
      assignmentId: row.id,
      userId: row.userId,
      companyId: row.companyId,
      departmentId: row.departmentId,
      capabilityId: row.capabilityId,
      effect: row.effect,
      expiresAt: row.expiresAt,
      source: "exception",
    });
  }
  return { effects, errors };
}

export type PlannedMembership = Membership & { expiresAt: Date | null };
export type PlannedGrant = Grant & { expiresAt: Date | null };

export type CompanyPlan = {
  errors: string[];
  actor: Actor;
  insertMemberships: PlannedMembership[];
  insertGrants: PlannedGrant[];
};

export function planCompanyUser(input: {
  userId: string;
  companyId: string;
  keptMemberships: readonly Membership[];
  keptGrants: readonly Grant[];
  effects: readonly PolicyEffect[];
  now: Date;
}): CompanyPlan {
  const keptActor = { userId: input.userId, memberships: input.keptMemberships, grants: input.keptGrants };
  const errors: string[] = [];
  const allows = new Map<string, { capability: AccessCapability; departmentId: string | null; expiresAt: Date | null }>();
  const denies: PolicyEffect[] = [];
  for (const effect of input.effects) {
    if (effect.userId !== input.userId || effect.companyId !== input.companyId) continue;
    const capability = capabilityById(effect.capabilityId);
    const scope = capability ? capabilityScope(capability) : null;
    if (!capability || capability.availability !== "assignable" || !scope) {
      errors.push("A permission in this policy is not enforced.");
      continue;
    }
    if (effect.expiresAt && effect.expiresAt.getTime() <= input.now.getTime()) {
      errors.push("An exception is already expired.");
      continue;
    }
    if (assignmentDepartment(scope, effect.departmentId)) {
      errors.push("A permission is outside its company or department scope.");
      continue;
    }
    if (effect.effect === "deny") {
      denies.push(effect);
      continue;
    }
    const current = allows.get(effect.capabilityId);
    if (current && current.departmentId !== effect.departmentId) {
      errors.push("The same permission is assigned in two different scopes.");
      continue;
    }
    const expiresAt = !current
      ? effect.expiresAt
      : current.expiresAt === null || effect.expiresAt === null
        ? null
        : later(current.expiresAt, effect.expiresAt);
    allows.set(effect.capabilityId, { capability, departmentId: effect.departmentId, expiresAt });
  }
  for (const deny of denies) allows.delete(deny.capabilityId);
  if (errors.length > 0) return { errors, actor: keptActor, insertMemberships: [], insertGrants: [] };

  const insertMemberships: PlannedMembership[] = [];
  const insertGrants: PlannedGrant[] = [];
  const slots = new Map<string, Role>();
  for (const allow of allows.values()) {
    if (!allow.capability.membership) continue;
    const membership = membershipFrom(allow.capability, input.companyId, allow.departmentId);
    if (!membership) {
      errors.push("A membership permission is outside its department.");
      continue;
    }
    const slot = slotKey(membership.companyId, membership.departmentId);
    const existing = slots.get(slot);
    if (existing && existing !== membership.role) errors.push("A membership can have only one role.");
    slots.set(slot, membership.role);
  }
  for (const [slot, role] of slots) {
    const kept = input.keptMemberships.find((membership) => slotKey(membership.companyId, membership.departmentId) === slot);
    if (kept && kept.role !== role) {
      errors.push("An existing membership already covers this company scope. This policy will not replace it.");
    }
  }
  for (const deny of denies) {
    const capability = capabilityById(deny.capabilityId);
    if (capability && hasShape(keptActor, capability, input.companyId, deny.departmentId)) {
      errors.push("An explicit denial cannot remove a membership or grant this policy does not manage.");
    }
  }
  if (errors.length > 0) return { errors, actor: keptActor, insertMemberships: [], insertGrants: [] };

  for (const allow of allows.values()) {
    if (allow.capability.membership) {
      const membership = membershipFrom(allow.capability, input.companyId, allow.departmentId);
      if (!membership) continue;
      const kept = input.keptMemberships.find(
        (item) => slotKey(item.companyId, item.departmentId) === slotKey(membership.companyId, membership.departmentId) && item.role === membership.role,
      );
      if (!kept) insertMemberships.push({ ...membership, expiresAt: allow.expiresAt });
    }
    if (allow.capability.grant) {
      const grant = grantFrom(allow.capability, input.companyId, allow.departmentId);
      if (!grant) continue;
      const kept = input.keptGrants.find((item) => sameGrant(item, grant));
      if (!kept) insertGrants.push({ ...grant, expiresAt: allow.expiresAt });
    }
  }
  const actor: Actor = {
    userId: input.userId,
    memberships: [...input.keptMemberships, ...insertMemberships],
    grants: [...input.keptGrants, ...insertGrants],
  };
  for (const allow of allows.values()) {
    if (!isEffective(actor, allow.capability, input.companyId)) {
      errors.push(`${allow.capability.label} would not be enforced for this account.`);
    }
  }
  if (errors.length > 0) return { errors, actor: keptActor, insertMemberships: [], insertGrants: [] };
  return { errors: [], actor, insertMemberships, insertGrants };
}

export function missingAdministrator(companyId: string, actors: readonly Actor[]): boolean {
  return !actors.some((actor) => hasPolicyAuthority(actor, companyId));
}

export function isEffective(actor: Actor, capability: AccessCapability, companyId: string): boolean {
  if (capability.availability !== "assignable" || !hasAnyShape(actor, capability, companyId)) return false;
  if (capability.grant?.type === "approve" && capability.grant.scope !== "owner_private") {
    return moduleIds.some(
      (module) => moduleMatrix[module].approve === "grant" && evaluateModuleAccess(actor, module, "approve", { companyId }).outcome === "allow",
    );
  }
  if (!capability.probe) return false;
  return evaluateModuleAccess(actor, capability.probe.module, capability.probe.action, {
    companyId,
    departmentId: capability.probe.departmentId ?? null,
  }).outcome === "allow";
}

export function capabilityDelta(
  before: Actor,
  after: Actor,
  companyId: string,
): Array<{ capabilityId: string; change: "granted" | "revoked" }> {
  const changes: Array<{ capabilityId: string; change: "granted" | "revoked" }> = [];
  for (const capability of assignableCapabilities) {
    const was = isEffective(before, capability, companyId);
    const now = isEffective(after, capability, companyId);
    if (was === now) continue;
    changes.push({ capabilityId: capability.id, change: now ? "granted" : "revoked" });
  }
  return changes;
}

export type PreviewLine = {
  capabilityId: string;
  label: string;
  availability: AccessCapability["availability"];
  effective: boolean;
  enforced: boolean;
  scope: string;
  source: string;
  note: string;
};

export function previewLines(actor: Actor, companyId: string, effects: readonly PolicyEffect[], now: Date): PreviewLine[] {
  return accessCapabilities.map((capability) => {
    if (capability.availability === "unavailable") {
      return line(capability, false, false, "Unavailable", capability.unavailableReason ?? "This permission is not enforced.");
    }
    if (capability.availability === "baseline") {
      const allowed = evaluateModuleAccess(actor, "settings", "read", { companyId }).outcome === "allow";
      return line(capability, allowed, true, "Signed-in account", "Settings stays available to every signed-in user.");
    }
    const effective = isEffective(actor, capability, companyId);
    const effect = effects.find(
      (item) =>
        item.userId === actor.userId &&
        item.companyId === companyId &&
        item.capabilityId === capability.id &&
        (!item.expiresAt || item.expiresAt.getTime() > now.getTime()),
    );
    if (effective && effect?.source === "exception") {
      return line(capability, true, true, "Exception", `Expires ${effect.expiresAt?.toISOString() ?? ""}.`);
    }
    if (effective && effect?.effect === "allow") return line(capability, true, true, "Published policy", capability.warning ?? capability.description);
    if (effective) return line(capability, true, true, "Provisioned membership", capability.warning ?? capability.description);
    if (hasAnyShape(actor, capability, companyId)) {
      return line(capability, false, true, "Evaluator denied", "This assignment is stored, but the backend does not currently allow it.");
    }
    if (effect?.effect === "deny") return line(capability, false, true, "Explicit denial", "A published exception denies this permission.");
    return line(capability, false, true, "Not granted", capability.description);
  });
}

export type AccessChange = {
  label: string;
  before: string;
  after: string;
  change: "increase" | "reduce" | "unchanged";
  source: string;
};

export function compareAccess(before: Actor, after: Actor, companyId: string, effects: readonly PolicyEffect[]): AccessChange[] {
  const changes: AccessChange[] = [];
  for (const module of moduleIds) {
    if (module === "settings") continue;
    for (const action of ["read", "create", "update", "delete", "approve"] as const) {
      const left = evaluateModuleAccess(before, module, action, { companyId });
      const right = evaluateModuleAccess(after, module, action, { companyId });
      changes.push({
        label: `${module} ${action}`,
        before: left.outcome,
        after: right.outcome,
        change: accessDirection(left.outcome, right.outcome),
        source: decisionSource(before, after, companyId, effects, module, action, right.reason),
      });
    }
  }
  const hrBefore = hrAccess(before, companyId);
  const hrAfter = hrAccess(after, companyId);
  changes.push({
    label: "HR screen",
    before: hrBefore ?? "none",
    after: hrAfter ?? "none",
    change: rankDirection(hrRank(hrBefore), hrRank(hrAfter)),
    source: hrAfter ? "HR screen follows the same membership rules" : "HR screen is not open",
  });
  const financeBefore = financeWorkspace(before, companyId);
  const financeAfter = financeWorkspace(after, companyId);
  changes.push({
    label: "Finance workspace",
    before: financeBefore ?? "none",
    after: financeAfter ?? "none",
    change: rankDirection(financeRank(financeBefore), financeRank(financeAfter)),
    source: financeAfter === "procurement" ? "Procurement membership locks Finance to Procurement" : "Finance workspace follows finance and procurement membership",
  });
  return changes;
}

export function catalogProblems(companyId = "amg"): string[] {
  const problems: string[] = [];
  const ids = accessCapabilities.map((capability) => capability.id);
  if (new Set(ids).size !== ids.length) problems.push("Capability ids are not unique.");
  for (const check of catalogChecks) {
    const actor = actorFor(companyId, check.ids, check.departmentId);
    if (!actor) {
      problems.push(`${check.label} could not be built.`);
      continue;
    }
    for (const probe of check.allow) {
      const decision = evaluateModuleAccess(actor, probe.module, probe.action, { companyId, departmentId: probe.departmentId ?? null });
      if (decision.outcome !== "allow") problems.push(`${check.label} ${probe.module}.${probe.action} denied (${decision.reason}).`);
    }
    for (const probe of check.deny) {
      const decision = evaluateModuleAccess(actor, probe.module, probe.action, { companyId, departmentId: probe.departmentId ?? null });
      if (decision.outcome !== "deny") problems.push(`${check.label} ${probe.module}.${probe.action} allowed.`);
    }
    if (check.hr !== undefined && hrAccess(actor, companyId) !== check.hr) {
      problems.push(`${check.label} HR screen is ${hrAccess(actor, companyId) ?? "none"}.`);
    }
    if (check.finance !== undefined && financeWorkspace(actor, companyId) !== check.finance) {
      problems.push(`${check.label} finance workspace is ${financeWorkspace(actor, companyId) ?? "none"}.`);
    }
    if (check.provisioning !== undefined && authorizeProvisioning(actor, companyId) !== check.provisioning) {
      problems.push(`${check.label} provisioning does not match.`);
    }
  }
  return problems;
}

type CatalogCheck = {
  label: string;
  ids: string[];
  departmentId: string | null;
  allow: Probe[];
  deny: Probe[];
  hr?: HrAccess | null;
  finance?: FinanceWorkspace | null;
  provisioning?: boolean;
};

const catalogChecks: CatalogCheck[] = [
  check("company staff", ["membership.company.staff"], null, {
    allow: [probe("overview", "read"), probe("finance", "read"), probe("hr", "read"), probe("procurement", "read")],
    deny: [probe("finance", "delete"), probe("finance", "approve"), probe("owner_private", "read"), probe("academy", "create")],
    hr: "staff",
    finance: "application",
    provisioning: false,
  }),
  check("company administrator", ["membership.company.administrator"], null, {
    allow: [probe("finance", "delete"), probe("academy", "create"), probe("organization", "create")],
    deny: [probe("owner_private", "read"), probe("finance", "approve"), probe("organization", "delete")],
    hr: "administrator",
    finance: "application",
    provisioning: true,
  }),
  check("company owner", ["membership.company.owner"], null, {
    allow: [probe("organization", "create"), probe("finance", "delete")],
    deny: [probe("owner_private", "read"), probe("finance", "approve")],
    hr: "administrator",
    finance: "application",
    provisioning: false,
  }),
  check("finance staff", ["membership.department.finance.staff"], "finance", {
    allow: [probe("finance", "read", "finance"), probe("finance", "create")],
    deny: [probe("finance", "delete"), probe("hr", "read"), probe("overview", "read"), probe("procurement", "read")],
    hr: null,
    finance: "application",
    provisioning: false,
  }),
  check("finance administrator", ["membership.department.finance.administrator"], "finance", {
    allow: [probe("finance", "delete"), probe("overview", "read"), probe("academy", "create")],
    deny: [probe("hr", "read"), probe("finance", "approve"), probe("owner_private", "read")],
    hr: null,
    finance: "application",
    provisioning: true,
  }),
  check("hr staff", ["membership.department.hr.staff"], "hr", {
    allow: [probe("hr", "read", "hr")],
    deny: [probe("hr", "delete"), probe("finance", "read"), probe("overview", "read")],
    hr: "staff",
    finance: null,
    provisioning: false,
  }),
  check("hr administrator", ["membership.department.hr.administrator"], "hr", {
    allow: [probe("hr", "delete"), probe("overview", "read")],
    deny: [probe("finance", "read"), probe("hr", "approve")],
    hr: "administrator",
    finance: null,
    provisioning: true,
  }),
  check("content staff", ["membership.department.content.staff"], "content", {
    allow: [probe("content", "read")],
    deny: [probe("finance", "read"), probe("hr", "read"), probe("overview", "read")],
    hr: "employee",
    finance: null,
    provisioning: false,
  }),
  check("content administrator", ["membership.department.content.administrator"], "content", {
    allow: [probe("content", "delete"), probe("overview", "read")],
    deny: [probe("hr", "read"), probe("finance", "read"), probe("content", "approve")],
    hr: "employee",
    finance: null,
    provisioning: true,
  }),
  check("procurement staff", ["membership.department.procurement.staff"], "procurement", {
    allow: [probe("procurement", "read", "procurement")],
    deny: [probe("finance", "read"), probe("procurement", "delete"), probe("overview", "read")],
    hr: "employee",
    finance: "procurement",
    provisioning: false,
  }),
  check("procurement administrator", ["membership.department.procurement.administrator"], "procurement", {
    allow: [probe("procurement", "delete"), probe("overview", "read")],
    deny: [probe("finance", "read"), probe("procurement", "approve")],
    hr: "employee",
    finance: "procurement",
    provisioning: true,
  }),
  check("owner private", ["grant.owner_private"], null, {
    allow: [probe("owner_private", "read")],
    deny: [probe("owner_private", "approve"), probe("finance", "read")],
    hr: null,
    finance: null,
    provisioning: false,
  }),
  check("company approval", ["membership.company.staff", "grant.approve.company"], null, {
    allow: [probe("finance", "approve"), probe("hr", "approve")],
    deny: [probe("owner_private", "approve"), probe("owner_private", "read"), probe("finance", "delete")],
    hr: "staff",
    finance: "application",
    provisioning: false,
  }),
  check("owner private approval", ["grant.approve.owner_private"], null, {
    allow: [probe("owner_private", "approve")],
    deny: [probe("owner_private", "read"), probe("finance", "approve")],
    hr: null,
    finance: null,
    provisioning: false,
  }),
  check("finance approval", ["membership.department.finance.staff", "grant.approve.department.finance"], "finance", {
    allow: [probe("finance", "approve", "finance")],
    deny: [probe("hr", "approve"), probe("owner_private", "approve"), probe("overview", "read")],
    hr: null,
    finance: "application",
    provisioning: false,
  }),
  check("hr approval", ["membership.department.hr.staff", "grant.approve.department.hr"], "hr", {
    allow: [probe("hr", "approve", "hr")],
    deny: [probe("finance", "approve"), probe("owner_private", "approve")],
    hr: "staff",
    finance: null,
    provisioning: false,
  }),
  check("content approval", ["membership.department.content.staff", "grant.approve.department.content"], "content", {
    allow: [probe("content", "approve")],
    deny: [probe("finance", "approve"), probe("hr", "read")],
    hr: "employee",
    finance: null,
    provisioning: false,
  }),
  check("procurement approval", ["membership.department.procurement.staff", "grant.approve.department.procurement"], "procurement", {
    allow: [probe("procurement", "approve")],
    deny: [probe("finance", "read"), probe("finance", "approve")],
    hr: "employee",
    finance: "procurement",
    provisioning: false,
  }),
  check("approval alone", ["grant.approve.company"], null, {
    allow: [],
    deny: [probe("finance", "approve"), probe("hr", "approve"), probe("owner_private", "approve")],
    hr: null,
    finance: null,
    provisioning: false,
  }),
];

function departmentMembership(key: DepartmentKey, role: "staff" | "administrator", label: string, description: string): AccessCapability {
  const action: Action = role === "administrator" ? "delete" : "read";
  return {
    id: `membership.department.${key}.${role}`,
    label,
    description,
    availability: "assignable",
    scopeLabel: "department",
    warning: role === "administrator" ? administratorWarning : undefined,
    membership: { role, departmentKey: key },
    probe: { module: key, action },
  };
}

function departmentApproval(key: DepartmentKey): AccessCapability {
  return {
    id: `grant.approve.department.${key}`,
    label: `${labelFor(key)} approval`,
    description: `Approve ${labelFor(key)} records when a ${labelFor(key)} membership already covers them.`,
    availability: "assignable",
    scopeLabel: "department",
    warning: "Approval is never implied by membership.",
    grant: { type: "approve", scope: "department", departmentKey: key },
    probe: { module: key, action: "approve" },
  };
}

function unavailable(id: string, label: string, reason: string): AccessCapability {
  return {
    id,
    label,
    description: reason,
    availability: "unavailable",
    scopeLabel: "unsupported",
    unavailableReason: reason,
  };
}

function labelFor(key: DepartmentKey): string {
  if (key === "hr") return "HR";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function check(
  label: string,
  ids: string[],
  departmentId: string | null,
  extra: Omit<CatalogCheck, "label" | "ids" | "departmentId">,
): CatalogCheck {
  return { label, ids, departmentId, ...extra };
}

function probe(module: ModuleId, action: Action, departmentId?: string): Probe {
  return { module, action, departmentId: departmentId ?? null };
}

function actorFor(companyId: string, ids: string[], departmentId: string | null): Actor | null {
  const memberships: Membership[] = [];
  const grants: Grant[] = [];
  for (const id of ids) {
    const capability = capabilityById(id);
    if (!capability) return null;
    const department = capabilityScope(capability) === "company" ? null : departmentId;
    if (capability.membership) {
      const membership = membershipFrom(capability, companyId, department);
      if (!membership) return null;
      if (!memberships.some((item) => slotKey(item.companyId, item.departmentId) === slotKey(membership.companyId, membership.departmentId))) {
        memberships.push(membership);
      }
    }
    if (capability.grant) {
      const grant = grantFrom(capability, companyId, department);
      if (!grant) return null;
      grants.push(grant);
    }
  }
  return { userId: "catalog-user", memberships, grants };
}

function capabilityScope(capability: AccessCapability): "company" | DepartmentKey | null {
  if (capability.availability !== "assignable") return null;
  if (capability.membership) return capability.membership.departmentKey ?? "company";
  if (capability.grant?.type === "approve" && capability.grant.scope === "department") return capability.grant.departmentKey;
  if (capability.grant) return "company";
  return null;
}

function assignmentDepartment(scope: "company" | DepartmentKey, departmentId: string | null): string | null {
  if (scope === "company") return departmentId ? "Company permissions cannot be limited to one department." : null;
  if (!departmentId || !departmentServesModule(departmentId, scope)) return "Choose a department that matches this permission.";
  return null;
}

function membershipFrom(capability: AccessCapability, companyId: string, departmentId: string | null): Membership | null {
  if (!capability.membership) return null;
  if (capability.membership.departmentKey === null) {
    return departmentId ? null : { companyId, departmentId: null, role: capability.membership.role };
  }
  if (!departmentId || !departmentServesModule(departmentId, capability.membership.departmentKey)) return null;
  return { companyId, departmentId, role: capability.membership.role };
}

function grantFrom(capability: AccessCapability, companyId: string, departmentId: string | null): Grant | null {
  if (!capability.grant) return null;
  if (capability.grant.type === "owner_private") {
    return departmentId ? null : { type: "owner_private", companyId };
  }
  if (capability.grant.scope === "department") {
    if (!departmentId || !capability.grant.departmentKey || !departmentServesModule(departmentId, capability.grant.departmentKey)) return null;
    return { type: "approve", companyId, scope: "department", departmentId };
  }
  if (departmentId) return null;
  return { type: "approve", companyId, scope: capability.grant.scope, departmentId: null };
}

function hasAnyShape(actor: Actor, capability: AccessCapability, companyId: string): boolean {
  if (capability.membership?.departmentKey) {
    return actor.memberships.some(
      (membership) =>
        membership.companyId === companyId &&
        membership.role === capability.membership?.role &&
        !!membership.departmentId &&
        departmentServesModule(membership.departmentId, capability.membership.departmentKey!),
    );
  }
  if (capability.grant?.type === "approve" && capability.grant.departmentKey) {
    return actor.grants.some(
      (grant) =>
        grant.type === "approve" &&
        grant.companyId === companyId &&
        grant.scope === "department" &&
        !!grant.departmentId &&
        departmentServesModule(grant.departmentId, capability.grant?.type === "approve" ? capability.grant.departmentKey! : "finance"),
    );
  }
  return hasShape(actor, capability, companyId, null);
}

function hasShape(actor: Actor, capability: AccessCapability, companyId: string, departmentId: string | null): boolean {
  if (capability.membership) {
    const membership = membershipFrom(capability, companyId, capability.membership.departmentKey ? departmentId : null);
    if (!membership) return false;
    return actor.memberships.some(
      (item) => item.companyId === membership.companyId && item.departmentId === membership.departmentId && item.role === membership.role,
    );
  }
  const grant = grantFrom(capability, companyId, capability.grant?.type === "approve" ? departmentId : null);
  return !!grant && actor.grants.some((item) => sameGrant(item, grant));
}

function sameGrant(left: Grant, right: Grant): boolean {
  if (left.type !== right.type || left.companyId !== right.companyId) return false;
  if (left.type === "owner_private" || right.type === "owner_private") return left.type === "owner_private" && right.type === "owner_private";
  return left.scope === right.scope && left.departmentId === right.departmentId;
}

function slotKey(companyId: string, departmentId: string | null): string {
  return `${companyId}\u0000${departmentId ?? ""}`;
}

function later(left: Date, right: Date): Date {
  return left.getTime() >= right.getTime() ? left : right;
}

function isManagerRole(role: Role): boolean {
  return role === "administrator" || role === "owner";
}

function line(capability: AccessCapability, effective: boolean, enforced: boolean, source: string, note: string): PreviewLine {
  return {
    capabilityId: capability.id,
    label: capability.label,
    availability: capability.availability,
    effective,
    enforced,
    scope: capability.scopeLabel,
    source,
    note,
  };
}

function decisionSource(
  before: Actor,
  after: Actor,
  companyId: string,
  effects: readonly PolicyEffect[],
  module: ModuleId,
  action: Action,
  reason: string,
): string {
  const afterDecision = evaluateModuleAccess(after, module, action, { companyId });
  if (afterDecision.outcome === "allow") {
    const matched = effects.filter((effect) => effect.effect === "allow" && effectExplains(effect, module, action));
    if (matched.length > 0) {
      return matched.map((effect) => `${effect.source === "exception" ? "exception" : "policy"} ${effect.capabilityId}`).join(", ");
    }
    if (evaluateModuleAccess(before, module, action, { companyId }).outcome === "allow") return "provisioned membership";
    return "membership";
  }
  const denial = effects.find((effect) => effect.effect === "deny" && effectExplains(effect, module, action));
  if (denial) return `explicit denial ${denial.capabilityId}`;
  return reason;
}

function effectExplains(effect: PolicyEffect, module: ModuleId, action: Action): boolean {
  const capability = capabilityById(effect.capabilityId);
  if (!capability) return false;
  if (capability.probe?.module === module && capability.probe.action === action) return true;
  return action === "approve" && capability.grant?.type === "approve" && (capability.probe?.module === module || capability.grant.scope === "company");
}

function accessDirection(before: "allow" | "deny", after: "allow" | "deny"): AccessChange["change"] {
  if (before === after) return "unchanged";
  return after === "allow" ? "increase" : "reduce";
}

function rankDirection(before: number, after: number): AccessChange["change"] {
  if (before === after) return "unchanged";
  return after > before ? "increase" : "reduce";
}

function hrRank(access: HrAccess | null): number {
  if (access === "administrator") return 3;
  if (access === "staff") return 2;
  if (access === "employee") return 1;
  return 0;
}

function financeRank(workspace: FinanceWorkspace | null): number {
  if (workspace === "application") return 2;
  if (workspace === "procurement") return 1;
  return 0;
}
