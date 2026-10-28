import { and, eq, inArray } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { writeAudit } from "../auth/audit";
import {
  companies,
  companyOperatingRoleAssignments,
  companyOperatingRoleGrants,
  companyOperatingRoles,
  financeSettings,
} from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { financeWorkspace, listFinanceCompanies, type FinanceCompanyCard, type FinanceWorkspace } from "../finance/companies";
import { hrAccess, hrCompanyIds, openHrCompany, type HrAccess, type HrCompanyDecision } from "../hr/companies";
import { evaluateModuleAccess } from "./matrix";
import { canManageAccessPolicies, hasPolicyAuthority } from "./policy-model";

export type OperatingProfile = "hotel" | "neutral";
export type OperatingGrantApp =
  | "portal"
  | "finance"
  | "procurement"
  | "rooms"
  | "hr"
  | "organization"
  | "academy"
  | "assistant"
  | "access";
export type OperatingGrantSection = "features" | "approvals";
export type OperatingGrantEffect = "unchanged" | "allow" | "deny";

export type OperatingGrant = {
  code: string;
  app: OperatingGrantApp;
  section: OperatingGrantSection;
  label: string;
  detail: string;
  hotelOnly: boolean;
  sort: number;
};

export const hotelOnlyGrantCodes = [
  "finance.usali",
  "finance.owner-pool",
  "finance.integrations",
  "finance.service-charge",
  "finance.night-audit",
  "finance.pms",
  "finance.guest-ledger",
  "rooms.interface",
] as const;

/** Actions the product does not enforce, so they are not switches. */
export const omittedOperatingApprovals = [
  {
    code: "finance.draft.approve",
    reason: "Draft journal approve, validate, post, and reverse are refused. There is no enforced draft-approval action.",
  },
  {
    code: "finance.journal.post",
    reason: "Posting a journal is not an enforced action.",
  },
  {
    code: "hr.overtime",
    reason: "Wolf does not expose an overtime route.",
  },
  {
    code: "hr.payroll.calculate",
    reason: "Payroll calculation stays off the grant list.",
  },
  {
    code: "hr.payroll-period.approve",
    reason: "Payroll period approval belongs to payroll calculation, which stays off the grant list.",
  },
  {
    code: "hr.payroll.post",
    reason: "Posting payroll to finance stays off the grant list.",
  },
  {
    code: "assistant.key",
    reason: "Opening the assistant does not reveal the provider key.",
  },
  {
    code: "owner_private",
    reason: "Owner Private is not an operating-role grant.",
  },
] as const;

const appLabels: Record<OperatingGrantApp, string> = {
  portal: "Portal",
  finance: "Finance",
  procurement: "Procurement",
  rooms: "Rooms",
  hr: "HR",
  organization: "Organization",
  academy: "Academy",
  assistant: "Assistant",
  access: "Access",
};

export function operatingGrantAppLabel(app: OperatingGrantApp): string {
  return appLabels[app];
}

function feature(
  code: string,
  app: OperatingGrantApp,
  label: string,
  detail: string,
  sort: number,
  hotelOnly = false,
): OperatingGrant {
  return { code, app, section: "features", label, detail, hotelOnly, sort };
}

function approval(
  code: string,
  app: OperatingGrantApp,
  label: string,
  detail: string,
  sort: number,
): OperatingGrant {
  return { code, app, section: "approvals", label, detail, hotelOnly: false, sort };
}

