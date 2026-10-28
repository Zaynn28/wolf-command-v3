import { asc, eq } from "drizzle-orm";
import {
  companies,
  companyOperatingResponsibilities,
  companyOperatingRoles,
  companyOperatingUnits,
  financeSettings,
} from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { visibleOperatorCompanyId } from "../companies/operator-list";
import { ensureOperatingGrants, operatingGrantAppLabel, readOperatingGrantMap, type StoredOperatingGrant } from "./operating-grants";
import { capabilityById, roleScope } from "./policy-model";

export type OperatingProfile = "hotel" | "neutral";

type CatalogUnit = {
  code: string;
  name: string;
  summary: string;
  sort: number;
  profiles: readonly OperatingProfile[];
};

type CatalogRole = {
  code: string;
  unitCode: string;
  name: string;
  summary: string;
  profiles: readonly OperatingProfile[];
};

type CatalogResponsibility = {
  code: string;
  roleCode: string;
  label: string;
  detail: string;
  capabilityId: string;
  hotelOnly: boolean;
  sort: number;
  profiles: readonly OperatingProfile[];
};

const both = ["hotel", "neutral"] as const;
const hotel = ["hotel"] as const;

/**
 * Starter units. Hotel follows finance_settings.workspace_kind = 'amg'.
 * Every other configured company gets the neutral set. Operations is an
 * empty place for later work. It grants nothing in this starter.
 */
export const operatingUnits: readonly CatalogUnit[] = [
  {
    code: "people",
    name: "People",
    summary: "HRIS work for this company: people, profiles, gaji pokok, payroll, and payroll structure.",
    sort: 10,
    profiles: both,
  },
  {
    code: "rooms",
    name: "Rooms",
    summary: "Hotel rooms work that uses the finance book. This is not an outlet.",
    sort: 20,
    profiles: hotel,
  },
  {
    code: "finance",
    name: "Finance",
    summary: "The company book. Opening it and approving records are separate checks. Posting a journal is not a responsibility, because posting is not an enforced action.",
    sort: 30,
    profiles: both,
  },
  {
    code: "procurement",
    name: "Procurement",
    summary: "Procurement inside Finance. The finance book stays closed.",
    sort: 40,
    profiles: both,
  },
  {
    code: "operations",
    name: "Operations",
    summary: "A named place for work that is not people, finance, or procurement. This starter does not grant an action here.",
    sort: 50,
    profiles: both,
  },
];

/** Operating role names. They are not Wolf roles staff, administrator, or owner. */
export const operatingRoles: readonly CatalogRole[] = [
  {
    code: "people-operations",
    unitCode: "people",
    name: "People operations",
    summary: "HR workspace actions. They share one HR member check, so this catalog does not split them.",
    profiles: both,
  },
  {
    code: "rooms",
    unitCode: "rooms",
    name: "Rooms",
    summary: "Rooms duty on a hotel book. It uses the finance member check. It is not a new Wolf role.",
    profiles: hotel,
  },
  {
    code: "bookkeeper",
    unitCode: "finance",
    name: "Bookkeeper",
    summary: "Opens the finance book. It does not open HR.",
    profiles: both,
  },
  {
    code: "finance-approver",
    unitCode: "finance",
    name: "Finance approver",
    summary: "Approve is a grant. It does nothing without a finance membership. Posting is not included.",
    profiles: both,
  },
  {
    code: "procurement",
    unitCode: "procurement",
    name: "Procurement",
    summary: "Procurement only. The finance application stays locked.",
    profiles: both,
  },
];

const hrMember = "membership.department.hr.staff";
const financeMember = "membership.department.finance.staff";

