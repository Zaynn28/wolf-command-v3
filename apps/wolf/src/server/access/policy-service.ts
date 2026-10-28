import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { Actor, Grant, Membership } from "@wolf/shared";
import { writeAudit } from "../auth/audit";
import { normalizeEmail } from "../auth/crypto";
import { revokeUserSessions } from "../auth/session";
import {
  accessPolicyAssignments,
  accessPolicyChanges,
  accessPolicySnapshots,
  accessPolicyVersions,
  accessPositionHolders,
  accessPositions,
  accessRoleCapabilities,
  accessRoles,
  companies,
  departments,
  grants,
  memberships,
  users,
} from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { departmentServesModule } from "./matrix";
import { ensureCompanyOperatingSystem, readCompanyOperatingSystem } from "./operating-system";
import { toActor, type GrantRecord, type MembershipRecord } from "./actor";
import {
  assignableCapabilities,
  canManageAccessPolicies,
  canManageCompany,
  capabilityById,
  capabilityDelta,
  compareAccess,
  effectsFromDraft,
  managedCompanyIds,
  missingAdministrator,
  planCompanyUser,
  previewLines,
  roleScope,
  unavailableCapabilities,
  type AccessChange,
  type CompanyPlan,
  type DepartmentKey,
  type DraftAssignment,
  type PolicyEffect,
  type PreviewLine,
} from "./policy-model";

export type PolicyDenied = { status: "denied" };
export type PolicyInvalid = { status: "invalid"; reason: string };
export type PolicyOk<T extends Record<string, unknown>> = { status: "ok" } & T;

type PolicyFailure = PolicyDenied | PolicyInvalid;

class PolicyRejection extends Error {}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function createAccessRole(
  db: AuthDatabase,
  actor: Actor,
  input: { name: string; description: string; capabilityIds: string[] },
  now: Date,
): Promise<PolicyOk<{ roleId: string }> | PolicyFailure> {
  if (!canManageAccessPolicies(actor)) return auditDenied(db, actor, null, "role_create", now);
  const name = cleanName(input.name);
  const description = cleanDescription(input.description);
  if (!name || description === null) return { status: "invalid", reason: "Enter a role name." };
  const scope = roleScope(input.capabilityIds);
  if (!scope.ok) return { status: "invalid", reason: scope.reason };
  try {
    return await db.transaction(async (tx) => {
      const database = tx as unknown as AuthDatabase;
      const role = (await database.insert(accessRoles).values({
        name,
        description,
        status: "active",
        createdBy: actor.userId,
        createdAt: now,
        updatedAt: now,
      }).returning())[0];
      if (!role) throw new PolicyRejection("The role could not be saved.");
      await database.insert(accessRoleCapabilities).values(unique(input.capabilityIds).map((capabilityId) => ({ roleId: role.id, capabilityId })));
      await auditAllowed(database, actor, null, role.id, "role_create", now);
      return { status: "ok" as const, roleId: role.id };
    });
  } catch (error) {
    return rejected(error, "The role could not be saved.");
  }
}

export async function updateAccessRole(
  db: AuthDatabase,
  actor: Actor,
  input: { roleId: string; name: string; description: string; capabilityIds: string[] },
  now: Date,
): Promise<PolicyOk<{ roleId: string }> | PolicyFailure> {
  if (!canManageAccessPolicies(actor)) return auditDenied(db, actor, null, "role_update", now);
  if (!isUuid(input.roleId)) return { status: "invalid", reason: "Choose a role." };
  const name = cleanName(input.name);
  const description = cleanDescription(input.description);
  if (!name || description === null) return { status: "invalid", reason: "Enter a role name." };
  const scope = roleScope(input.capabilityIds);
  if (!scope.ok) return { status: "invalid", reason: scope.reason };
  const existing = await db.select().from(accessRoles).where(eq(accessRoles.id, input.roleId)).limit(1);
  if (!existing[0] || existing[0].status !== "active") return { status: "invalid", reason: "Choose an active role." };
  try {
    await db.transaction(async (tx) => {
      const database = tx as unknown as AuthDatabase;
      await database.update(accessRoles).set({ name, description, updatedAt: now }).where(eq(accessRoles.id, input.roleId));
      await database.delete(accessRoleCapabilities).where(eq(accessRoleCapabilities.roleId, input.roleId));
      await database.insert(accessRoleCapabilities).values(unique(input.capabilityIds).map((capabilityId) => ({ roleId: input.roleId, capabilityId })));
      await auditAllowed(database, actor, null, input.roleId, "role_update", now);
    });
  } catch (error) {
    return rejected(error, "The role could not be saved.");
  }
  return { status: "ok", roleId: input.roleId };
}

export async function duplicateAccessRole(
  db: AuthDatabase,
  actor: Actor,
  roleId: string,
  now: Date,
): Promise<PolicyOk<{ roleId: string }> | PolicyFailure> {
  if (!canManageAccessPolicies(actor)) return auditDenied(db, actor, null, "role_duplicate", now);
  if (!isUuid(roleId)) return { status: "invalid", reason: "Choose a role." };
  const existing = await db.select().from(accessRoles).where(eq(accessRoles.id, roleId)).limit(1);
  if (!existing[0]) return { status: "invalid", reason: "Choose a role." };
  const capabilities = await db.select().from(accessRoleCapabilities).where(eq(accessRoleCapabilities.roleId, roleId));
  const name = await availableCopyName(db, existing[0].name);
  return createAccessRole(db, actor, { name, description: existing[0].description, capabilityIds: capabilities.map((row) => row.capabilityId) }, now);
}

export async function deactivateAccessRole(
  db: AuthDatabase,
  actor: Actor,
  roleId: string,
  now: Date,
): Promise<PolicyOk<{ roleId: string }> | PolicyFailure> {
  if (!canManageAccessPolicies(actor)) return auditDenied(db, actor, null, "role_deactivate", now);
  if (!isUuid(roleId)) return { status: "invalid", reason: "Choose a role." };
  const updated = await db.update(accessRoles).set({ status: "inactive", updatedAt: now }).where(and(eq(accessRoles.id, roleId), eq(accessRoles.status, "active"))).returning();
  if (!updated[0]) return { status: "invalid", reason: "Choose an active role." };
  await auditAllowed(db, actor, null, roleId, "role_deactivate", now);
  return { status: "ok", roleId };
}

