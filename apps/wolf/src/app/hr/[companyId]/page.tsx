import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { SessionMenu } from "@/components/session-menu";
import { loadActorContext } from "@/server/access/session-actor";
import { openHrCompany } from "@/server/hr/companies";
import { hrisRuntimeOrigin } from "@/server/hr/runtime-proxy";

export default function HrCompanyPage({ params }: { params: Promise<{ companyId: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Checking HR access…</p>}>
      <Company params={params} />
    </Suspense>
  );
}

async function Company({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const context = await loadActorContext();
  if (context.status !== "ready") {
    return (
      <div className="flex flex-col gap-8">
        <EmptyState title="Sign in required" body="No people records are shown." />
        <Link href="/login" className="text-sm text-foreground underline">Go to sign in</Link>
      </div>
    );
  }
  const opened = openHrCompany(context.actor, companyId);
  if (opened.status === "denied") {
    return (
      <div className="flex flex-col gap-8">
        <EmptyState title="Access denied" body="That company is not available to this account. No people records are shown." />
        <Link href="/hr" className="text-sm text-foreground underline">All HR companies</Link>
      </div>
    );
  }
  const origin = hrisRuntimeOrigin(process.env);
  let runtimeReady = false;
  if (origin) {
    try {
      runtimeReady = (await fetch(origin, { signal: AbortSignal.timeout(1500) })).ok;
    } catch {
      runtimeReady = false;
    }
  }
  return (
    <div className="flex h-dvh flex-col bg-background">
      <header>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line bg-surface px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="h-8 w-0.5 shrink-0 rounded-sm bg-accent" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted">HR</p>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                <p className="text-base font-semibold leading-6 text-foreground">{opened.orgId} HR</p>
                <p className="text-sm text-muted">{opened.companyId}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link href="/hr" className="text-sm font-medium text-foreground">Switch company</Link>
            <SessionMenu layout="cluster" primarySignOut />
          </div>
        </div>
        <p className="border-b border-line px-4 py-3 text-sm text-muted sm:px-6">
          The HRIS screen is shown for {opened.orgId}. Wolf access for this company is {opened.access}. Wolf did not copy employee records, and a Wolf role is not an HRIS role.
        </p>
      </header>
      {runtimeReady ? (
        <iframe title={`${opened.orgId} HR`} src={`/hr/${opened.companyId}/runtime/`} className="min-h-0 w-full flex-1 border-0 bg-background" />
      ) : (
        <EmptyState title="HR application is not running" body="The HRIS screen is not shown. No people records were changed." />
      )}
    </div>
  );
}