export const operatingGrants: readonly OperatingGrant[] = [
  feature("portal.organization", "portal", "Organization", "Open the organization board and tasks.", 10),
  feature("portal.academy", "portal", "Academy", "Open Academy.", 20),
  feature("portal.finance", "portal", "Finance", "Open the Finance section. Procurement can use this without the book.", 30),
  feature("portal.hr", "portal", "HR", "Open the HR section. A finance book grant does not include this.", 40),
  feature("portal.assistant", "portal", "Assistant", "Open the assistant. This does not reveal the provider key.", 50),
  feature("portal.access", "portal", "Access", "Open Administration → Access. An administrator keeps this without this switch.", 60),
  feature("finance.book", "finance", "Open the book", "Open the company finance book. Approval does not include this.", 10),
  feature("finance.command-centre", "finance", "Command centre", "The finance command centre inside the book.", 20),
  feature("finance.revenue-cycle", "finance", "Revenue cycle", "Revenue documents inside the book.", 30),
  feature("finance.spending-cycle", "finance", "Spending cycle", "Spending documents inside the book.", 40),
  feature("finance.inventory", "finance", "Inventory and storerooms", "Inventory, storerooms, and the related book screens.", 50),
  feature("finance.petty-cash", "finance", "Petty cash", "Petty cash inside the book.", 60),
  feature("finance.journals", "finance", "Journal workbench", "Draft journals. Posting is not a grant.", 70),
  feature("finance.chart", "finance", "Chart of accounts", "The company chart of accounts.", 80),
  feature("finance.reports", "finance", "Reports", "Finance reports other than the hotel USALI pack.", 90),
  feature("finance.tax", "finance", "Tax view", "The tax view inside the book. Rates stay in company data.", 100),
  feature("finance.controls", "finance", "Controls and audit", "Controls and exception review inside the book.", 110),
  feature("finance.configuration", "finance", "Configuration", "Finance mapping and department configuration.", 120),
  approval("finance.approve", "finance", "Approve finance records", "The existing finance approval grant. It does not open the book or HR.", 10),
  feature("finance.procurement", "procurement", "Procurement only", "Procurement inside Finance. The book stays closed.", 10),
  approval("procurement.approve", "procurement", "Approve procurement", "The existing procurement approval grant. It does not open the book.", 10),
  feature("rooms.interface", "rooms", "Rooms", "Hotel rooms work on the finance book. Not an outlet.", 10, true),
  feature("finance.usali", "finance", "USALI", "Hotel USALI schedules. Not Owner Private.", 200, true),
  feature("finance.owner-pool", "finance", "Owner pool", "Hotel owner pool inside Finance. Not Owner Private.", 210, true),
  feature("finance.integrations", "finance", "Integrations", "Hotel finance integrations.", 220, true),
  feature("finance.service-charge", "finance", "Service charge", "Hotel service charge.", 230, true),
  feature("finance.night-audit", "finance", "Night audit", "Hotel night audit.", 240, true),
  feature("finance.pms", "finance", "PMS", "Hotel PMS audit. This is not a PMS connection.", 250, true),
  feature("finance.guest-ledger", "finance", "Guest ledger", "Hotel guest ledger.", 260, true),
  feature("hr.people", "hr", "People list", "The HR people list.", 10),
  feature("hr.profile.edit", "hr", "Edit profile", "Edit an HR profile.", 20),
  feature("hr.gaji-pokok", "hr", "Gaji pokok", "Show gaji pokok in the HR workspace.", 30),
  feature("hr.change-requests", "hr", "Change requests", "Staff profile change requests.", 40),
  feature("hr.attendance", "hr", "Attendance", "Attendance records.", 50),
  feature("hr.leave", "hr", "Leave", "Leave requests.", 60),
  feature("hr.payroll.records", "hr", "Payroll records", "Read payroll records. Calculation and posting stay off.", 70),
  feature("hr.payroll.configure", "hr", "Payroll structure", "Payroll structure configuration.", 80),
  feature("hr.bulk-upload", "hr", "Bulk upload", "HR imports.", 90),
  approval("hr.change-request.approve", "hr", "Approve a staff change request", "Approve a profile change request.", 10),
  approval("hr.change-request.reject", "hr", "Reject a staff change request", "Reject a profile change request.", 20),
  approval("hr.leave.approve", "hr", "Approve leave", "Approve a leave request.", 30),
  feature("organization.board", "organization", "View the board", "Open the organization board.", 10),
  feature("organization.task.create", "organization", "Create a task", "Create an organization task.", 20),
  feature("organization.task.assign", "organization", "Assign a task", "Assign or reassign a task.", 30),
  feature("organization.task.status", "organization", "Change task status", "Start, resume, submit, or complete a task.", 40),
  approval("organization.task.accept", "organization", "Accept a task", "Accept an assigned task.", 10),
  approval("organization.task.block", "organization", "Block a task", "Block a task that is in progress.", 20),
  approval("organization.task.approve", "organization", "Approve a task", "Accept a task that is in review. This uses the company approval check when no role is assigned.", 30),
  approval("organization.task.return", "organization", "Return a task", "Return a task that is in review.", 40),
  feature("academy.directory", "academy", "Open the directory", "Open the academy directory.", 10),
  feature("assistant.open", "assistant", "Open the assistant", "Open the assistant for records this account can already read.", 10),
  feature("access.structure.view", "access", "View the operating structure", "See units, roles, and grants. Administrators keep this path.", 10),
  feature("access.grants.edit", "access", "Edit grants", "Change these switches. Off for every starter role until an operator turns it on.", 20),
];