export async function createAccessPosition(
  db: AuthDatabase,
  actor: Actor,
  input: { companyId: string; departmentId: string; name: string; description: string; reportsToId: string; suggestedRoleId: string },
  now: Date,
): Promise<PolicyOk<{ positionId: string }> | PolicyFailure> {
  const gate = await positionFields(db, actor, input);
  if (gate.status !== "ok") return gate;
  try {
    const position = (await db.insert(accessPositions).values({
      companyId: input.companyId,
      departmentId: gate.departmentId,
      name: gate.name,
      description: gate.description,
      reportsToId: gate.reportsToId,
      suggestedRoleId: gate.suggestedRoleId,
      status: "active",
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    }).returning())[0];
    if (!position) return { status: "invalid", reason: "The position could not be saved." };
    await auditAllowed(db, actor, input.companyId, position.id, "position_create", now);
    return { status: "ok", positionId: position.id };
  } catch {
    return { status: "invalid", reason: "The position could not be saved." };
  }
}

export async function updateAccessPosition(
  db: AuthDatabase,
  actor: Actor,
  input: { positionId: string; companyId: string; departmentId: string; name: string; description: string; reportsToId: string; suggestedRoleId: string },
  now: Date,
): Promise<PolicyOk<{ positionId: string }> | PolicyFailure> {
  if (!isUuid(input.positionId)) return { status: "invalid", reason: "Choose a position." };
  const current = await db.select().from(accessPositions).where(eq(accessPositions.id, input.positionId)).limit(1);
  if (!current[0] || current[0].companyId !== input.companyId) return { status: "invalid", reason: "Choose a position." };
  const gate = await positionFields(db, actor, input);
  if (gate.status !== "ok") return gate;
  if (gate.reportsToId && (await reportCycle(db, input.positionId, gate.reportsToId))) {
    return { status: "invalid", reason: "A position cannot report to itself." };
  }
  await db.update(accessPositions).set({
    departmentId: gate.departmentId,
    name: gate.name,
    description: gate.description,
    reportsToId: gate.reportsToId,
    suggestedRoleId: gate.suggestedRoleId,
    updatedAt: now,
  }).where(eq(accessPositions.id, input.positionId));
  await auditAllowed(db, actor, input.companyId, input.positionId, "position_update", now);
  return { status: "ok", positionId: input.positionId };
}

export async function deactivateAccessPosition(
  db: AuthDatabase,
  actor: Actor,
  positionId: string,
  now: Date,
): Promise<PolicyOk<{ positionId: string }> | PolicyFailure> {
  if (!isUuid(positionId)) return { status: "invalid", reason: "Choose a position." };
  const current = await db.select().from(accessPositions).where(eq(accessPositions.id, positionId)).limit(1);
  if (!current[0] || !canManageCompany(actor, current[0].companyId)) return auditDenied(db, actor, current[0]?.companyId ?? null, "position_deactivate", now);
  await db.update(accessPositions).set({ status: "inactive", updatedAt: now }).where(eq(accessPositions.id, positionId));
  await auditAllowed(db, actor, current[0].companyId, positionId, "position_deactivate", now);
  return { status: "ok", positionId };
}

export async function assignAccessPosition(
  db: AuthDatabase,
  actor: Actor,
  input: { positionId: string; email: string },
  now: Date,
): Promise<PolicyOk<{ positionId: string }> | PolicyFailure> {
  if (!isUuid(input.positionId)) return { status: "invalid", reason: "Choose a position." };
  const position = await db.select().from(accessPositions).where(eq(accessPositions.id, input.positionId)).limit(1);
  if (!position[0] || position[0].status !== "active" || !canManageCompany(actor, position[0].companyId)) {
    return auditDenied(db, actor, position[0]?.companyId ?? null, "position_assign", now);
  }
  const user = await activeUser(db, input.email);
  if (!user) return { status: "invalid", reason: "Choose an active Wolf account." };
  const existing = await db.select().from(accessPositionHolders).where(and(eq(accessPositionHolders.positionId, input.positionId), eq(accessPositionHolders.userId, user.id))).limit(1);
  if (existing[0]) {
    await db.update(accessPositionHolders).set({ status: "active" }).where(eq(accessPositionHolders.id, existing[0].id));
  } else {
    await db.insert(accessPositionHolders).values({
      positionId: input.positionId,
      userId: user.id,
      status: "active",
      createdBy: actor.userId,
      createdAt: now,
    });
  }
  await auditAllowed(db, actor, position[0].companyId, input.positionId, "position_assign", now);
  return { status: "ok", positionId: input.positionId };
}

export async function openAccessDraft(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
  reason: string,
  now: Date,
): Promise<PolicyOk<{ versionId: string }> | PolicyFailure> {
  if (!canManageCompany(actor, companyId)) return auditDenied(db, actor, companyId, "draft_open", now);
  const text = cleanReason(reason);
  if (!text) return { status: "invalid", reason: "Enter a reason for the draft." };
  const existing = await draftFor(db, companyId);
  if (existing) return { status: "ok", versionId: existing.id };
  const published = await publishedFor(db, companyId);
  const versionNumber = (await nextVersionNumber(db, companyId));
  try {
    return await db.transaction(async (tx) => {
      const database = tx as unknown as AuthDatabase;
      const version = (await database.insert(accessPolicyVersions).values({
        companyId,
        versionNumber,
        status: "draft",
        reason: text,
        createdBy: actor.userId,
        createdAt: now,
        basedOnVersionId: published?.id ?? null,
      }).returning())[0];
      if (!version) throw new PolicyRejection("The draft could not be opened.");
      if (published) {
        const rows = await database.select().from(accessPolicyAssignments).where(eq(accessPolicyAssignments.versionId, published.id));
        if (rows.length > 0) {
          await database.insert(accessPolicyAssignments).values(rows.map((row) => ({
            versionId: version.id,
            userId: row.userId,
            companyId: row.companyId,
            departmentId: row.departmentId,
            roleId: row.roleId,
            kind: row.kind,
            effect: row.effect,
            capabilityId: row.capabilityId,
            justification: row.justification,
            expiresAt: row.expiresAt,
          })));
        }
      }
      await auditAllowed(database, actor, companyId, version.id, "draft_open", now);
      return { status: "ok" as const, versionId: version.id };
    });
  } catch (error) {
    return rejected(error, "The draft could not be opened.");
  }
}

