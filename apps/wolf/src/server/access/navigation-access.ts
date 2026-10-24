import type { Actor } from "@wolf/shared";
import { financeWorkspace } from "../finance/companies";
import { hrAccess } from "../hr/companies";
import { evaluateModuleAccess } from "./matrix";
import { canManageAccessPolicies } from "./policy-model";

const companyModules = [
  ["/", "overview"],
  ["/finance", "finance"],
  ["/hr", "hr"],
  ["/organization", "organization"],
  ["/assistant", "organization"],
  ["/academy", "academy"],
  ["/content-machine", "content"],
  ["/owner-private", "owner_private"],
] as const;

export function grantedHrefs(actor: Actor | null): string[] {
  if (!actor) return ["/"];
  const companyIds = [...new Set(actor.memberships.map((membership) => membership.companyId))];
  const hrefs: string[] = companyModules
    .filter(([, module]) => companyIds.some((companyId) => evaluateModuleAccess(actor, module, "read", { companyId }).outcome === "allow"))
    .map(([href]) => href);
  if (!hrefs.includes("/finance") && companyIds.some((companyId) => financeWorkspace(actor, companyId) === "procurement")) {
    hrefs.push("/finance");
  }
  if (!hrefs.includes("/hr") && companyIds.some((companyId) => hrAccess(actor, companyId) === "employee")) {
    hrefs.push("/hr");
  }
  if (canManageAccessPolicies(actor)) hrefs.push("/access");
  hrefs.push("/settings");
  return hrefs;
}
