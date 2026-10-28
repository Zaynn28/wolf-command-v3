import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { loadActorContext } from "@/server/access/session-actor";
import { grantedFinanceAccess } from "@/server/access/operating-grants";
import { financeModuleIsEnabled, isFinanceModuleId, type FinanceModuleId } from "@/server/finance/modules";
import { FinanceApplication } from "../../finance-application";

export default function FinanceModulePage({ params }: { params: Promise<{ companyId: string; moduleId: string }> }) {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted">Checking finance access…</p>}>
      <Module params={params} />
    </Suspense>
  );
}

async function Module({ params }: { params: Promise<{ companyId: string; moduleId: string }> }) {
  const { companyId, moduleId } = await params;
  const context = await loadActorContext();
  const finance = context.status === "ready" ? await grantedFinanceAccess(context.db, context.actor) : null;
  if (finance && finance.workspace(companyId) === "procurement") {
    return (
      <div className="flex flex-col gap-6 p-6">
        <EmptyState title="Access denied" body="This account opens its granted module from the company in Finance. No other finance feature is shown." />
        <Link href={`/finance/${companyId}`} className="text-sm text-foreground underline">Open the company</Link>
      </div>
    );
  }
  if (context.status !== "ready" || !isFinanceModuleId(moduleId)) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <EmptyState title="Access denied" body="That finance feature is not available. No records are shown." />
        <Link href="/finance" className="text-sm text-foreground underline">All finance companies</Link>
      </div>
    );
  }
  const cards = finance?.cards ?? [];
  if (!cards.some((card) => card.companyId === companyId) || !(await financeModuleIsEnabled(context.db, companyId, moduleId as FinanceModuleId))) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <EmptyState title="Access denied" body="That feature is not enabled for this company. No records are shown." />
        <Link href="/finance" className="text-sm text-foreground underline">All finance companies</Link>
      </div>
    );
  }
  return <FinanceApplication companyId={companyId} />;
}