export async function saveAccessAssignment(
  db: AuthDatabase,
  actor: Actor,
  input: { companyId: string; email: string; roleId: string; departmentId: string },
  now: Date,
): Promise<PolicyOk<{ versionId: string }> | PolicyFailure> {
  const draft = await requireDraft(db, actor, input.companyId, "assignment_save", now);
  if (draft.status !== "ok") return draft;
  if (!isUuid(input.roleId)) return { status: "invalid", reason: "Choose a role." };
  const role = await db.select().from(accessRoles).where(eq(accessRoles.id, input.roleId)).limit(1);
  if (!role[0] || role[0].status !== "active") return { status: "invalid", reason: "Choose an active role." };
  const capabilities = await db.select().from(accessRoleCapabilities).where(eq(accessRoleCapabilities.roleId, input.roleId));
  const scope = roleScope(capabilities.map((row) => row.capabilityId));
  if (!scope.ok) return { status: "invalid", reason: scope.reason };
  const departmentId = departmentForScope(scope.scope, input.departmentId);
  if (departmentId instanceof Error) return { status: "invalid", reason: departmentId.message };
  if (departmentId && !(await activeDepartment(db, input.companyId, departmentId))) {
    return { status: "invalid", reason: "Choose a department that matches this role." };
  }
  const user = await activeUser(db, input.email);
  if (!user) return { status: "invalid", reason: "Choose an active Wolf account." };
  const current = await db.select().from(accessPolicyAssignments).where(and(
    eq(accessPolicyAssignments.versionId, draft.versionId),
    eq(accessPolicyAssignments.userId, user.id),
    eq(accessPolicyAssignments.kind, "assignment"),
  )).limit(1);
  if (current[0]) {
    await db.update(accessPolicyAssignments).set({
      roleId: input.roleId,
      departmentId,
      companyId: input.companyId,
    }).where(eq(accessPolicyAssignments.id, current[0].id));
  } else {
    await db.insert(accessPolicyAssignments).values({
      versionId: draft.versionId,
      userId: user.id,
      companyId: input.companyId,
      departmentId,
      roleId: input.roleId,
      kind: "assignment",
      effect: "allow",
    });
  }
  await auditAllowed(db, actor, input.companyId, draft.versionId, "assignment_save", now);
  return { status: "ok", versionId: draft.versionId };
}

export async function saveAccessException(
  db: AuthDatabase,
  actor: Actor,
  input: { companyId: string; email: string; capabilityId: string; effect: string; departmentId: string; justification: string; expiresOn: string },
  now: Date,
): Promise<PolicyOk<{ versionId: string }> | PolicyFailure> {
  const draft = await requireDraft(db, actor, input.companyId, "exception_save", now);
  if (draft.status !== "ok") return draft;
  const capability = capabilityById(input.capabilityId);
  if (!capability || capability.availability !== "assignable") return { status: "invalid", reason: "That permission is not enforced." };
  if (input.effect !== "allow" && input.effect !== "deny") return { status: "invalid", reason: "An exception must allow or deny." };
  const justification = input.justification.trim();
  if (justification.length < 8 || justification.length > 400) return { status: "invalid", reason: "Enter a justification." };
  const expiresAt = parseExpiry(input.expiresOn, now);
  if (!expiresAt) return { status: "invalid", reason: "Enter an expiry date in the future." };
  const user = await activeUser(db, input.email);
  if (!user) return { status: "invalid", reason: "Choose an active Wolf account." };
  const scope = roleScope([capability.id]);
  if (!scope.ok) return { status: "invalid", reason: scope.reason };
  const departmentId = departmentForScope(scope.scope, input.departmentId);
  if (departmentId instanceof Error) return { status: "invalid", reason: departmentId.message };
  if (departmentId && !(await activeDepartment(db, input.companyId, departmentId))) {
    return { status: "invalid", reason: "Choose a department that matches this permission." };
  }
  const existing = await db.select().from(accessPolicyAssignments).where(and(
    eq(accessPolicyAssignments.versionId, draft.versionId),
    eq(accessPolicyAssignments.userId, user.id),
    eq(accessPolicyAssignments.kind, "exception"),
    eq(accessPolicyAssignments.capabilityId, capability.id),
  )).limit(1);
  const values = {
    departmentId,
    effect: input.effect,
    justification,
    expiresAt,
    companyId: input.companyId,
  };
  if (existing[0]) await db.update(accessPolicyAssignments).set(values).where(eq(accessPolicyAssignments.id, existing[0].id));
  else {
    await db.insert(accessPolicyAssignments).values({
      versionId: draft.versionId,
      userId: user.id,
      roleId: null,
      kind: "exception",
      capabilityId: capability.id,
      ...values,
    });
  }
  await auditAllowed(db, actor, input.companyId, draft.versionId, "exception_save", now);
  return { status: "ok", versionId: draft.versionId };
}

export async function removeDraftRow(
  db: AuthDatabase,
  actor: Actor,
  input: { companyId: string; assignmentId: string },
  now: Date,
): Promise<PolicyOk<{ versionId: string }> | PolicyFailure> {
  const draft = await requireDraft(db, actor, input.companyId, "assignment_remove", now);
  if (draft.status !== "ok") return draft;
  if (!isUuid(input.assignmentId)) return { status: "invalid", reason: "Choose an assignment." };
  const removed = await db.delete(accessPolicyAssignments).where(and(
    eq(accessPolicyAssignments.id, input.assignmentId),
    eq(accessPolicyAssignments.versionId, draft.versionId),
  )).returning();
  if (!removed[0]) return { status: "invalid", reason: "Choose an assignment on the draft." };
  await auditAllowed(db, actor, input.companyId, draft.versionId, "assignment_remove", now);
  return { status: "ok", versionId: draft.versionId };
}