const grantByCode = new Map(operatingGrants.map((grant) => [grant.code, grant]));

const bookGrants = [
  "portal.finance",
  "finance.book",
  "finance.command-centre",
  "finance.revenue-cycle",
  "finance.spending-cycle",
  "finance.inventory",
  "finance.petty-cash",
  "finance.journals",
  "finance.chart",
  "finance.reports",
  "finance.tax",
  "finance.controls",
  "finance.configuration",
] as const;

const hotelBookGrants = [
  ...bookGrants,
  "finance.usali",
  "finance.owner-pool",
  "finance.integrations",
  "finance.service-charge",
  "finance.night-audit",
  "finance.pms",
  "finance.guest-ledger",
] as const;

const hrFeatureGrants = [
  "portal.hr",
  "hr.people",
  "hr.profile.edit",
  "hr.gaji-pokok",
  "hr.change-requests",
  "hr.attendance",
  "hr.leave",
  "hr.payroll.records",
  "hr.payroll.configure",
  "hr.bulk-upload",
] as const;

export function operatingGrantDefaults(roleCode: string): ReadonlySet<string> {
  if (roleCode === "people-operations") return new Set(hrFeatureGrants);
  if (roleCode === "bookkeeper") return new Set(hotelBookGrants);
  if (roleCode === "rooms") return new Set([...hotelBookGrants, "rooms.interface"]);
  if (roleCode === "finance-approver") return new Set(["finance.approve"]);
  if (roleCode === "procurement") return new Set(["portal.finance", "finance.procurement"]);
  return new Set();
}

export function grantsForProfile(profile: OperatingProfile): OperatingGrant[] {
  return operatingGrants.filter((grant) => profile === "hotel" || !grant.hotelOnly);
}

export function grantEnabledByDefault(roleCode: string, grant: OperatingGrant): boolean {
  if (!operatingGrantDefaults(roleCode).has(grant.code)) return false;
  return true;
}

export function operatingGrantCatalogErrors(): string[] {
  const errors: string[] = [];
  const codes = new Set<string>();
  const omitted = new Set<string>(omittedOperatingApprovals.map((item) => item.code));
  for (const grant of operatingGrants) {
    if (codes.has(grant.code)) errors.push(`${grant.code} is duplicated.`);
    codes.add(grant.code);
    if (omitted.has(grant.code)) errors.push(`${grant.code} is omitted and also listed.`);
    if (grant.code.includes("owner_private") || grant.code === "assistant.key") errors.push(`${grant.code} is not allowed.`);
    if (grant.code === "finance.post" || grant.code === "finance.journal.post" || grant.code === "finance.draft.approve") {
      errors.push(`${grant.code} is not an enforced action.`);
    }
    if (grant.hotelOnly !== (hotelOnlyGrantCodes as readonly string[]).includes(grant.code)) {
      errors.push(`${grant.code} hotel flag does not match the hotel list.`);
    }
    if (grant.label.trim().length < 1 || grant.label.length > 80 || grant.detail.length < 1 || grant.detail.length > 400) {
      errors.push(`${grant.code} label or detail is the wrong length.`);
    }
  }
  for (const code of hotelOnlyGrantCodes) {
    if (!codes.has(code)) errors.push(`${code} is missing from the catalog.`);
  }
  const neutral = new Set(grantsForProfile("neutral").map((grant) => grant.code));
  for (const code of hotelOnlyGrantCodes) {
    if (neutral.has(code)) errors.push(`${code} is offered on the neutral profile.`);
  }
  if (operatingGrantDefaults("finance-approver").has("finance.book")) errors.push("Finance approver defaults the book on.");
  if (operatingGrantDefaults("finance-approver").has("portal.hr")) errors.push("Finance approver defaults HR on.");
  if ([...operatingGrantDefaults("bookkeeper")].some((code) => code.startsWith("hr."))) errors.push("Bookkeeper defaults an HR grant.");
  for (const roleCode of ["people-operations", "bookkeeper", "rooms", "finance-approver", "procurement"]) {
    if (operatingGrantDefaults(roleCode).has("access.grants.edit")) errors.push(`${roleCode} can edit grants by default.`);
    if (operatingGrantDefaults(roleCode).has("access.structure.view")) errors.push(`${roleCode} can view Access by default.`);
  }
  if (!operatingGrantDefaults("finance-approver").has("finance.approve")) errors.push("Finance approver is missing the approval grant.");
  if (operatingGrantDefaults("people-operations").has("hr.change-request.approve")) errors.push("People operations defaults change-request approval.");
  return errors;
}