export const operatingResponsibilities: readonly CatalogResponsibility[] = [
  {
    code: "hr.people.read",
    roleCode: "people-operations",
    label: "View people",
    detail: "HR member read opens the people list. A finance membership does not.",
    capabilityId: hrMember,
    hotelOnly: false,
    sort: 10,
    profiles: both,
  },
  {
    code: "hr.profile.update",
    roleCode: "people-operations",
    label: "Edit profile",
    detail: "Direct profile edit requires the HR workspace.",
    capabilityId: hrMember,
    hotelOnly: false,
    sort: 20,
    profiles: both,
  },
  {
    code: "hr.gaji-pokok.read",
    roleCode: "people-operations",
    label: "View gaji pokok",
    detail: "Gaji pokok is shown only in the HR workspace.",
    capabilityId: hrMember,
    hotelOnly: false,
    sort: 30,
    profiles: both,
  },
  {
    code: "hr.payroll.run",
    roleCode: "people-operations",
    label: "Run payroll",
    detail: "Payroll routes require the HR workspace. There is no separate payroll grant.",
    capabilityId: hrMember,
    hotelOnly: false,
    sort: 40,
    profiles: both,
  },
  {
    code: "hr.payroll.configure",
    roleCode: "people-operations",
    label: "Configure payroll structure",
    detail: "Payroll structure uses that same HR workspace. A Wolf role is not an HR role.",
    capabilityId: hrMember,
    hotelOnly: false,
    sort: 50,
    profiles: both,
  },
  {
    code: "rooms.book.open",
    roleCode: "rooms",
    label: "Rooms in the finance book",
    detail: "Rooms uses the hotel finance book. It does not add an outlet or a Wolf role.",
    capabilityId: financeMember,
    hotelOnly: true,
    sort: 10,
    profiles: hotel,
  },
  {
    code: "finance.book.open",
    roleCode: "bookkeeper",
    label: "Open the book",
    detail: "Finance member opens the book. It does not open HR.",
    capabilityId: financeMember,
    hotelOnly: false,
    sort: 10,
    profiles: both,
  },
  {
    code: "finance.usali.read",
    roleCode: "bookkeeper",
    label: "USALI schedules",
    detail: "USALI follows the hotel finance book. It is not its own grant.",
    capabilityId: financeMember,
    hotelOnly: true,
    sort: 20,
    profiles: hotel,
  },
  {
    code: "finance.owner-pool.read",
    roleCode: "bookkeeper",
    label: "Owner pool",
    detail: "Owner pool follows the hotel finance book. It is not Owner Private.",
    capabilityId: financeMember,
    hotelOnly: true,
    sort: 30,
    profiles: hotel,
  },
  {
    code: "finance.approve",
    roleCode: "finance-approver",
    label: "Approve finance records",
    detail: "Finance approval is a grant. It does not open the book, and it does not post.",
    capabilityId: "grant.approve.department.finance",
    hotelOnly: false,
    sort: 10,
    profiles: both,
  },
  {
    code: "finance.procurement.only",
    roleCode: "procurement",
    label: "Procurement only",
    detail: "Procurement member. The finance application stays locked.",
    capabilityId: "membership.department.procurement.staff",
    hotelOnly: false,
    sort: 10,
    profiles: both,
  },
];

export const hotelOnlyFinanceResponsibilityCodes = ["finance.usali.read", "finance.owner-pool.read", "rooms.book.open"] as const;

const privateCapabilities = new Set(["grant.owner_private", "grant.approve.owner_private"]);
const wolfRoleNames = new Set(["staff", "administrator", "owner"]);

export function operatingProfile(workspaceKind: string | null | undefined): OperatingProfile | null {
  if (workspaceKind === "amg") return "hotel";
  if (workspaceKind === "shared") return "neutral";
  return null;
}