export async function publishAccessDraft(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
  reason: string,
  now: Date,
): Promise<PolicyOk<{ versionId: string; affected: number }> | PolicyFailure> {
  if (!canManageCompany(actor, companyId)) return auditDenied(db, actor, companyId, "publish", now);
  const text = cleanReason(reason);
  if (!text) return { status: "invalid", reason: "Enter a reason to publish." };
  const draft = await draftFor(db, companyId);
  if (!draft) return { status: "invalid", reason: "There is no draft to publish." };
  try {
    const affected = await db.transaction(async (tx) => {
      const database = tx as unknown as AuthDatabase;
      const assessed = await assessCompany(database, companyId, now);
      if (assessed.errors.length > 0) throw new PolicyRejection(assessed.errors[0] ?? "The draft is not valid.");
      if (missingAdministrator(companyId, assessed.authorityActors)) {
        throw new PolicyRejection("The last administrator or owner for this company would be removed.");
      }
      await database.update(accessPolicyVersions).set({ status: "superseded" }).where(and(
        eq(accessPolicyVersions.companyId, companyId),
        eq(accessPolicyVersions.status, "published"),
      ));
      await database.update(accessPolicyVersions).set({ status: "published", publishedAt: now, reason: text }).where(eq(accessPolicyVersions.id, draft.id));
      if (assessed.effects.length > 0) {
        await database.insert(accessPolicySnapshots).values(assessed.effects.map((effect) => ({
          versionId: draft.id,
          assignmentId: effect.assignmentId,
          userId: effect.userId,
          companyId: effect.companyId,
          departmentId: effect.departmentId,
          capabilityId: effect.capabilityId,
          effect: effect.effect,
          expiresAt: effect.expiresAt,
        })));
      }
      const changes = assessed.users.flatMap((user) => user.delta.map((change) => ({
        versionId: draft.id,
        userId: user.userId,
        companyId,
        capabilityId: change.capabilityId,
        changeKind: change.change,
        createdAt: now,
      })));
      if (changes.length > 0) await database.insert(accessPolicyChanges).values(changes);
      for (const user of assessed.users) {
        await replacePolicyRows(database, user, companyId, draft.id, now);
        if (user.userId !== actor.userId && user.delta.length > 0) await revokeUserSessions(database, user.userId, now);
      }
      await auditAllowed(database, actor, companyId, draft.id, "publish", now, assessed.users.length);
      return assessed.users.filter((user) => user.delta.length > 0).length;
    });
    return { status: "ok", versionId: draft.id, affected };
  } catch (error) {
    return rejected(error, "The policy could not be published.");
  }
}

export async function rollbackAccessPolicy(
  db: AuthDatabase,
  actor: Actor,
  versionId: string,
  reason: string,
  now: Date,
): Promise<PolicyOk<{ versionId: string }> | PolicyFailure> {
  if (!isUuid(versionId)) return { status: "invalid", reason: "Choose a published version." };
  const source = await db.select().from(accessPolicyVersions).where(eq(accessPolicyVersions.id, versionId)).limit(1);
  const version = source[0];
  if (!version || version.status === "draft" || !canManageCompany(actor, version.companyId)) {
    return auditDenied(db, actor, version?.companyId ?? null, "rollback", now);
  }
  const text = cleanReason(reason) ?? `Rollback to version ${version.versionNumber}`;
  try {
    const createdId = await db.transaction(async (tx) => {
      const database = tx as unknown as AuthDatabase;
      const snapshot = await database.select().from(accessPolicySnapshots).where(eq(accessPolicySnapshots.versionId, version.id));
      const effects: PolicyEffect[] = snapshot.flatMap((row) => {
        if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return [];
        return [{
          assignmentId: row.assignmentId,
          userId: row.userId,
          companyId: row.companyId,
          departmentId: row.departmentId,
          capabilityId: row.capabilityId,
          effect: row.effect === "deny" ? "deny" as const : "allow" as const,
          expiresAt: row.expiresAt,
          source: row.expiresAt ? "exception" as const : "assignment" as const,
        }];
      });
      const assessed = await assessCompany(database, version.companyId, now, effects);
      if (assessed.errors.length > 0) throw new PolicyRejection(assessed.errors[0] ?? "That version cannot be published.");
      if (missingAdministrator(version.companyId, assessed.authorityActors)) {
        throw new PolicyRejection("The last administrator or owner for this company would be removed.");
      }
      const versionNumber = await nextVersionNumber(database, version.companyId);
      await database.update(accessPolicyVersions).set({ status: "superseded" }).where(and(
        eq(accessPolicyVersions.companyId, version.companyId),
        eq(accessPolicyVersions.status, "published"),
      ));
      const created = (await database.insert(accessPolicyVersions).values({
        companyId: version.companyId,
        versionNumber,
        status: "published",
        reason: text,
        createdBy: actor.userId,
        createdAt: now,
        publishedAt: now,
        basedOnVersionId: version.id,
      }).returning())[0];
      if (!created) throw new PolicyRejection("The rollback could not be published.");
      const previousAssignments = await database.select().from(accessPolicyAssignments).where(eq(accessPolicyAssignments.versionId, version.id));
      const idMap = new Map<string, string>();
      for (const row of previousAssignments) {
        const copy = (await database.insert(accessPolicyAssignments).values({
          versionId: created.id,
          userId: row.userId,
          companyId: row.companyId,
          departmentId: row.departmentId,
          roleId: row.roleId,
          kind: row.kind,
          effect: row.effect,
          capabilityId: row.capabilityId,
          justification: row.justification,
          expiresAt: row.expiresAt,
        }).returning())[0];
        if (!copy) throw new PolicyRejection("The rollback could not be published.");
        idMap.set(row.id, copy.id);
      }
      if (snapshot.length > 0) {
        await database.insert(accessPolicySnapshots).values(snapshot.map((row) => ({
          versionId: created.id,
          assignmentId: idMap.get(row.assignmentId) ?? row.assignmentId,
          userId: row.userId,
          companyId: row.companyId,
          departmentId: row.departmentId,
          capabilityId: row.capabilityId,
          effect: row.effect,
          expiresAt: row.expiresAt,
        })));
      }
      const changes = assessed.users.flatMap((user) => user.delta.map((change) => ({
        versionId: created.id,
        userId: user.userId,
        companyId: version.companyId,
        capabilityId: change.capabilityId,
        changeKind: change.change,
        createdAt: now,
      })));
      if (changes.length > 0) await database.insert(accessPolicyChanges).values(changes);
      for (const user of assessed.users) {
        await replacePolicyRows(database, user, version.companyId, created.id, now);
        if (user.userId !== actor.userId && user.delta.length > 0) await revokeUserSessions(database, user.userId, now);
      }
      await auditAllowed(database, actor, version.companyId, created.id, "rollback", now, assessed.users.length);
      return created.id;
    });
    return { status: "ok", versionId: createdId };
  } catch (error) {
    return rejected(error, "The rollback could not be published.");
  }
}