export type OperatingGrantRow = {
  companyId: string;
  roleCode: string;
  code: string;
  enabled: boolean;
};

export type OperatingAssignment = {
  companyId: string;
  roleCode: string;
};

export type OperatingEnforcement = {
  assignments: OperatingAssignment[];
  grants: OperatingGrantRow[];
};

export function operatingGrantEffect(
  assignments: readonly OperatingAssignment[],
  grants: readonly OperatingGrantRow[],
  companyId: string,
  code: string,
): OperatingGrantEffect {
  const roles = assignments.filter((assignment) => assignment.companyId === companyId).map((assignment) => assignment.roleCode);
  if (roles.length === 0) return "unchanged";
  const enabled = grants.some(
    (grant) => grant.companyId === companyId && roles.includes(grant.roleCode) && grant.code === code && grant.enabled,
  );
  return enabled ? "allow" : "deny";
}

export async function readOperatingEnforcement(db: AuthDatabase, userId: string): Promise<OperatingEnforcement> {
  const assignments = await db
    .select({
      companyId: companyOperatingRoleAssignments.companyId,
      roleCode: companyOperatingRoleAssignments.roleCode,
    })
    .from(companyOperatingRoleAssignments)
    .where(eq(companyOperatingRoleAssignments.userId, userId));
  if (assignments.length === 0) return { assignments: [], grants: [] };
  const companyIds = [...new Set(assignments.map((assignment) => assignment.companyId))];
  const stored = await db
    .select({
      companyId: companyOperatingRoleGrants.companyId,
      roleCode: companyOperatingRoleGrants.roleCode,
      code: companyOperatingRoleGrants.grantCode,
      enabled: companyOperatingRoleGrants.enabled,
    })
    .from(companyOperatingRoleGrants)
    .where(inArray(companyOperatingRoleGrants.companyId, companyIds));
  return { assignments, grants: stored };
}

export async function readOperatingGrantEffect(
  db: AuthDatabase,
  userId: string,
  companyId: string,
  code: string,
): Promise<OperatingGrantEffect> {
  const enforcement = await readOperatingEnforcement(db, userId);
  return operatingGrantEffect(enforcement.assignments, enforcement.grants, companyId, code);
}

export async function ensureOperatingGrants(db: AuthDatabase, companyId: string, profile: OperatingProfile): Promise<number> {
  const roles = await db
    .select({ roleCode: companyOperatingRoles.roleCode })
    .from(companyOperatingRoles)
    .where(eq(companyOperatingRoles.companyId, companyId));
  const grants = grantsForProfile(profile);
  const rows = roles.flatMap((role) =>
    grants.map((grant) => ({
      companyId,
      roleCode: role.roleCode,
      grantCode: grant.code,
      enabled: grantEnabledByDefault(role.roleCode, grant),
      profile,
      hotelOnly: grant.hotelOnly,
    })),
  );
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(companyOperatingRoleGrants)
    .values(rows)
    .onConflictDoNothing()
    .returning({ grantCode: companyOperatingRoleGrants.grantCode });
  return inserted.length;
}

