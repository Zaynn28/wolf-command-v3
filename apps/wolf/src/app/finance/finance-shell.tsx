import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { loadActorContext } from "@/server/access/session-actor";
import { amgRuntimeOrigin } from "@/server/finance/amg-proxy";
import { listFinanceCompanies } from "@/server/finance/companies";
import { readFinanceWorkspace } from "@/server/finance/drafts";
import { isFinanceModuleId, moduleEnabled, readFinanceModules, type FinanceModuleId, type FinanceModuleState } from "@/server/finance/modules";
import { FinanceDesk } from "./finance-desk";

export async function FinanceModuleScreen({
  companyId,
  moduleId,
  notice,
}: {
  companyId: string;
  moduleId: string;
  notice: string | null;
}) {
  const context = await loadActorContext();
  if (context.status !== "ready") {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="Finance" title="Finance" description="Sign in is required before this company workspace can be opened." />
        <EmptyState title="Sign in required" body="No finance records are shown." />
        <Link href="/login" className="text-sm text-foreground underline">Go to sign in</Link>
      </div>
    );
  }
  if (!isFinanceModuleId(moduleId)) return denied("That finance module is not part of the shared application.");
  const cards = await listFinanceCompanies(context.db, context.actor);
  const card = cards.find((item) => item.companyId === companyId);
  if (!card) return denied("That company is not available to this account.");
  const modules = await readFinanceModules(context.db, companyId);
  const active = modules.find((module) => module.id === moduleId);
  if (!active?.enabled) return denied(`${active?.label ?? "That module"} is not enabled for ${card.name}.`);
  const administrator = context.actor.memberships.some(
    (membership) => membership.companyId === companyId && (membership.role === "administrator" || membership.role === "owner"),
  );
  const workspace = active.storage === "wolf" ? await readFinanceWorkspace(context.db, context.actor, companyId) : null;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          eyebrow="Finance"
          title={card.name}
          description={`${card.companyId}. One shared Finance application. Enabled modules come from the server configuration for this company.`}
        />
        <Link href="/finance" className="text-sm text-foreground underline">All finance companies</Link>
      </div>
      <nav aria-label="Finance modules" className="flex flex-wrap gap-2">
        {modules.filter((module) => module.enabled).map((module) => (
          <Link
            key={module.id}
            href={moduleHref(companyId, module.id)}
            aria-current={module.id === moduleId ? "page" : undefined}
            className={`rounded-md border px-3 py-2 text-sm ${module.id === moduleId ? "border-foreground bg-surface" : "border-line text-muted"}`}
          >
            {module.label}
          </Link>
        ))}
      </nav>
      {active.storage === "atrium-memory" ? (
        <AtriumModule companyId={companyId} module={active} modules={modules} />
      ) : workspace?.status === "ready" ? (
        <WolfModule companyId={companyId} moduleId={active.id} workspace={workspace} notice={notice} administrator={administrator} atrium={moduleEnabled(modules, "atrium-workflows") && companyId === "amg"} />
      ) : (
        <EmptyState title="Finance settings required" body="An operator must finish finance settings for this company before records can be saved. No records are invented." />
      )}
    </div>
  );
}

function moduleHref(companyId: string, moduleId: FinanceModuleId) {
  return moduleId === "dashboard" ? `/finance/${companyId}` : `/finance/${companyId}/${moduleId}`;
}

function denied(description: string) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Finance" title="Finance" description={description} />
      <EmptyState title="Access denied" body="No finance records are shown." />
      <Link href="/finance" className="text-sm text-foreground underline">All finance companies</Link>
    </div>
  );
}

function WolfModule({
  companyId,
  moduleId,
  workspace,
  notice,
  administrator,
  atrium,
}: {
  companyId: string;
  moduleId: FinanceModuleId;
  workspace: Extract<Awaited<ReturnType<typeof readFinanceWorkspace>>, { status: "ready" }>;
  notice: string | null;
  administrator: boolean;
  atrium: boolean;
}) {
  if (moduleId === "accounting-core") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-6 text-muted">
          Accounting Core stores draft journals in Wolf PostgreSQL for {companyId} only. Posting, reversal, and period close are not enabled.
          {atrium ? " The Atrium journal workbench is a separate process-memory workspace and is not these drafts." : ""}
        </p>
        <FinanceDesk
          companyId={companyId}
          currencyCode={workspace.currencyCode}
          minorScale={workspace.minorScale}
          accounts={workspace.accounts}
          periods={workspace.periods}
          journals={workspace.journals}
          notice={notice}
          administrator={administrator}
        />
      </div>
    );
  }
  if (moduleId === "reports") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm leading-6 text-muted">Posted statements, USALI reports, and exports are not enabled. This list is the Wolf drafts for this company only.</p>
        {workspace.journals.length === 0 ? (
          <EmptyState title="No drafts" body="There are no Wolf draft journals for this company." />
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {workspace.journals.map((journal) => (
              <li key={journal.id} className="rounded-md border border-line px-3 py-2">
                {journal.periodKey} · {journal.balanced ? "Balanced" : "Unbalanced"} · {journal.memo || "No memo"}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (moduleId === "settings") {
    return (
      <div className="rounded-lg border border-line bg-surface px-4 py-4 text-sm leading-6">
        <p>Currency {workspace.currencyCode}, scale {workspace.minorScale}.</p>
        <p className="text-muted">Module changes are operator-only and are stored in Wolf. They do not grant membership or approval.</p>
      </div>
    );
  }
  const balanced = workspace.journals.filter((journal) => journal.balanced).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Accounts" value={String(workspace.accounts.length)} />
        <Metric label="Periods" value={String(workspace.periods.length)} />
        <Metric label="Draft journals" value={`${workspace.journals.length} (${balanced} balanced)`} />
      </div>
      <p className="text-sm leading-6 text-muted">These counts are Wolf drafts for this company. They are not posted totals.</p>
      {atrium ? <AtriumFrame label="Atrium command centre" /> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

async function AtriumModule({
  companyId,
  module,
  modules,
}: {
  companyId: string;
  module: FinanceModuleState;
  modules: FinanceModuleState[];
}) {
  if (companyId !== "amg" || !moduleEnabled(modules, "atrium-workflows")) {
    return (
      <EmptyState
        title={`${module.label} is not available here`}
        body="This optional module has no persisted Wolf records for this company. Atrium process-memory workflows stay connected only for AMG, and only while Atrium workflows are enabled. No AMG records are shown."
      />
    );
  }
  return <AtriumFrame label={module.label} />;
}

async function AtriumFrame({ label }: { label: string }) {
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
    return <EmptyState title="Atrium workflows are not running" body="The AMG operating screens are not shown. Wolf draft records are unchanged." />;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-6 text-muted">
        {label} still runs in the Atrium process for AMG. Those books are process memory. They are not Wolf PostgreSQL records, they are not copied to other companies, and they disappear when that process stops. The Atrium navigation still contains its other pillars until each workflow is migrated.
      </p>
      <iframe title="AMG Finance" src="/finance/amg-runtime/" className="min-h-[80vh] w-full rounded-lg border border-line bg-background" />
    </div>
  );
}