export type DraftAssessment = {
  errors: string[];
  affected: number;
  changes: Array<{ email: string; capabilityId: string; change: "granted" | "revoked" }>;
};

export async function assessAccessDraft(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
  now: Date,
): Promise<PolicyOk<DraftAssessment> | PolicyFailure> {
  if (!canManageCompany(actor, companyId)) return { status: "denied" };
  const draft = await draftFor(db, companyId);
  if (!draft) return { status: "invalid", reason: "There is no draft to validate." };
  const assessed = await assessCompany(db, companyId, now);
  const emails = await emailsById(db, assessed.users.map((user) => user.userId));
  return {
    status: "ok",
    errors: assessed.errors,
    affected: assessed.users.filter((user) => user.delta.length > 0).length,
    changes: assessed.users.flatMap((user) => user.delta.map((change) => ({
      email: emails.get(user.userId) ?? user.userId,
      capabilityId: change.capabilityId,
      change: change.change,
    }))),
  };
}

export async function previewCompanyAccess(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
  email: string,
  now: Date,
): Promise<PolicyOk<{ lines: PreviewLine[]; email: string }> | PolicyFailure> {
  if (!canManageCompany(actor, companyId)) return { status: "denied" };
  const user = await activeUser(db, email);
  if (!user) return { status: "invalid", reason: "Choose an active Wolf account." };
  const loaded = await loadTrustedActorRows(db, user.id, now);
  const published = await publishedFor(db, companyId);
  const snapshot = published
    ? await db.select().from(accessPolicySnapshots).where(eq(accessPolicySnapshots.versionId, published.id))
    : [];
  const effects = snapshot.filter((row) => row.userId === user.id).map((row) => ({
    assignmentId: row.assignmentId,
    userId: row.userId,
    companyId: row.companyId,
    departmentId: row.departmentId,
    capabilityId: row.capabilityId,
    effect: row.effect === "deny" ? "deny" as const : "allow" as const,
    expiresAt: row.expiresAt,
    source: row.expiresAt ? "exception" as const : "assignment" as const,
  }));
  return { status: "ok", email: user.emailNormalized, lines: previewLines(loaded.actor, companyId, effects, now) };
}

export async function simulateAccessDraft(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
  email: string,
  now: Date,
): Promise<PolicyOk<{ changes: AccessChange[]; errors: string[] }> | PolicyFailure> {
  if (!canManageCompany(actor, companyId)) return { status: "denied" };
  const user = await activeUser(db, email);
  if (!user) return { status: "invalid", reason: "Choose an active Wolf account." };
  const draft = await draftFor(db, companyId);
  if (!draft) return { status: "invalid", reason: "There is no draft to simulate." };
  const assessed = await assessCompany(db, companyId, now);
  if (assessed.errors.length > 0) return { status: "ok", changes: [], errors: assessed.errors };
  const match = assessed.users.find((item) => item.userId === user.id);
  if (!match) return { status: "ok", changes: compareAccess(matchActor(user.id), matchActor(user.id), companyId, []), errors: [] };
  return { status: "ok", changes: compareAccess(match.before, match.after, companyId, assessed.effects.filter((effect) => effect.userId === user.id)), errors: [] };
}

export async function listManagedCompanies(db: AuthDatabase, actor: Actor) {
  const ids = managedCompanyIds(actor);
  if (ids.length === 0) return [];
  return db.select().from(companies).where(inArray(companies.id, ids)).orderBy(asc(companies.id));
}

export async function listAccessHistory(db: AuthDatabase, actor: Actor, companyId: string) {
  if (!canManageCompany(actor, companyId)) return { status: "denied" as const };
  const versions = await db.select().from(accessPolicyVersions).where(eq(accessPolicyVersions.companyId, companyId)).orderBy(asc(accessPolicyVersions.versionNumber));
  const changes = versions.length === 0
    ? []
    : await db.select().from(accessPolicyChanges).where(inArray(accessPolicyChanges.versionId, versions.map((version) => version.id)));
  const emails = await emailsById(db, [...versions.map((version) => version.createdBy), ...changes.map((change) => change.userId)]);
  return { status: "ok" as const, versions, changes, emails };
}

