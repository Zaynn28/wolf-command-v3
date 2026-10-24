export const actions = ["read", "create", "update", "delete", "approve"] as const;

export type Action = (typeof actions)[number];

export type Role = "staff" | "administrator" | "owner";

/**
 * A membership grants company or department access for read, create, update,
 * and delete. `departmentId: null` covers every department in that company.
 * No membership grants Owner Private access or approval.
 */
export type Membership = {
  companyId: string;
  departmentId: string | null;
  role: Role;
};

export type OwnerPrivateGrant = {
  type: "owner_private";
  companyId: string;
};

/**
 * Approval is a separate grant. A company grant covers company and department
 * records in that company. It does not cover Owner Private records.
 */
export type ApproveGrant = {
  type: "approve";
  companyId: string;
  scope: "company" | "department" | "owner_private";
  departmentId: string | null;
};

export type Grant = OwnerPrivateGrant | ApproveGrant;

export type Actor = {
  userId: string;
  memberships: readonly Membership[];
  grants: readonly Grant[];
};

export type CompanyScope = {
  kind: "company";
  companyId: string;
};

export type DepartmentScope = {
  kind: "department";
  companyId: string;
  departmentId: string;
};

export type OwnerPrivateScope = {
  kind: "owner_private";
  companyId: string;
};

export type ResourceScope = CompanyScope | DepartmentScope | OwnerPrivateScope;

export const reasonCode = {
  missingActor: "missing_actor",
  unknownAction: "unknown_action",
  malformedScope: "malformed_scope",
  wrongCompany: "wrong_company",
  outsideDepartment: "outside_department",
  ownerPrivateGrantRequired: "owner_private_grant_required",
  approvalGrantRequired: "approval_grant_required",
  membership: "membership",
  explicitGrant: "explicit_grant",
} as const;

export type ReasonCode = (typeof reasonCode)[keyof typeof reasonCode];

export type DecisionReason = {
  code: ReasonCode;
  detail: string;
};

export type Decision = {
  outcome: "allow" | "deny";
  reason: DecisionReason;
  actorId: string | null;
  action: string;
  resource: ResourceScope | null;
};

export type AuthorizationRequest = {
  actor: Actor | null | undefined;
  action: string;
  resource: unknown;
};

const actionSet: ReadonlySet<string> = new Set(actions);
const roles: ReadonlySet<string> = new Set(["staff", "administrator", "owner"]);

export function authorize(request: AuthorizationRequest): Decision {
  const actor = parseActor(request.actor);

  if (!actor) {
    return deny({
      code: reasonCode.missingActor,
      detail: "Authorization requires an actor with a user id, memberships, and grants.",
      actorId: null,
      action: request.action,
      resource: null,
    });
  }

  if (!actionSet.has(request.action)) {
    return deny({
      code: reasonCode.unknownAction,
      detail: "The action is not one of read, create, update, delete, or approve.",
      actorId: actor.userId,
      action: request.action,
      resource: parseResource(request.resource),
    });
  }

  const action = request.action as Action;
  const resource = parseResource(request.resource);

  if (!resource) {
    return deny({
      code: reasonCode.malformedScope,
      detail: "The resource scope is missing a supported kind or a required id.",
      actorId: actor.userId,
      action,
      resource: null,
    });
  }

  if (action === "approve") {
    return decideApproval(actor, action, resource);
  }

  if (resource.kind === "owner_private") {
    return hasOwnerPrivateGrant(actor, resource.companyId)
      ? allow({
          code: reasonCode.explicitGrant,
          detail: "An explicit Owner Private grant covers this company.",
          actor,
          action,
          resource,
        })
      : deny({
          code: reasonCode.ownerPrivateGrantRequired,
          detail:
            "Owner Private access requires an explicit grant. A role label does not grant it.",
          actorId: actor.userId,
          action,
          resource,
        });
  }

  return decideMembership(actor, action, resource);
}

function decideApproval(actor: Actor, action: Action, resource: ResourceScope): Decision {
  if (approveGrantCovers(actor, resource)) {
    return allow({
      code: reasonCode.explicitGrant,
      detail: "An explicit approval grant covers this scope.",
      actor,
      action,
      resource,
    });
  }

  if (!sharesCompany(actor, resource.companyId)) {
    return deny({
      code: reasonCode.wrongCompany,
      detail: "No membership or grant covers this company.",
      actorId: actor.userId,
      action,
      resource,
    });
  }

  return deny({
    code: reasonCode.approvalGrantRequired,
    detail: "Viewing or editing a record does not grant approval.",
    actorId: actor.userId,
    action,
    resource,
  });
}