export function operatingCatalogErrors(): string[] {
  const errors: string[] = [];
  const profiles: OperatingProfile[] = ["hotel", "neutral"];
  for (const unit of operatingUnits) {
    if (unit.name.trim().length < 1 || unit.name.length > 80 || unit.summary.length < 1 || unit.summary.length > 400) {
      errors.push(`${unit.code} name or summary is the wrong length.`);
    }
  }
  for (const role of operatingRoles) {
    if (wolfRoleNames.has(role.name.trim().toLowerCase())) errors.push(`${role.code} uses a Wolf role name.`);
    if (role.name.trim().length < 1 || role.name.length > 80 || role.summary.length < 1 || role.summary.length > 400) {
      errors.push(`${role.code} name or summary is the wrong length.`);
    }
  }
  for (const item of operatingResponsibilities) {
    const capability = capabilityById(item.capabilityId);
    if (!capability || capability.availability !== "assignable") errors.push(`${item.code} is not an enforced capability.`);
    if (privateCapabilities.has(item.capabilityId)) errors.push(`${item.code} points at Owner Private.`);
    if (item.code === "finance.post" || item.code === "finance.journal.post") errors.push(`${item.code} treats posting as a grant.`);
    if (item.hotelOnly && item.profiles.some((profile) => profile !== "hotel")) {
      errors.push(`${item.code} is hotel-only and is also on the neutral profile.`);
    }
    if ((hotelOnlyFinanceResponsibilityCodes as readonly string[]).includes(item.code) && !item.hotelOnly) {
      errors.push(`${item.code} must stay hotel-only.`);
    }
    if (item.label.trim().length < 1 || item.label.length > 80 || item.detail.length < 1 || item.detail.length > 400) {
      errors.push(`${item.code} label or detail is the wrong length.`);
    }
  }
  for (const profile of profiles) {
    const unitCodes = new Set(operatingUnits.filter((unit) => unit.profiles.includes(profile)).map((unit) => unit.code));
    for (const role of operatingRoles.filter((role) => role.profiles.includes(profile))) {
      if (!unitCodes.has(role.unitCode)) errors.push(`${role.code} is missing its unit on ${profile}.`);
      const capabilityIds = [
        ...new Set(
          operatingResponsibilities
            .filter((item) => item.roleCode === role.code && item.profiles.includes(profile))
            .map((item) => item.capabilityId),
        ),
      ];
      if (capabilityIds.length === 0) continue;
      const scope = roleScope(capabilityIds);
      if (!scope.ok) errors.push(`${role.code} on ${profile}: ${scope.reason}`);
    }
    if (profile === "neutral" && unitCodes.has("rooms")) errors.push("The neutral profile includes rooms.");
    const neutralHotelDuty = operatingResponsibilities.find(
      (item) => item.profiles.includes("neutral") && (hotelOnlyFinanceResponsibilityCodes as readonly string[]).includes(item.code),
    );
    if (neutralHotelDuty) errors.push(`${neutralHotelDuty.code} is on the neutral profile.`);
  }
  return errors;
}

export type OperatingSeedResult =
  | { status: "skipped"; reason: "hidden" | "missing" | "unconfigured" }
  | { status: "ready"; profile: OperatingProfile; inserted: number };

export async function ensureCompanyOperatingSystem(db: AuthDatabase, companyId: string): Promise<OperatingSeedResult> {
  const errors = operatingCatalogErrors();
  if (errors.length > 0) throw new Error(errors[0]);
  if (!visibleOperatorCompanyId(companyId)) return { status: "skipped", reason: "hidden" };
  const company = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company[0]) return { status: "skipped", reason: "missing" };
  const settings = await db
    .select({ workspaceKind: financeSettings.workspaceKind })
    .from(financeSettings)
    .where(eq(financeSettings.companyId, companyId))
    .limit(1);
  const profile = operatingProfile(settings[0]?.workspaceKind);
  if (!profile) return { status: "skipped", reason: "unconfigured" };

  const units = operatingUnits
    .filter((unit) => unit.profiles.includes(profile))
    .map((unit) => ({
      companyId,
      unitCode: unit.code,
      name: unit.name,
      summary: unit.summary,
      profile,
      sortOrder: unit.sort,
      status: "active" as const,
    }));
  const roles = operatingRoles
    .filter((role) => role.profiles.includes(profile))
    .map((role) => ({
      companyId,
      roleCode: role.code,
      unitCode: role.unitCode,
      name: role.name,
      summary: role.summary,
      profile,
      status: "active" as const,
    }));
  const responsibilities = operatingResponsibilities
    .filter((item) => item.profiles.includes(profile))
    .map((item) => ({
      companyId,
      roleCode: item.roleCode,
      responsibilityCode: item.code,
      label: item.label,
      detail: item.detail,
      capabilityId: item.capabilityId,
      hotelOnly: item.hotelOnly,
      profile,
      sortOrder: item.sort,
    }));

  const insertedUnits = await db.insert(companyOperatingUnits).values(units).onConflictDoNothing().returning({ unitCode: companyOperatingUnits.unitCode });
  const insertedRoles = await db.insert(companyOperatingRoles).values(roles).onConflictDoNothing().returning({ roleCode: companyOperatingRoles.roleCode });
  const insertedResponsibilities = await db
    .insert(companyOperatingResponsibilities)
    .values(responsibilities)
    .onConflictDoNothing()
    .returning({ responsibilityCode: companyOperatingResponsibilities.responsibilityCode });
  const insertedGrants = await ensureOperatingGrants(db, companyId, profile);
  return {
    status: "ready",
    profile,
    inserted: insertedUnits.length + insertedRoles.length + insertedResponsibilities.length + insertedGrants,
  };
}