async function assessCompany(db: AuthDatabase, companyId: string, now: Date, override?: PolicyEffect[]) {
  const draft = override ? null : await draftFor(db, companyId);
  let effects: PolicyEffect[] = override ?? [];
  const errors: string[] = [];
  if (!override) {
    if (!draft) errors.push("There is no draft to publish.");
    else {
      const rows = await db.select().from(accessPolicyAssignments).where(eq(accessPolicyAssignments.versionId, draft.id));
      const built = effectsFromDraft(rows.map(toDraftAssignment), await rolesFor(db, rows), now);
      effects = built.effects;
      errors.push(...built.errors);
    }
  }
  const userIds = new Set<string>(effects.map((effect) => effect.userId));
  const policyMemberships = await db.select().from(memberships).where(and(eq(memberships.companyId, companyId), eq(memberships.origin, "policy"), eq(memberships.status, "active")));
  const policyGrants = await db.select().from(grants).where(and(eq(grants.companyId, companyId), eq(grants.origin, "policy"), eq(grants.status, "active")));
  const managers = await db.select().from(memberships).where(and(eq(memberships.companyId, companyId), eq(memberships.status, "active"), inArray(memberships.role, ["administrator", "owner"])));
  for (const row of [...policyMemberships, ...policyGrants, ...managers]) userIds.add(row.userId);
  const usersAssessed: Array<{ userId: string; before: Actor; after: Actor; insertMemberships: CompanyPlan["insertMemberships"]; insertGrants: CompanyPlan["insertGrants"]; delta: ReturnType<typeof capabilityDelta>; errors: string[] }> = [];
  for (const userId of userIds) {
    const loaded = await loadTrustedActorRows(db, userId, now);
    const keptMemberships = loaded.memberships.filter((row) => !(row.origin === "policy" && row.companyId === companyId)).map(toMembership);
    const keptGrants = loaded.grants.filter((row) => !(row.origin === "policy" && row.companyId === companyId)).map(toGrant);
    const plan = planCompanyUser({ userId, companyId, keptMemberships, keptGrants, effects, now });
    usersAssessed.push({
      userId,
      before: loaded.actor,
      after: plan.actor,
      insertMemberships: plan.insertMemberships,
      insertGrants: plan.insertGrants,
      delta: plan.errors.length > 0 ? [] : capabilityDelta(loaded.actor, plan.actor, companyId),
      errors: plan.errors,
    });
    errors.push(...plan.errors);
  }
  const authorityActors = usersAssessed.map((user) => (user.errors.length > 0 ? user.before : user.after));
  for (const row of managers) {
    if (!userIds.has(row.userId)) {
      const loaded = await loadTrustedActorRows(db, row.userId, now);
      authorityActors.push(loaded.actor);
    }
  }
  return { errors: unique(errors), effects, users: usersAssessed, authorityActors };
}

async function replacePolicyRows(
  db: AuthDatabase,
  user: { userId: string; insertMemberships: CompanyPlan["insertMemberships"]; insertGrants: CompanyPlan["insertGrants"] },
  companyId: string,
  versionId: string,
  now: Date,
) {
  await db.update(memberships).set({ status: "disabled", updatedAt: now }).where(and(
    eq(memberships.userId, user.userId),
    eq(memberships.companyId, companyId),
    eq(memberships.origin, "policy"),
    eq(memberships.status, "active"),
  ));
  await db.update(grants).set({ status: "disabled" }).where(and(
    eq(grants.userId, user.userId),
    eq(grants.companyId, companyId),
    eq(grants.origin, "policy"),
    eq(grants.status, "active"),
  ));
  if (user.insertMemberships.length > 0) {
    await db.insert(memberships).values(user.insertMemberships.map((membership) => ({
      userId: user.userId,
      companyId: membership.companyId,
      departmentId: membership.departmentId,
      role: membership.role,
      status: "active" as const,
      origin: "policy" as const,
      expiresAt: membership.expiresAt,
      policyVersionId: versionId,
      createdAt: now,
      updatedAt: now,
    })));
  }
  if (user.insertGrants.length > 0) {
    await db.insert(grants).values(user.insertGrants.map((grant) => ({
      userId: user.userId,
      grantType: grant.type,
      companyId: grant.companyId,
      scope: grant.type === "approve" ? grant.scope : null,
      departmentId: grant.type === "approve" ? grant.departmentId : null,
      origin: "policy" as const,
      status: "active" as const,
      expiresAt: grant.expiresAt,
      policyVersionId: versionId,
      createdAt: now,
    })));
  }
}

async function loadTrustedActorRows(db: AuthDatabase, userId: string, now: Date) {
  const membershipRows = await db.select().from(memberships).where(and(
    eq(memberships.userId, userId),
    eq(memberships.status, "active"),
    or(isNull(memberships.expiresAt), gt(memberships.expiresAt, now)),
  ));
  const grantRows = await db.select().from(grants).where(and(
    eq(grants.userId, userId),
    eq(grants.status, "active"),
    or(isNull(grants.expiresAt), gt(grants.expiresAt, now)),
  ));
  return {
    memberships: membershipRows,
    grants: grantRows,
    actor: toActor(userId, membershipRows, grantRows),
  };
}

async function rolesFor(db: AuthDatabase, rows: Array<{ roleId: string | null }>) {
  const ids = unique(rows.map((row) => row.roleId).filter((id): id is string => !!id));
  const map = new Map<string, { status: string; capabilityIds: string[] }>();
  if (ids.length === 0) return map;
  const roleRows = await db.select().from(accessRoles).where(inArray(accessRoles.id, ids));
  const capabilityRows = await db.select().from(accessRoleCapabilities).where(inArray(accessRoleCapabilities.roleId, ids));
  for (const role of roleRows) map.set(role.id, { status: role.status, capabilityIds: [] });
  for (const capability of capabilityRows) map.get(capability.roleId)?.capabilityIds.push(capability.capabilityId);
  return map;
}

function toDraftAssignment(row: typeof accessPolicyAssignments.$inferSelect): DraftAssignment {
  return {
    id: row.id,
    userId: row.userId,
    companyId: row.companyId,
    departmentId: row.departmentId,
    kind: row.kind === "exception" ? "exception" : "assignment",
    effect: row.effect === "deny" ? "deny" : "allow",
    roleId: row.roleId,
    capabilityId: row.capabilityId,
    expiresAt: row.expiresAt,
    justification: row.justification,
  };
}

function toMembership(row: MembershipRecord & { role: string }): Membership {
  return { companyId: row.companyId, departmentId: row.departmentId, role: row.role as Membership["role"] };
}

function toGrant(row: GrantRecord): Grant {
  if (row.grantType === "owner_private") return { type: "owner_private", companyId: row.companyId };
  return {
    type: "approve",
    companyId: row.companyId,
    scope: row.scope === "owner_private" || row.scope === "department" ? row.scope : "company",
    departmentId: row.scope === "department" ? row.departmentId : null,
  };
}

async function requireDraft(db: AuthDatabase, actor: Actor, companyId: string, action: string, now: Date) {
  if (!canManageCompany(actor, companyId)) return auditDenied(db, actor, companyId, action, now);
  const draft = await draftFor(db, companyId);
  if (!draft) return { status: "invalid" as const, reason: "Open a draft before changing assignments." };
  return { status: "ok" as const, versionId: draft.id };
}