export type StoredOperatingGrant = OperatingGrant & { enabled: boolean };

export async function readOperatingGrantMap(
  db: AuthDatabase,
  companyId: string,
  profile: OperatingProfile,
): Promise<Map<string, StoredOperatingGrant[]>> {
  const stored = await db
    .select()
    .from(companyOperatingRoleGrants)
    .where(eq(companyOperatingRoleGrants.companyId, companyId));
  const byRole = new Map<string, StoredOperatingGrant[]>();
  const offered = grantsForProfile(profile);
  const roles = [...new Set(stored.map((row) => row.roleCode))];
  for (const roleCode of roles) {
    const enabled = new Map(
      stored.filter((row) => row.roleCode === roleCode).map((row) => [row.grantCode, row.enabled]),
    );
    byRole.set(
      roleCode,
      offered.map((grant) => ({ ...grant, enabled: enabled.get(grant.code) ?? grantEnabledByDefault(roleCode, grant) })),
    );
  }
  return byRole;
}

export async function saveOperatingRoleGrants(
  db: AuthDatabase,
  actor: Actor,
  input: { companyId: string; roleCode: string; offered: string[]; enabled: string[] },
  now: Date,
): Promise<{ status: "ok" } | { status: "denied" } | { status: "invalid"; reason: string }> {
  const companyId = input.companyId.trim();
  const roleCode = input.roleCode.trim();
  const enforcement = await readOperatingEnforcement(db, actor.userId);
  if (!mayEditOperatingGrants(actor, companyId, enforcement)) return { status: "denied" };
  const settings = await db
    .select({ workspaceKind: financeSettings.workspaceKind })
    .from(financeSettings)
    .where(eq(financeSettings.companyId, companyId))
    .limit(1);
  const profile: OperatingProfile | null = settings[0]?.workspaceKind === "amg" ? "hotel" : settings[0]?.workspaceKind === "shared" ? "neutral" : null;
  if (!profile) return { status: "invalid", reason: "That company has no operating profile." };
  const role = await db
    .select({ roleCode: companyOperatingRoles.roleCode })
    .from(companyOperatingRoles)
    .where(and(eq(companyOperatingRoles.companyId, companyId), eq(companyOperatingRoles.roleCode, roleCode)))
    .limit(1);
  if (!role[0]) return { status: "invalid", reason: "That operating role is not on this company." };
  const catalog = grantsForProfile(profile);
  const allowed = new Set(catalog.map((grant) => grant.code));
  const offered = [...new Set(input.offered.map((code) => code.trim()).filter(Boolean))];
  const enabled = new Set(input.enabled.map((code) => code.trim()).filter(Boolean));
  if (offered.length !== catalog.length || offered.some((code) => !allowed.has(code))) {
    return { status: "invalid", reason: "The grant list does not match this company." };
  }
  for (const code of enabled) {
    if (!allowed.has(code)) return { status: "invalid", reason: "That grant is not available for this company." };
  }
  for (const code of hotelOnlyGrantCodes) {
    if ((enabled.has(code) || offered.includes(code)) && profile !== "hotel") {
      return { status: "invalid", reason: "Hotel finance grants are not available for this company." };
    }
  }
  for (const grant of catalog) {
    await db
      .insert(companyOperatingRoleGrants)
      .values({
        companyId,
        roleCode,
        grantCode: grant.code,
        enabled: enabled.has(grant.code),
        profile,
        hotelOnly: grant.hotelOnly,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [companyOperatingRoleGrants.companyId, companyOperatingRoleGrants.roleCode, companyOperatingRoleGrants.grantCode],
        set: { enabled: enabled.has(grant.code), updatedAt: now },
      });
  }
  await writeAudit(db, {
    eventType: "authorization_allowed",
    userId: actor.userId,
    companyId,
    resourceType: "access_policy",
    resourceId: companyId,
    emailFingerprint: null,
    ip: null,
    metadata: { module: "access", action: "operating_grants_saved", role: roleCode, enabled: enabled.size },
    createdAt: now,
  });
  return { status: "ok" };
}

