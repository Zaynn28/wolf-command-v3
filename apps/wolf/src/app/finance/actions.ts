"use server";

import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { originsMatch } from "@/server/auth/http";
import { loadActorContext } from "@/server/access/session-actor";
import { addFinanceAccount, addFinancePeriod, saveDraftJournal, type DraftLineInput } from "@/server/finance/drafts";

function linesFrom(formData: FormData): DraftLineInput[] {
  const lines: DraftLineInput[] = [];
  for (let index = 0; index < 8; index += 1) {
    const accountCode = String(formData.get(`line${index}Account`) ?? "").trim();
    const amount = String(formData.get(`line${index}Amount`) ?? "").trim();
    const side = String(formData.get(`line${index}Side`) ?? "");
    if (!accountCode && !amount) continue;
    lines.push({ accountCode, amount, side: side === "credit" ? "credit" : "debit" });
  }
  return lines;
}

async function sameOrigin(): Promise<boolean> {
  const headerList = await headers();
  return originsMatch(headerList.get("origin"), headerList.get("host"));
}

export async function saveDraftAction(formData: FormData): Promise<void> {
  const companyId = String(formData.get("companyId") ?? "");
  const back = `/finance/${encodeURIComponent(companyId)}/accounting-core`;
  if (!(await sameOrigin())) redirect(`${back}?notice=rejected`);
  const context = await loadActorContext();
  if (context.status !== "ready") redirect("/login");
  const result = await saveDraftJournal(
    context.db,
    context.actor,
    {
      companyId,
      journalId: String(formData.get("journalId") ?? "") || null,
      periodKey: String(formData.get("periodKey") ?? ""),
      memo: String(formData.get("memo") ?? ""),
      lines: linesFrom(formData),
    },
    new Date(),
  );
  if (result.status === "denied") redirect(`${back}?notice=denied`);
  if (result.status === "invalid") redirect(`${back}?notice=invalid`);
  redirect(`${back}?notice=${result.balanced ? "balanced" : "unbalanced"}`);
}

export async function addAccountAction(formData: FormData): Promise<void> {
  const companyId = String(formData.get("companyId") ?? "");
  const back = `/finance/${encodeURIComponent(companyId)}/accounting-core`;
  if (!(await sameOrigin())) redirect(`${back}?notice=rejected`);
  const context = await loadActorContext();
  if (context.status !== "ready") redirect("/login");
  const result = await addFinanceAccount(
    context.db,
    context.actor,
    { companyId, accountCode: String(formData.get("accountCode") ?? ""), accountName: String(formData.get("accountName") ?? "") },
    new Date(),
  );
  redirect(`${back}?notice=${result.status === "created" ? "account" : "rejected"}`);
}

export async function addPeriodAction(formData: FormData): Promise<void> {
  const companyId = String(formData.get("companyId") ?? "");
  const back = `/finance/${encodeURIComponent(companyId)}/accounting-core`;
  if (!(await sameOrigin())) redirect(`${back}?notice=rejected`);
  const context = await loadActorContext();
  if (context.status !== "ready") redirect("/login");
  const result = await addFinancePeriod(
    context.db,
    context.actor,
    { companyId, periodKey: String(formData.get("periodKey") ?? "") },
    new Date(),
  );
  redirect(`${back}?notice=${result.status === "created" ? "period" : "rejected"}`);
}