async function draftFor(db: AuthDatabase, companyId: string) {
  return (await db.select().from(accessPolicyVersions).where(and(eq(accessPolicyVersions.companyId, companyId), eq(accessPolicyVersions.status, "draft"))).limit(1))[0] ?? null;
}

async function publishedFor(db: AuthDatabase, companyId: string) {
  return (await db.select().from(accessPolicyVersions).where(and(eq(accessPolicyVersions.companyId, companyId), eq(accessPolicyVersions.status, "published"))).limit(1))[0] ?? null;
}

async function nextVersionNumber(db: AuthDatabase, companyId: string) {
  const rows = await db.select({ versionNumber: accessPolicyVersions.versionNumber }).from(accessPolicyVersions).where(eq(accessPolicyVersions.companyId, companyId));
  return rows.reduce((max, row) => Math.max(max, row.versionNumber), 0) + 1;
}

async function positionFields(
  db: AuthDatabase,
  actor: Actor,
  input: { companyId: string; departmentId: string; name: string; description: string; reportsToId: string; suggestedRoleId: string },
) {
  if (!canManageCompany(actor, input.companyId)) return { status: "denied" as const };
  const name = cleanName(input.name);
  const description = cleanDescription(input.description);
  if (!name || description === null) return { status: "invalid" as const, reason: "Enter a position name." };
  const departmentId = blank(input.departmentId);
  if (departmentId && !(await activeDepartment(db, input.companyId, departmentId))) {
    return { status: "invalid" as const, reason: "Choose a department in this company." };
  }
  const reportsToId = blank(input.reportsToId);
  if (reportsToId) {
    if (!isUuid(reportsToId)) return { status: "invalid" as const, reason: "Choose a reporting position." };
    const manager = await db.select().from(accessPositions).where(eq(accessPositions.id, reportsToId)).limit(1);
    if (!manager[0] || manager[0].companyId !== input.companyId) return { status: "invalid" as const, reason: "Choose a reporting position in this company." };
  }
  const suggestedRoleId = blank(input.suggestedRoleId);
  if (suggestedRoleId) {
    if (!isUuid(suggestedRoleId)) return { status: "invalid" as const, reason: "Choose a suggested role." };
    const role = await db.select().from(accessRoles).where(eq(accessRoles.id, suggestedRoleId)).limit(1);
    if (!role[0]) return { status: "invalid" as const, reason: "Choose a suggested role." };
  }
  return { status: "ok" as const, name, description, departmentId, reportsToId, suggestedRoleId };
}

async function reportCycle(db: AuthDatabase, positionId: string, reportsToId: string) {
  let current: string | null = reportsToId;
  const seen = new Set<string>([positionId]);
  for (let index = 0; index < 20 && current; index += 1) {
    if (seen.has(current)) return true;
    seen.add(current);
    const row: { reportsToId: string | null } | undefined = (await db.select({ reportsToId: accessPositions.reportsToId }).from(accessPositions).where(eq(accessPositions.id, current)).limit(1))[0];
    current = row?.reportsToId ?? null;
  }
  return false;
}

async function activeDepartment(db: AuthDatabase, companyId: string, departmentId: string | null) {
  if (!departmentId) return null;
  const row = (await db.select().from(departments).where(and(eq(departments.companyId, companyId), eq(departments.id, departmentId))).limit(1))[0];
  return row && row.status === "active" ? row : null;
}

async function activeUser(db: AuthDatabase, email: string) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const row = (await db.select().from(users).where(eq(users.emailNormalized, normalized)).limit(1))[0];
  return row && row.status === "active" ? row : null;
}

async function emailsById(db: AuthDatabase, ids: string[]) {
  const uniqueIds = unique(ids);
  const map = new Map<string, string>();
  if (uniqueIds.length === 0) return map;
  const rows = await db.select({ id: users.id, email: users.emailNormalized }).from(users).where(inArray(users.id, uniqueIds));
  for (const row of rows) map.set(row.id, row.email);
  return map;
}

