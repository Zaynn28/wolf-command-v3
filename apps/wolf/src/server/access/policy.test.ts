import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { readSession } from "../auth/session";
import { accessPolicyAssignments, accessPolicyVersions, auditEvents, memberships, users } from "../db/schema";
import { ensureTenant } from "../db/tenant";
import type { AuthDatabase } from "../db/types";
import { financeWorkspace } from "../finance/companies";
import { hrAccess } from "../hr/companies";
import { signIn, withDb } from "../test/harness";
import { loadTrustedActor } from "./actor";
import { evaluateModuleAccess, isModuleId } from "./matrix";
import { grantedHrefs } from "./navigation-access";
import { assignableCapabilityIds, canManageAccessPolicies, catalogProblems, roleScope } from "./policy-model";
import {
  assignAccessPosition,
  createAccessPosition,
  createAccessRole,
  deactivateAccessRole,
  duplicateAccessRole,
  listAccessHistory,
  openAccessDraft,
  previewCompanyAccess,
  publishAccessDraft,
  removeDraftRow,
  rollbackAccessPolicy,
  saveAccessAssignment,
  saveAccessException,
  simulateAccessDraft,
  updateAccessRole,
} from "./policy-service";

const now = new Date("2030-01-15T00:00:00.000Z");

test("the permission catalog matches the runtime evaluator and hides unsupported switches", () => {
  assert.deepEqual(catalogProblems(), []);
  assert.equal(roleScope(["hr.payroll.read"]).ok, false);
  assert.equal(roleScope(["membership.department.finance.staff", "membership.company.owner"]).ok, false);
  assert.equal(roleScope(["membership.department.procurement.staff"]).ok, true);
  const migration = readFileSync(new URL("../db/migrations/0015_access_policy.sql", import.meta.url), "utf8");
  for (const id of assignableCapabilityIds) assert.match(migration, new RegExp(id.replaceAll(".", "\\.")));
  assert.equal(migration.includes("hr.payroll.read"), false);
  assert.equal(migration.includes("developer.bypass"), false);
  assert.equal(migration.includes("drop table"), false);
  assert.equal(migration.includes("truncate"), false);
});

