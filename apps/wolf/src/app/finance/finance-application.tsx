import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { SessionMenu } from "@/components/session-menu";
import { loadActorContext } from "@/server/access/session-actor";
import { amgRuntimeOrigin } from "@/server/finance/amg-proxy";
import { financeWorkspace, listFinanceCompanies } from "@/server/finance/companies";
import { financeModuleIsEnabled } from "@/server/finance/modules";

export async function FinanceApplication({ companyId }: { companyId: string }) {
  const context = await loadActorContext();
  if (context.status !== "ready") {
    return (
      <div className="flex flex-col gap-6 p-6">
        <EmptyState title="Sign in required" body="No finance records are shown." />
        <Link href="/login" className="text-sm text-foreground underline">Go to sign in</Link>
      </div>
    );
  }
  const cards = await listFinanceCompanies(context.db, context.actor);
  const card = cards.find((item) => item.companyId === companyId);
  if (!card) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <EmptyState title="Access denied" body="That company is not available to this account. No records are shown." />
        <Link href="/finance" className="text-sm text-foreground underline">All finance companies</Link>
      </div>
    );
  }
  const procurementOnly = financeWorkspace(context.actor, companyId) === "procurement";
  if (procurementOnly && !(await financeModuleIsEnabled(context.db, companyId, "procurement"))) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <EmptyState title="Procurement is not enabled" body="Procurement is turned off for this company. No records are shown." />
        <Link href="/finance" className="text-sm text-foreground underline">All finance companies</Link>
      </div>
    );
  }
  if (!(await financeModuleIsEnabled(context.db, companyId, "atrium-workflows"))) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <EmptyState title="Finance is not enabled" body="The Finance application is turned off for this company. No records are shown." />
        <Link href="/finance" className="text-sm text-foreground underline">All finance companies</Link>
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
  const facts = companyId === "amg"
    ? [
        ["In Wolf", "Chart, departments, mapping, drafts, revenue and spending"],
        ["Not imported", "Posted seed journals, night audit"],
        ["Posting", "Off"],
        ["Other books", "Atrium"],
      ]
    : [
        ["In Wolf", "Chart, departments, mapping, drafts, revenue and spending"],
        ["Not copied", "AMG records"],
        ["Posting", "Off"],
        ["Other workflows", "Fail closed"],
      ];
  return (
    <div className="flex h-dvh flex-col bg-background">
      <header>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line bg-surface px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="h-8 w-0.5 shrink-0 rounded-sm bg-accent" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted">Finance</p>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                <p className="text-base font-semibold leading-6 text-foreground">{card.name}</p>
                <p className="text-sm text-muted">{procurementOnly ? "Procurement" : card.companyId}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link
              href="/finance"
              className="text-sm font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Switch company
            </Link>
            <SessionMenu layout="cluster" primarySignOut />
          </div>
        </div>
        {procurementOnly ? null : (
          <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-2 border-b border-line px-4 py-3 sm:px-6">
            {facts.map(([label, value]) => (
              <div key={label} className="flex items-baseline gap-2">
                <dt className="text-xs font-medium text-muted">{label}</dt>
                <dd className="text-sm text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </header>
      {runtimeReady ? (
        <iframe title={`${card.name} Finance`} src={`/finance/${companyId}/runtime/`} className="min-h-0 w-full flex-1 border-0 bg-background" />
      ) : (
        <EmptyState title="Finance application is not running" body="The AMG Finance screens are not shown. No records were changed." />
      )}
    </div>
  );
}
