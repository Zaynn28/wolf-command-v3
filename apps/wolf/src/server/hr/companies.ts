import type { Actor } from "@wolf/shared";
import { departmentServesModule, evaluateModuleAccess } from "../access/matrix";
import { visibleOperatorCompanyId } from "../companies/operator-list";

const orgByCompany = {
  amg: "AMG",
  bzg: "BZG",
  ggv: "GGV",
} as const;

export type HrisOrgId = (typeof orgByCompany)[keyof typeof orgByCompany];

export type HrAccess = "administrator" | "staff" | "employee";

export type HrCompanyDecision =
  | { status: "denied" }
  | { status: "unlinked"; companyId: keyof typeof orgByCompany; orgId: HrisOrgId; access: HrAccess };

function hrisCompanyId(companyId: string): keyof typeof orgByCompany | null {
  return companyId === "amg" || companyId === "bzg" || companyId === "ggv" ? companyId : null;
}

export function hrCompanyIds(actor: Actor): string[] {
  const ids = new Set<string>();
  for (const membership of actor.memberships) {
    if (!visibleOperatorCompanyId(membership.companyId)) continue;
    if (hrAccess(actor, membership.companyId)) ids.add(membership.companyId);
  }
  return [...ids].sort();
}

/**
 * Membership is checked against the lowercase Wolf company before any HRIS
 * org id exists. This does not create an HRIS person and does not read HRIS.
 */
export function hrAccessLabel(actor: Actor, companyId: string): "staff" | "administrator" {
  const administrator = actor.memberships.some(
    (membership) =>
      membership.companyId === companyId &&
      (membership.role === "administrator" || membership.role === "owner") &&
      (membership.departmentId === null || departmentServesModule(membership.departmentId, "hr")),
  );
  return administrator ? "administrator" : "staff";
}

/**
 * HR department membership opens the HR staff workspace. Another department
 * at an HRIS company opens the employee screen only. A Wolf role is not an
 * HRIS role, and a finance membership does not open either screen.
 */
export function hrAccess(actor: Actor, companyId: string): HrAccess | null {
  const company = hrisCompanyId(companyId);
  if (!company) return null;
  if (evaluateModuleAccess(actor, "hr", "read", { companyId: company }).outcome === "allow") {
    return hrAccessLabel(actor, company);
  }
  const employee = actor.memberships.some(
    (membership) =>
      membership.companyId === company &&
      !!membership.departmentId &&
      !departmentServesModule(membership.departmentId, "hr") &&
      !departmentServesModule(membership.departmentId, "finance"),
  );
  return employee ? "employee" : null;
}

export function openHrCompany(actor: Actor, companyId: string): HrCompanyDecision {
  const company = hrisCompanyId(companyId);
  const access = company ? hrAccess(actor, company) : null;
  if (!company || !access) return { status: "denied" };
  return { status: "unlinked", companyId: company, orgId: orgByCompany[company], access };
}
