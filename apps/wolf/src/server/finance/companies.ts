import { asc, inArray } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { evaluateModuleAccess } from "../access/matrix";
import { companies, financeSettings } from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { financeModuleIsEnabled } from "./modules";

export type FinanceCompanyCard = {
  companyId: string;
  name: string;
  currencyCode: string | null;
  minorScale: number | null;
  workspaceKind: "shared" | "amg" | "unconfigured";
};

export type FinanceWorkspace = "application" | "procurement";

export function financeWorkspace(actor: Actor, companyId: string): FinanceWorkspace | null {
  const finance = evaluateModuleAccess(actor, "finance", "read", { companyId, departmentId: null });
  if (finance.outcome === "allow") return "application";
  const procurement = evaluateModuleAccess(actor, "procurement", "read", { companyId, departmentId: null });
  return procurement.outcome === "allow" ? "procurement" : null;
}

export function financeSurfaceLabel(actor: Actor, companyId: string): string | null {
  return financeWorkspace(actor, companyId) === "procurement" ? "Procurement" : null;
}

export function financeCompanyIds(actor: Actor): string[] {
  const ids = new Set<string>();
  for (const membership of actor.memberships) {
    if (financeWorkspace(actor, membership.companyId)) ids.add(membership.companyId);
  }
  return [...ids].sort();
}

export async function listFinanceCompanies(db: AuthDatabase, actor: Actor): Promise<FinanceCompanyCard[]> {
  const ids = financeCompanyIds(actor);
  if (ids.length === 0) return [];
  const companyRows = await db.select().from(companies).where(inArray(companies.id, ids)).orderBy(asc(companies.id));
  const settings = await db.select().from(financeSettings).where(inArray(financeSettings.companyId, ids));
  const settingByCompany = new Map(settings.map((row) => [row.companyId, row]));
  const cards = companyRows.map((company) => {
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
  const visible: FinanceCompanyCard[] = [];
  for (const card of cards) {
    if (financeWorkspace(actor, card.companyId) !== "procurement") {
      visible.push(card);
      continue;
    }
    const procurement = await financeModuleIsEnabled(db, card.companyId, "procurement");
    const application = await financeModuleIsEnabled(db, card.companyId, "atrium-workflows");
    if (procurement && application) visible.push(card);
  }
  return visible;
}