export type OperatingSystemView = {
  profile: OperatingProfile;
  units: Array<{
    code: string;
    name: string;
    summary: string;
    roles: Array<{
      code: string;
      name: string;
      summary: string;
      responsibilities: Array<{
        code: string;
        label: string;
        detail: string;
        capabilityId: string;
        capabilityLabel: string;
        hotelOnly: boolean;
      }>;
      grants: Array<{
        code: string;
        app: StoredOperatingGrant["app"];
        appLabel: string;
        section: StoredOperatingGrant["section"];
        label: string;
        detail: string;
        hotelOnly: boolean;
        enabled: boolean;
      }>;
    }>;
  }>;
};

export async function readCompanyOperatingSystem(db: AuthDatabase, companyId: string): Promise<OperatingSystemView | null> {
  const seeded = await ensureCompanyOperatingSystem(db, companyId);
  if (seeded.status !== "ready") return null;
  const units = await db
    .select()
    .from(companyOperatingUnits)
    .where(eq(companyOperatingUnits.companyId, companyId))
    .orderBy(asc(companyOperatingUnits.sortOrder), asc(companyOperatingUnits.unitCode));
  const roles = await db
    .select()
    .from(companyOperatingRoles)
    .where(eq(companyOperatingRoles.companyId, companyId))
    .orderBy(asc(companyOperatingRoles.name));
  const responsibilities = await db
    .select()
    .from(companyOperatingResponsibilities)
    .where(eq(companyOperatingResponsibilities.companyId, companyId))
    .orderBy(asc(companyOperatingResponsibilities.sortOrder), asc(companyOperatingResponsibilities.responsibilityCode));
  const grants = await readOperatingGrantMap(db, companyId, seeded.profile);
  return {
    profile: seeded.profile,
    units: units.map((unit) => ({
      code: unit.unitCode,
      name: unit.name,
      summary: unit.summary,
      roles: roles
        .filter((role) => role.unitCode === unit.unitCode)
        .map((role) => ({
          code: role.roleCode,
          name: role.name,
          summary: role.summary,
          responsibilities: responsibilities
            .filter((item) => item.roleCode === role.roleCode)
            .map((item) => ({
              code: item.responsibilityCode,
              label: item.label,
              detail: item.detail,
              capabilityId: item.capabilityId,
              capabilityLabel: capabilityById(item.capabilityId)?.label ?? item.capabilityId,
              hotelOnly: item.hotelOnly,
            })),
          grants: (grants.get(role.roleCode) ?? []).map((grant) => ({
            code: grant.code,
            app: grant.app,
            appLabel: operatingGrantAppLabel(grant.app),
            section: grant.section,
            label: grant.label,
            detail: grant.detail,
            hotelOnly: grant.hotelOnly,
            enabled: grant.enabled,
          })),
        })),
    })),
  };
}