function decideMembership(
  actor: Actor,
  action: Action,
  resource: CompanyScope | DepartmentScope,
): Decision {
  const memberships = membershipsInCompany(actor, resource.companyId);

  if (memberships.length === 0) {
    return deny({
      code: reasonCode.wrongCompany,
      detail: "No membership covers this company.",
      actorId: actor.userId,
      action,
      resource,
    });
  }

  if (resource.kind === "company") {
    return allow({
      code: reasonCode.membership,
      detail: "A membership covers this company.",
      actor,
      action,
      resource,
    });
  }

  const covered = memberships.some((membership) => coversDepartment(membership, resource.departmentId));

  if (!covered) {
    return deny({
      code: reasonCode.outsideDepartment,
      detail: "No membership covers this department.",
      actorId: actor.userId,
      action,
      resource,
    });
  }

  return allow({
    code: reasonCode.membership,
    detail: "A membership covers this department.",
    actor,
    action,
    resource,
  });
}

function parseActor(actor: Actor | null | undefined): Actor | null {
  if (!actor || typeof actor !== "object") {
    return null;
  }

  if (!isNonEmptyString(actor.userId)) {
    return null;
  }

  if (!Array.isArray(actor.memberships) || !Array.isArray(actor.grants)) {
    return null;
  }

  return actor;
}

function parseResource(resource: unknown): ResourceScope | null {
  if (!resource || typeof resource !== "object") {
    return null;
  }

  const record = resource as Record<string, unknown>;

  if (!isNonEmptyString(record.companyId)) {
    return null;
  }

  if (record.kind === "company") {
    return { kind: "company", companyId: record.companyId };
  }

  if (record.kind === "department" && isNonEmptyString(record.departmentId)) {
    return {
      kind: "department",
      companyId: record.companyId,
      departmentId: record.departmentId,
    };
  }

  if (record.kind === "owner_private") {
    return { kind: "owner_private", companyId: record.companyId };
  }

  return null;
}

function membershipsInCompany(actor: Actor, companyId: string): Membership[] {
  return actor.memberships.filter(
    (membership) => isMembership(membership) && membership.companyId === companyId,
  );
}

function coversDepartment(membership: Membership, departmentId: string): boolean {
  return membership.departmentId === null || membership.departmentId === departmentId;
}

function hasOwnerPrivateGrant(actor: Actor, companyId: string): boolean {
  return actor.grants.some(
    (grant) => isOwnerPrivateGrant(grant) && grant.companyId === companyId,
  );
}

function approveGrantCovers(actor: Actor, resource: ResourceScope): boolean {
  return actor.grants.some((grant) => isApproveGrant(grant) && grantCovers(grant, resource));
}

function grantCovers(grant: ApproveGrant, resource: ResourceScope): boolean {
  if (grant.companyId !== resource.companyId) {
    return false;
  }

  if (resource.kind === "owner_private") {
    return grant.scope === "owner_private";
  }

  if (grant.scope === "company") {
    return true;
  }

  if (grant.scope === "department" && resource.kind === "department") {
    return grant.departmentId === resource.departmentId;
  }

  return false;
}

function sharesCompany(actor: Actor, companyId: string): boolean {
  return (
    membershipsInCompany(actor, companyId).length > 0 ||
    actor.grants.some((grant) => isGrant(grant) && grant.companyId === companyId)
  );
}

function isMembership(value: Membership): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    isNonEmptyString(value.companyId) &&
    (value.departmentId === null || isNonEmptyString(value.departmentId)) &&
    roles.has(value.role)
  );
}

function isOwnerPrivateGrant(value: Grant): value is OwnerPrivateGrant {
  return (
    !!value &&
    typeof value === "object" &&
    value.type === "owner_private" &&
    isNonEmptyString(value.companyId)
  );
}

function isApproveGrant(value: Grant): value is ApproveGrant {
  if (!value || typeof value !== "object" || value.type !== "approve") {
    return false;
  }

  if (!isNonEmptyString(value.companyId)) {
    return false;
  }

  if (value.scope === "company" || value.scope === "owner_private") {
    return value.departmentId === null;
  }

  return value.scope === "department" && isNonEmptyString(value.departmentId);
}

function isGrant(value: Grant): value is Grant {
  return isOwnerPrivateGrant(value) || isApproveGrant(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function allow(input: {
  code: typeof reasonCode.membership | typeof reasonCode.explicitGrant;
  detail: string;
  actor: Actor;
  action: Action;
  resource: ResourceScope;
}): Decision {
  return {
    outcome: "allow",
    reason: { code: input.code, detail: input.detail },
    actorId: input.actor.userId,
    action: input.action,
    resource: input.resource,
  };
}

function deny(input: {
  code: Exclude<ReasonCode, typeof reasonCode.membership | typeof reasonCode.explicitGrant>;
  detail: string;
  actorId: string | null;
  action: string;
  resource: ResourceScope | null;
}): Decision {
  return {
    outcome: "deny",
    reason: { code: input.code, detail: input.detail },
    actorId: input.actorId,
    action: input.action,
    resource: input.resource,
  };
}
