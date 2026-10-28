import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { EmbeddedAppFrame } from "@/components/embedded-app-frame";
import { EmptyState } from "@/components/empty-state";
import { loadActorContext } from "@/server/access/session-actor";
import { openGrantedHrCompany } from "@/server/access/operating-grants";
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
  if (context.status === "signed_out") redirect("/login");
  if (context.status !== "ready") {
    return (
      <div className="flex flex-col gap-8">
        <EmptyState title="Sign in required" body="No people records are shown." />
        <Link href="/" className="text-sm text-foreground underline">Menu</Link>
        <Link href="/login" className="text-sm text-foreground underline">Go to sign in</Link>
      </div>
    );
  }
  const opened = await openGrantedHrCompany(context.db, context.actor, companyId);
  if (opened.status === "denied") {
    return (
      <div className="flex flex-col gap-8">
        <EmptyState title="Access denied" body="That company is not available to this account. No people records are shown." />
        <Link href="/" className="text-sm text-foreground underline">Menu</Link>
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
  if (!runtimeReady) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <Link href="/" className="text-sm font-medium text-foreground underline">Menu</Link>
        <EmptyState title="HR application is not running" body="The HRIS screen is not shown. No people records were changed." />
      </div>
    );
  }
  return <EmbeddedAppFrame title={`${opened.orgId} HR`} src={`/hr/${opened.companyId}/runtime/`} />;
}