export function mayEditOperatingGrants(actor: Actor, companyId: string, enforcement: OperatingEnforcement): boolean {
  if (hasPolicyAuthority(actor, companyId)) return true;
  return operatingGrantEffect(enforcement.assignments, enforcement.grants, companyId, "access.grants.edit") === "allow";
}

const portalGrants: Record<string, string> = {
  "/organization": "portal.organization",
  "/academy": "portal.academy",
  "/finance": "portal.finance",
  "/hr": "portal.hr",
  "/assistant": "portal.assistant",
  "/access": "portal.access",
};

function membershipOpensHref(actor: Actor, href: string, companyId: string): boolean {
  if (href === "/finance") return financeWorkspace(actor, companyId) !== null;
  if (href === "/hr") return hrAccess(actor, companyId) !== null;
  if (href === "/organization" || href === "/assistant") {
    return evaluateModuleAccess(actor, "organization", "read", { companyId }).outcome === "allow";
  }
  if (href === "/academy") return evaluateModuleAccess(actor, "academy", "read", { companyId }).outcome === "allow";
  if (href === "/access") return hasPolicyAuthority(actor, companyId);
  return false;
}

export function applyPortalGrants(hrefs: readonly string[], actor: Actor, enforcement: OperatingEnforcement): string[] {
  if (enforcement.assignments.length === 0) return [...hrefs];
  const companyIds = [...new Set([...actor.memberships.map((membership) => membership.companyId), ...enforcement.assignments.map((assignment) => assignment.companyId)])];
  return hrefs.filter((href) => {
    const code = portalGrants[href];
    if (!code) return true;
    if (href === "/access" && canManageAccessPolicies(actor)) return true;
    return companyIds.some((companyId) => {
      const effect = operatingGrantEffect(enforcement.assignments, enforcement.grants, companyId, code);
      if (effect === "allow") return true;
      if (effect === "deny") return false;
      return membershipOpensHref(actor, href, companyId);
    });
  });
}

export function financeWorkspaceWithGrants(actor: Actor, companyId: string, enforcement: OperatingEnforcement): FinanceWorkspace | null {
  const book = operatingGrantEffect(enforcement.assignments, enforcement.grants, companyId, "finance.book");
  const procurement = operatingGrantEffect(enforcement.assignments, enforcement.grants, companyId, "finance.procurement");
  if (book === "unchanged" && procurement === "unchanged") return financeWorkspace(actor, companyId);
  if (book === "allow") return "application";
  if (procurement === "allow") return "procurement";
  return null;
}

export function hrAccessWithGrants(actor: Actor, companyId: string, enforcement: OperatingEnforcement): HrAccess | null {
  const portal = operatingGrantEffect(enforcement.assignments, enforcement.grants, companyId, "portal.hr");
  if (portal === "unchanged") return hrAccess(actor, companyId);
  if (portal === "deny") return null;
  const base = hrAccess(actor, companyId);
  if (base === "administrator" || base === "staff") return base;
  return "staff";
}

export async function grantedFinanceAccess(
  db: AuthDatabase,
  actor: Actor,
): Promise<{ cards: FinanceCompanyCard[]; workspace: (companyId: string) => FinanceWorkspace | null }> {
  const enforcement = await readOperatingEnforcement(db, actor.userId);
  const cards = await listFinanceCompanies(db, actor);
  if (enforcement.assignments.length === 0) {
    return { cards, workspace: (companyId) => financeWorkspace(actor, companyId) };
  }
  const workspace = (companyId: string) => financeWorkspaceWithGrants(actor, companyId, enforcement);
  const ids = new Set(cards.map((card) => card.companyId));
  for (const assignment of enforcement.assignments) {
    if (workspace(assignment.companyId)) ids.add(assignment.companyId);
    else ids.delete(assignment.companyId);
  }
  const kept = cards.filter((card) => ids.has(card.companyId));
  const missing = [...ids].filter((id) => !kept.some((card) => card.companyId === id));
  if (missing.length === 0) return { cards: kept, workspace };
  const companyRows = await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, missing));
  const settings = await db.select().from(financeSettings).where(inArray(financeSettings.companyId, missing));
  const settingByCompany = new Map(settings.map((row) => [row.companyId, row]));
  const extra = companyRows.map((company) => {
    const setting = settingByCompany.get(company.id);
    const workspaceKind = setting?.workspaceKind === "amg" || setting?.workspaceKind === "shared" ? setting.workspaceKind : "unconfigured";
    return {
      companyId: company.id,
      name: company.name,
      currencyCode: setting?.currencyCode ?? null,
      minorScale: setting?.minorScale ?? null,
      workspaceKind,
    };
  });
  return {
    cards: [...kept, ...extra].sort((left, right) => left.companyId.localeCompare(right.companyId)),
    workspace,
  };
}