test("staff cannot manage policy, a position does not grant access, and publish is company scoped", async () => {
  await withDb(async (db) => {
    await tenant(db);
    const admin = await addMembershipUser(db, "policy-admin@wolf-command.test", "amg", null, "administrator");
    const staff = await addMembershipUser(db, "policy-staff@wolf-command.test", "amg", "finance", "staff");
    const target = await addUser(db, "policy-target@wolf-command.test");
    assert.equal(canManageAccessPolicies(staff.actor), false);
    assert.equal(grantedHrefs(staff.actor).includes("/access"), false);
    assert.equal(grantedHrefs(admin.actor).includes("/access"), true);
    assert.equal((await createAccessRole(db, staff.actor, { name: "Nope", description: "", capabilityIds: ["membership.department.finance.staff"] }, now)).status, "denied");
    const denied = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "authorization_denied"));
    assert.equal(denied.length > 0, true);

    const role = await createAccessRole(db, admin.actor, {
      name: "AMG procurement",
      description: "Store procurement",
      capabilityIds: ["membership.department.procurement.staff"],
    }, now);
    assert.equal(role.status, "ok");
    if (role.status !== "ok") return;
    const position = await createAccessPosition(db, admin.actor, {
      companyId: "amg",
      departmentId: "procurement",
      name: "Store manager",
      description: "Suggested only",
      reportsToId: "",
      suggestedRoleId: role.roleId,
    }, now);
    assert.equal(position.status, "ok");
    if (position.status !== "ok") return;
    const before = await loadTrustedActor(db, target.id);
    assert.equal((await assignAccessPosition(db, admin.actor, { positionId: position.positionId, email: target.emailNormalized }, now)).status, "ok");
    assert.deepEqual(await loadTrustedActor(db, target.id), before);

    assert.equal((await publishAccessDraft(db, staff.actor, "amg", "Staff publish", now)).status, "denied");
    assert.equal((await openAccessDraft(db, admin.actor, "bzg", "Wrong company", now)).status, "denied");
    assert.equal((await openAccessDraft(db, admin.actor, "amg", "Procurement draft", now)).status, "ok");
    assert.equal((await saveAccessAssignment(db, admin.actor, {
      companyId: "amg",
      email: target.emailNormalized,
      roleId: role.roleId,
      departmentId: "procurement",
    }, now)).status, "ok");
    const simulated = await simulateAccessDraft(db, admin.actor, "amg", target.emailNormalized, now);
    assert.equal(simulated.status, "ok");
    if (simulated.status !== "ok") return;
    assert.equal(simulated.errors.length, 0);
    const financeRead = simulated.changes.find((change) => change.label === "finance read");
    const procurementRead = simulated.changes.find((change) => change.label === "procurement read");
    assert.equal(financeRead?.after, "deny");
    assert.equal(procurementRead?.after, "allow");
    assert.equal(procurementRead?.change, "increase");
    assert.match(procurementRead?.source ?? "", /membership\.department\.procurement\.staff/);

    const published = await publishAccessDraft(db, admin.actor, "amg", "Give AMG procurement", now);
    assert.equal(published.status, "ok");
    const actor = await loadTrustedActor(db, target.id);
    assert.ok(actor);
    if (!actor) return;
    assert.equal(evaluateModuleAccess(actor, "procurement", "read", { companyId: "amg" }).outcome, "allow");
    assert.equal(evaluateModuleAccess(actor, "finance", "read", { companyId: "amg" }).outcome, "deny");
    assert.equal(evaluateModuleAccess(actor, "procurement", "read", { companyId: "bzg" }).outcome, "deny");
    assert.equal(evaluateModuleAccess(actor, "hr", "read", { companyId: "amg" }).outcome, "deny");
    assert.equal(evaluateModuleAccess(actor, "owner_private", "read", { companyId: "amg" }).outcome, "deny");
    assert.equal(hrAccess(actor, "amg"), "employee");
    assert.equal(financeWorkspace(actor, "amg"), "procurement");
    assert.equal(grantedHrefs(actor).some((href) => href.includes("procurement")), false);
    for (const change of simulated.changes) {
      const [module, action] = change.label.split(" ");
      if (!module || !action || !isModuleId(module) || !isAction(action)) continue;
      const runtime = evaluateModuleAccess(actor, module, action, { companyId: "amg" }).outcome;
      assert.equal(runtime, change.after, change.label);
    }

    const preview = await previewCompanyAccess(db, admin.actor, "amg", target.emailNormalized, now);
    assert.equal(preview.status, "ok");
    if (preview.status !== "ok") return;
    const payroll = preview.lines.find((line) => line.capabilityId === "hr.payroll.read");
    const procurement = preview.lines.find((line) => line.capabilityId === "membership.department.procurement.staff");
    assert.equal(payroll?.effective, false);
    assert.equal(payroll?.enforced, false);
    assert.equal(procurement?.effective, true);
    assert.equal(procurement?.source, "Published policy");
  });
});