async function availableCopyName(db: AuthDatabase, name: string) {
  const base = `Copy of ${name}`.slice(0, 80);
  const rows = await db.select({ name: accessRoles.name }).from(accessRoles).where(eq(accessRoles.status, "active"));
  const taken = new Set(rows.map((row) => row.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let index = 2; index < 50; index += 1) {
    const suffix = ` ${index}`;
    const candidate = `${base.slice(0, 80 - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return base;
}

async function auditAllowed(db: AuthDatabase, actor: Actor, companyId: string | null, resourceId: string, action: string, now: Date, affected?: number) {
  const storedCompany = await existingCompany(db, companyId);
  await writeAudit(db, {
    eventType: "authorization_allowed",
    userId: actor.userId,
    companyId: storedCompany,
    resourceType: "access_policy",
    resourceId,
    emailFingerprint: null,
    ip: null,
    metadata: { module: "access", action, ...(affected === undefined ? {} : { affected }) },
    createdAt: now,
  });
}

async function auditDenied(db: AuthDatabase, actor: Actor, companyId: string | null, action: string, now: Date): Promise<PolicyDenied> {
  const storedCompany = await existingCompany(db, companyId);
  if (storedCompany || actor.userId) {
    await writeAudit(db, {
      eventType: "authorization_denied",
      userId: actor.userId,
      companyId: storedCompany,
      resourceType: "access_policy",
      resourceId: storedCompany ?? actor.userId,
      emailFingerprint: null,
      ip: null,
      metadata: { module: "access", action },
      createdAt: now,
    });
  }
  return { status: "denied" };
}

async function existingCompany(db: AuthDatabase, companyId: string | null) {
  if (!companyId) return null;
  const row = (await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).limit(1))[0];
  return row?.id ?? null;
}

function rejected(error: unknown, fallback: string): PolicyInvalid {
  if (error instanceof PolicyRejection) return { status: "invalid", reason: error.message };
  return { status: "invalid", reason: fallback };
}

function matchActor(userId: string): Actor {
  return { userId, memberships: [], grants: [] };
}

function cleanName(value: string): string | null {
  const name = value.trim();
  return name.length >= 1 && name.length <= 80 ? name : null;
}

function cleanDescription(value: string): string | null {
  const description = value.trim();
  return description.length <= 400 ? description : null;
}

function cleanReason(value: string): string | null {
  const reason = value.trim();
  return reason.length >= 1 && reason.length <= 400 ? reason : null;
}

function parseExpiry(value: string, now: Date): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const expiry = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59));
  if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= now.getTime()) return null;
  return expiry;
}

function blank(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function isUuid(value: string): boolean {
  return uuidPattern.test(value);
}

function departmentForScope(scope: "company" | DepartmentKey, departmentId: string): string | null | Error {
  const department = blank(departmentId);
  if (scope === "company") {
    return department ? new Error("Company permissions cannot be limited to one department.") : null;
  }
  if (!department || !departmentServesModule(department, scope)) {
    return new Error("Choose a department that matches this permission.");
  }
  return department;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export async function readAccessDesk(db: AuthDatabase, actor: Actor, requestedCompanyId: string | null) {
  if (!canManageAccessPolicies(actor)) return { status: "denied" as const };
  const managed = await listManagedCompanies(db, actor);
  const company = managed.find((row) => row.id === requestedCompanyId) ?? managed[0] ?? null;
  const roleRows = await db.select().from(accessRoles).orderBy(asc(accessRoles.name));
  const roleIds = roleRows.map((row) => row.id);
  const capabilityRows = roleIds.length === 0
    ? []
    : await db.select().from(accessRoleCapabilities).where(inArray(accessRoleCapabilities.roleId, roleIds));
  const roles = roleRows.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    status: role.status,
    capabilityIds: capabilityRows.filter((row) => row.roleId === role.id).map((row) => row.capabilityId),
  }));
  if (!company) {
    return emptyDesk(managed, roles);
  }
  const departmentRows = await db
    .select()
    .from(departments)
    .where(and(eq(departments.companyId, company.id), eq(departments.status, "active")))
    .orderBy(asc(departments.id));
  const positionRows = await db.select().from(accessPositions).where(eq(accessPositions.companyId, company.id)).orderBy(asc(accessPositions.name));
  const positionIds = positionRows.map((row) => row.id);
  const holderRows = positionIds.length === 0
    ? []
    : await db.select().from(accessPositionHolders).where(and(inArray(accessPositionHolders.positionId, positionIds), eq(accessPositionHolders.status, "active")));
  const draft = await draftFor(db, company.id);
  const published = await publishedFor(db, company.id);
  const assignmentRows = draft
    ? await db.select().from(accessPolicyAssignments).where(eq(accessPolicyAssignments.versionId, draft.id))
    : [];
  const history = await listAccessHistory(db, actor, company.id);
  const historyEmails = history.status === "ok" ? history.emails : new Map<string, string>();
  const emails = await emailsById(db, [
    ...holderRows.map((row) => row.userId),
    ...assignmentRows.map((row) => row.userId),
    ...historyEmails.keys(),
  ]);
  for (const [id, email] of historyEmails) emails.set(id, email);
  for (const managedCompany of managed) {
    await ensureCompanyOperatingSystem(db, managedCompany.id);
  }
  const operating = await readCompanyOperatingSystem(db, company.id);
  return {
    status: "ok" as const,
    companies: managed,
    company,
    roles,
    departments: departmentRows.map((row) => ({ id: row.id, name: row.name })),
    positions: positionRows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      departmentId: row.departmentId,
      reportsToId: row.reportsToId,
      suggestedRoleId: row.suggestedRoleId,
    })),
    holders: holderRows.map((row) => ({ positionId: row.positionId, email: emails.get(row.userId) ?? row.userId })),
    draft: draft ? { id: draft.id, versionNumber: draft.versionNumber, reason: draft.reason } : null,
    published: published ? { id: published.id, versionNumber: published.versionNumber, reason: published.reason } : null,
    assignments: assignmentRows.map((row) => ({
      id: row.id,
      email: emails.get(row.userId) ?? row.userId,
      kind: row.kind,
      effect: row.effect,
      departmentId: row.departmentId,
      roleName: roles.find((role) => role.id === row.roleId)?.name ?? null,
      capabilityId: row.capabilityId,
      justification: row.justification,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString().slice(0, 10) : null,
    })),
    history: history.status === "ok"
      ? {
          versions: history.versions.map((version) => ({
            id: version.id,
            versionNumber: version.versionNumber,
            status: version.status,
            reason: version.reason,
            publishedAt: version.publishedAt ? version.publishedAt.toISOString().slice(0, 10) : null,
            author: history.emails.get(version.createdBy) ?? "Wolf account",
          })),
          changes: history.changes.map((change) => ({
            versionId: change.versionId,
            email: history.emails.get(change.userId) ?? "Wolf account",
            capabilityId: change.capabilityId,
            changeKind: change.changeKind,
          })),
        }
      : { versions: [], changes: [] },
    operating,
  };
}

function emptyDesk(
  managed: Array<{ id: string; name: string }>,
  roles: Array<{ id: string; name: string; description: string; status: string; capabilityIds: string[] }>,
) {
  return {
    status: "ok" as const,
    companies: managed,
    company: null,
    roles,
    departments: [] as Array<{ id: string; name: string }>,
    positions: [] as Array<{ id: string; name: string; description: string; status: string; departmentId: string | null; reportsToId: string | null; suggestedRoleId: string | null }>,
    holders: [] as Array<{ positionId: string; email: string }>,
    draft: null,
    published: null,
    assignments: [] as Array<{ id: string; email: string; kind: string; effect: string; departmentId: string | null; roleName: string | null; capabilityId: string | null; justification: string | null; expiresAt: string | null }>,
    history: { versions: [] as Array<{ id: string; versionNumber: number; status: string; reason: string; publishedAt: string | null; author: string }>, changes: [] as Array<{ versionId: string; email: string; capabilityId: string; changeKind: string }> },
    operating: null,
  };
}

export { assignableCapabilities, unavailableCapabilities, canManageAccessPolicies, managedCompanyIds };