export async function grantedHrAccess(
  db: AuthDatabase,
  actor: Actor,
): Promise<{ ids: string[]; access: (companyId: string) => HrAccess | null }> {
  const enforcement = await readOperatingEnforcement(db, actor.userId);
  if (enforcement.assignments.length === 0) {
    return { ids: hrCompanyIds(actor), access: (companyId) => hrAccess(actor, companyId) };
  }
  const ids = await filterCompaniesByOperatingGrant(db, actor, hrCompanyIds(actor), "portal.hr");
  return { ids, access: (companyId) => hrAccessWithGrants(actor, companyId, enforcement) };
}

export async function openGrantedHrCompany(db: AuthDatabase, actor: Actor, companyId: string): Promise<HrCompanyDecision> {
  const enforcement = await readOperatingEnforcement(db, actor.userId);
  if (enforcement.assignments.length === 0) return openHrCompany(actor, companyId);
  const access = hrAccessWithGrants(actor, companyId, enforcement);
  if (!access || (companyId !== "amg" && companyId !== "bzg" && companyId !== "ggv")) return { status: "denied" };
  return {
    status: "unlinked",
    companyId,
    orgId: companyId === "amg" ? "AMG" : companyId === "bzg" ? "BZG" : "GGV",
    access,
  };
}

export async function filterCompaniesByOperatingGrant(
  db: AuthDatabase,
  actor: Actor,
  companyIds: readonly string[],
  code: string,
): Promise<string[]> {
  const enforcement = await readOperatingEnforcement(db, actor.userId);
  if (enforcement.assignments.length === 0) return [...companyIds];
  const result = new Set(companyIds);
  const involved = new Set([...companyIds, ...enforcement.assignments.map((assignment) => assignment.companyId)]);
  for (const companyId of involved) {
    const effect = operatingGrantEffect(enforcement.assignments, enforcement.grants, companyId, code);
    if (effect === "deny") result.delete(companyId);
    if (effect === "allow") result.add(companyId);
  }
  return [...result].sort();
}

export function financeFeatureGrant(path: string): string | null {
  const value = path.split("?")[0] ?? path;
  if (value.startsWith("/api/reports/usali")) return "finance.usali";
  if (value.includes("pms")) return "finance.pms";
  if (value.includes("night-audit") || value.includes("night_audit")) return "finance.night-audit";
  if (value.includes("guest-ledger") || value.includes("guest_ledger")) return "finance.guest-ledger";
  if (value.startsWith("/api/reports")) return "finance.reports";
  if (value.startsWith("/api/owner-pool")) return "finance.owner-pool";
  if (value.startsWith("/api/service-charge")) return "finance.service-charge";
  if (value.startsWith("/api/integrations") || value.startsWith("/api/sheets")) return "finance.integrations";
  if (value.startsWith("/api/journals")) return "finance.journals";
  if (value.startsWith("/api/accounts")) return "finance.chart";
  if (value.startsWith("/api/revenue")) return "finance.revenue-cycle";
  if (value.startsWith("/api/spending")) return "finance.spending-cycle";
  if (value.startsWith("/api/inventory") || value.startsWith("/api/ar/") || value.startsWith("/api/ap/")) return "finance.inventory";
  if (value.startsWith("/api/petty-cash")) return "finance.petty-cash";
  if (value.startsWith("/api/tax")) return "finance.tax";
  if (value.startsWith("/api/controls")) return "finance.controls";
  if (value.startsWith("/api/mapping") || value === "/api/departments") return "finance.configuration";
  if (value.startsWith("/api/dashboard")) return "finance.command-centre";
  return null;
}

