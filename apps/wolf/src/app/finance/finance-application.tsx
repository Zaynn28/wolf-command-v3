import Link from "next/link";
import { EmbeddedAppFrame } from "@/components/embedded-app-frame";
import { EmptyState } from "@/components/empty-state";
import { loadActorContext } from "@/server/access/session-actor";
import { amgRuntimeOrigin } from "@/server/finance/amg-proxy";
import { grantedFinanceAccess } from "@/server/access/operating-grants";
import { financeModuleIsEnabled } from "@/server/finance/modules";

function HomeLink() {
  return (
    <Link href="/" className="text-sm text-foreground underline">
      Menu
    </Link>
  );
}

export async function FinanceApplication({ companyId }: { companyId: string }) {
  const context = await loadActorContext();
  if (context.status !== "ready") {
    return (
      <div className="flex flex-col gap-6 p-6">
        <EmptyState title="Sign in required" body="No finance records are shown." />
        <HomeLink />
      </div>
    );
  }
  const finance = await grantedFinanceAccess(context.db, context.actor);
  const cards = finance.cards;
  const card = cards.find((item) => item.companyId === companyId);
  if (!card) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <EmptyState title="Access denied" body="That company is not available to this account. No records are shown." />
        <HomeLink />
      </div>
    );
  }
  const procurementOnly = finance.workspace(companyId) === "procurement";
  if (procurementOnly && !(await financeModuleIsEnabled(context.db, companyId, "procurement"))) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <EmptyState title="Procurement is not enabled" body="Procurement is turned off for this company. No records are shown." />
        <HomeLink />
      </div>
    );
  }
  if (!(await financeModuleIsEnabled(context.db, companyId, "atrium-workflows"))) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <EmptyState title="Finance is not enabled" body="The Finance application is turned off for this company. No records are shown." />
        <HomeLink />
      </div>
    );
  }

  const origin = amgRuntimeOrigin(process.env);
  let runtimeReady = false;
  if (origin) {
    try {
      runtimeReady = (await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1500) })).ok;
    } catch {
      runtimeReady = false;
    }
  }
  if (!runtimeReady) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <HomeLink />
        <EmptyState title="Finance application is not running" body="The AMG Finance screens are not shown. No records were changed." />
      </div>
    );
  }
  return <EmbeddedAppFrame title={`${card.name} Finance`} src={`/finance/${companyId}/runtime/`} />;
}
