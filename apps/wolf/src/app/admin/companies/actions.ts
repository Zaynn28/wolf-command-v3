"use server";

import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createCompany } from "@/server/admin/companies";
import { setFinanceModule } from "@/server/finance/modules";
import { loadActorContext } from "@/server/access/session-actor";
import { originsMatch } from "@/server/auth/http";

export async function createCompanyAction(formData: FormData): Promise<void> {
  const headerList = await headers();
  if (!originsMatch(headerList.get("origin"), headerList.get("host"))) redirect("/admin/companies?notice=rejected");
  const context = await loadActorContext();
  if (context.status !== "ready") redirect("/login");
  const scale = Number(String(formData.get("minorScale") ?? ""));
  const result = await createCompany(
    context.db,
    context.actor,
    {
      companyId: String(formData.get("companyId") ?? ""),
      name: String(formData.get("name") ?? ""),
      currencyCode: String(formData.get("currencyCode") ?? ""),
      minorScale: scale,
      memberEmail: String(formData.get("memberEmail") ?? ""),
      memberRole: String(formData.get("memberRole") ?? ""),
      companyWide: formData.get("companyWide") === "on",
      workspaceKind: String(formData.get("workspaceKind") ?? "shared"),
    },
    new Date(),
  );
  if (result.status === "created") redirect(`/admin/companies?notice=created&companyId=${encodeURIComponent(result.companyId)}`);
  redirect("/admin/companies?notice=rejected");
}

export async function setFinanceModuleAction(formData: FormData): Promise<void> {
  const headerList = await headers();
  if (!originsMatch(headerList.get("origin"), headerList.get("host"))) redirect("/admin/companies?notice=module-rejected");
  const context = await loadActorContext();
  if (context.status !== "ready") redirect("/login");
  const result = await setFinanceModule(
    context.db,
    context.actor,
    {
      companyId: String(formData.get("companyId") ?? ""),
      moduleId: String(formData.get("moduleId") ?? ""),
      enabled: String(formData.get("enabled") ?? ""),
    },
    new Date(),
  );
  redirect(result.status === "updated" ? "/admin/companies?notice=module-updated" : "/admin/companies?notice=module-rejected");
}