const financeHideLabels: Record<string, string> = {
  "finance.command-centre": "Command Centre",
  "finance.revenue-cycle": "Revenue Cycle",
  "finance.spending-cycle": "Spending Cycle",
  "finance.inventory": "Storerooms",
  "finance.petty-cash": "Petty Cash",
  "finance.journals": "Journal",
  "finance.chart": "Chart of Accounts",
  "finance.reports": "Reports",
  "finance.tax": "Tax",
  "finance.controls": "Controls",
  "finance.configuration": "Configuration",
  "finance.usali": "USALI",
  "finance.owner-pool": "Owner Pool",
  "finance.integrations": "Integrations",
  "finance.service-charge": "Service Charge",
  "finance.night-audit": "Night Audit",
  "finance.pms": "PMS",
  "finance.guest-ledger": "Guest Ledger",
  "rooms.interface": "Transient Rooms",
};

export function deniedFinanceHideLabels(enforcement: OperatingEnforcement, companyId: string): string[] {
  if (!enforcement.assignments.some((assignment) => assignment.companyId === companyId)) return [];
  const labels: string[] = [];
  for (const [code, label] of Object.entries(financeHideLabels)) {
    if (operatingGrantEffect(enforcement.assignments, enforcement.grants, companyId, code) === "deny") labels.push(label);
  }
  return labels;
}

export function financeGrantHideScript(labels: readonly string[]): string {
  if (labels.length === 0) return "";
  const encoded = JSON.stringify(labels);
  return `<script>(function(){var labels=${encoded};function text(node){return (node.innerText||node.textContent||"").replace(/\\s+/g," ").trim()}function hide(node){if(node)node.style.display="none"}function pass(){var buttons=document.querySelectorAll("button,a");for(var i=0;i<buttons.length;i++){var label=text(buttons[i]);if(!label||label.length>90)continue;for(var j=0;j<labels.length;j++)if(label.indexOf(labels[j])!==-1)hide(buttons[i])}}function start(){pass();new MutationObserver(pass).observe(document.documentElement,{childList:true,subtree:true})}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start()})();</script>`;
}

export function hrOperatingGrant(path: string, method: string): string | null {
  if (/\/profile-change-requests\/[^/]+\/approve$/.test(path)) return "hr.change-request.approve";
  if (/\/profile-change-requests\/[^/]+\/reject$/.test(path)) return "hr.change-request.reject";
  if (path.startsWith("/api/profile-change-requests")) return "hr.change-requests";
  if (/\/leave-requests\/[^/]+\/approve$/.test(path)) return "hr.leave.approve";
  if (path.startsWith("/api/leave-requests")) return "hr.leave";
  if (path.startsWith("/api/attendance")) return "hr.attendance";
  if (path.startsWith("/api/payroll-records")) return "hr.payroll.records";
  if (path.startsWith("/api/payroll-structure")) return "hr.payroll.configure";
  if (path.startsWith("/api/imports")) return "hr.bulk-upload";
  if (path.startsWith("/api/employees")) return method === "GET" || method === "HEAD" ? "hr.people" : "hr.profile.edit";
  return null;
}

export function hrRequestEffect(enforcement: OperatingEnforcement, companyId: string, path: string, method: string): OperatingGrantEffect {
  if (!enforcement.assignments.some((assignment) => assignment.companyId === companyId)) return "unchanged";
  if (path.startsWith("/api/payroll-periods")) return "deny";
  const code = hrOperatingGrant(path, method);
  if (!code) return "allow";
  return operatingGrantEffect(enforcement.assignments, enforcement.grants, companyId, code);
}

export function organizationTaskGrant(action: string): string | null {
  if (action === "accept") return "organization.task.accept";
  if (action === "block") return "organization.task.block";
  if (action === "approve") return "organization.task.approve";
  if (action === "return") return "organization.task.return";
  if (action === "start" || action === "resume" || action === "submit" || action === "complete") return "organization.task.status";
  return null;
}

export function grantById(code: string): OperatingGrant | null {
  return grantByCode.get(code) ?? null;
}