test("companies keep different roles, owner private is explicit, and a shared role edit waits for publish", async () => {
  await withDb(async (db) => {
    await tenant(db);
    const admin = await addMembershipUser(db, "multi-admin@wolf-command.test", "amg", null, "administrator");
    await db.insert(memberships).values({ userId: admin.user.id, companyId: "bzg", departmentId: null, role: "owner", status: "active" });
    const refreshed = await loadTrustedActor(db, admin.user.id);
    assert.ok(refreshed);
    if (!refreshed) return;
    const person = await addUser(db, "multi-person@wolf-command.test");
    const procurement = await mustRole(db, refreshed, "BZG stays put", ["membership.department.procurement.staff"]);
    const hr = await mustRole(db, refreshed, "BZG HR", ["membership.department.hr.staff"]);
    const owner = await mustRole(db, refreshed, "Company owner", ["membership.company.owner"]);
    await publishRole(db, refreshed, "amg", person.emailNormalized, procurement, "procurement");
    await publishRole(db, refreshed, "bzg", person.emailNormalized, hr, "hr");
    let actor = await loadTrustedActor(db, person.id);
    assert.ok(actor);
    if (!actor) return;
    assert.equal(financeWorkspace(actor, "amg"), "procurement");
    assert.equal(financeWorkspace(actor, "bzg"), null);
    assert.equal(hrAccess(actor, "amg"), "employee");
    assert.equal(hrAccess(actor, "bzg"), "staff");
    assert.equal(evaluateModuleAccess(actor, "hr", "read", { companyId: "amg" }).outcome, "deny");
    assert.equal(evaluateModuleAccess(actor, "finance", "read", { companyId: "bzg" }).outcome, "deny");

    await updateAccessRole(db, refreshed, { roleId: procurement, name: "BZG stays put", description: "", capabilityIds: ["membership.department.procurement.administrator"] }, now);
    actor = await loadTrustedActor(db, person.id);
    assert.equal(evaluateModuleAccess(actor!, "procurement", "delete", { companyId: "amg" }).outcome, "deny");
    assert.equal(evaluateModuleAccess(actor!, "overview", "read", { companyId: "amg" }).outcome, "deny");
    await publishRole(db, refreshed, "amg", person.emailNormalized, procurement, "procurement");
    actor = await loadTrustedActor(db, person.id);
    assert.equal(evaluateModuleAccess(actor!, "procurement", "delete", { companyId: "amg" }).outcome, "allow");
    assert.equal(hrAccess(actor!, "bzg"), "staff");

    await publishRole(db, refreshed, "amg", person.emailNormalized, owner, "");
    actor = await loadTrustedActor(db, person.id);
    assert.equal(evaluateModuleAccess(actor!, "owner_private", "read", { companyId: "amg" }).outcome, "deny");
    assert.equal(evaluateModuleAccess(actor!, "organization", "create", { companyId: "amg" }).outcome, "allow");
    assert.equal((await openAccessDraft(db, refreshed, "amg", "Owner private exception", now)).status, "ok");
    assert.equal((await saveAccessException(db, refreshed, {
      companyId: "amg",
      email: person.emailNormalized,
      capabilityId: "grant.owner_private",
      effect: "allow",
      departmentId: "",
      justification: "Named owner private review",
      expiresOn: "2030-06-01",
    }, now)).status, "ok");
    assert.equal((await publishAccessDraft(db, refreshed, "amg", "Add owner private", now)).status, "ok");
    actor = await loadTrustedActor(db, person.id);
    assert.equal(evaluateModuleAccess(actor!, "owner_private", "read", { companyId: "amg" }).outcome, "allow");
    assert.equal(evaluateModuleAccess(actor!, "owner_private", "approve", { companyId: "amg" }).outcome, "deny");
    assert.equal(hrAccess(actor!, "bzg"), "staff");
  });
});

test("the last policy administrator cannot be removed, and history can roll back", async () => {
  await withDb(async (db) => {
    await tenant(db);
    const admin = await addMembershipUser(db, "last-admin@wolf-command.test", "amg", null, "administrator");
    const successor = await addUser(db, "successor@wolf-command.test");
    const role = await mustRole(db, admin.actor, "AMG administrators", ["membership.company.administrator"]);
    await publishRole(db, admin.actor, "amg", successor.emailNormalized, role, "");
    await db.update(memberships).set({ status: "disabled" }).where(eq(memberships.userId, admin.user.id));
    const successorActor = await loadTrustedActor(db, successor.id);
    assert.ok(successorActor);
    if (!successorActor) return;
    assert.equal((await openAccessDraft(db, successorActor, "amg", "Remove myself", now)).status, "ok");
    const draft = (await db.select().from(accessPolicyVersions).where(and(eq(accessPolicyVersions.companyId, "amg"), eq(accessPolicyVersions.status, "draft"))))[0];
    assert.ok(draft);
    const rows = await db.select().from(accessPolicyAssignments).where(eq(accessPolicyAssignments.versionId, draft.id));
    for (const row of rows) {
      assert.equal((await removeDraftRow(db, successorActor, { companyId: "amg", assignmentId: row.id }, now)).status, "ok");
    }
    const removed = await publishAccessDraft(db, successorActor, "amg", "Remove the only administrator", now);
    assert.equal(removed.status, "invalid");
    if (removed.status === "invalid") assert.match(removed.reason, /last administrator/);
    assert.equal(hasPolicyAuthority(await loadTrustedActor(db, successor.id)), true);

    const history = await listAccessHistory(db, successorActor, "amg");
    assert.equal(history.status, "ok");
    if (history.status !== "ok") return;
    const published = history.versions.find((version) => version.status === "published");
    assert.ok(published);
    if (!published) return;
    assert.equal(published.createdBy, admin.user.id);
    const rollback = await rollbackAccessPolicy(db, successorActor, published.id, "Restore the published version", now);
    assert.equal(rollback.status, "ok");
    const after = await listAccessHistory(db, successorActor, "amg");
    assert.equal(after.status, "ok");
    if (after.status !== "ok") return;
    assert.equal(after.versions.filter((version) => version.status === "published").length, 1);
    assert.equal(after.versions.some((version) => version.status === "superseded"), true);
  });
});

test("publishing revokes the affected user's session and leaves the publisher signed in", async () => {
  await withDb(async (db) => {
    await tenant(db);
    const admin = await addMembershipUser(db, "revoke-admin@wolf-command.test", "amg", null, "administrator");
    const person = await addUser(db, "revoke-person@wolf-command.test");
    const bystander = await addMembershipUser(db, "revoke-bystander@wolf-command.test", "amg", "content", "staff");
    const personSession = await signIn(db, person.emailNormalized, now);
    const adminSession = await signIn(db, admin.user.emailNormalized, now);
    const bystanderSession = await signIn(db, bystander.user.emailNormalized, now);
    const role = await mustRole(db, admin.actor, "Content editors", ["membership.department.content.staff"]);
    const duplicate = await duplicateAccessRole(db, admin.actor, role, now);
    assert.equal(duplicate.status, "ok");
    await publishRole(db, admin.actor, "amg", person.emailNormalized, role, "content");
    assert.equal(await readSession(db, personSession.sessionToken, now), null);
    assert.ok(await readSession(db, adminSession.sessionToken, now));
    assert.ok(await readSession(db, bystanderSession.sessionToken, now));
    assert.equal((await deactivateAccessRole(db, admin.actor, role, now)).status, "ok");
    const actor = await loadTrustedActor(db, person.id);
    assert.equal(evaluateModuleAccess(actor!, "content", "read", { companyId: "amg" }).outcome, "allow");
    const allowed = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "authorization_allowed"));
    assert.equal(allowed.some((event) => event.resourceType === "access_policy"), true);
  });
});

async function tenant(db: AuthDatabase) {
  for (const companyId of ["amg", "bzg"]) {
    for (const departmentId of ["finance", "hr", "content", "procurement"]) await ensureTenant(db, companyId, departmentId);
  }
}

async function addUser(db: AuthDatabase, email: string) {
  const row = (await db.insert(users).values({ emailNormalized: email, status: "active", mustChangePassword: false }).returning())[0];
  if (!row) throw new Error("User was not stored.");
  return row;
}

async function addMembershipUser(
  db: AuthDatabase,
  email: string,
  companyId: string,
  departmentId: string | null,
  role: "staff" | "administrator" | "owner",
) {
  const user = await addUser(db, email);
  await db.insert(memberships).values({ userId: user.id, companyId, departmentId, role, status: "active" });
  const actor = await loadTrustedActor(db, user.id);
  if (!actor) throw new Error("Actor was not loaded.");
  return { user, actor };
}

async function mustRole(db: AuthDatabase, actor: Actor, name: string, capabilityIds: string[]) {
  const role = await createAccessRole(db, actor, { name, description: "", capabilityIds }, now);
  assert.equal(role.status, "ok");
  if (role.status !== "ok") throw new Error(role.status === "invalid" ? role.reason : "denied");
  return role.roleId;
}

async function publishRole(db: AuthDatabase, actor: Actor, companyId: string, email: string, roleId: string, departmentId: string) {
  const draft = await openAccessDraft(db, actor, companyId, `Draft ${roleId}`, now);
  assert.equal(draft.status, "ok");
  const saved = await saveAccessAssignment(db, actor, { companyId, email, roleId, departmentId }, now);
  assert.equal(saved.status, "ok");
  if (saved.status !== "ok") throw new Error(saved.status === "invalid" ? saved.reason : "denied");
  const published = await publishAccessDraft(db, actor, companyId, `Publish ${roleId}`, now);
  assert.equal(published.status, "ok");
  if (published.status !== "ok") throw new Error(published.status === "invalid" ? published.reason : "denied");
}

function isAction(value: string): value is "read" | "create" | "update" | "delete" | "approve" {
  return value === "read" || value === "create" || value === "update" || value === "delete" || value === "approve";
}

function hasPolicyAuthority(actor: Actor | null) {
  return !!actor && actor.memberships.some((membership) => membership.companyId === "amg" && (membership.role === "administrator" || membership.role === "owner"));
}
