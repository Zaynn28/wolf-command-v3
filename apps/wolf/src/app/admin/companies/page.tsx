import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { isPlatformOperator } from "@/server/admin/companies";
import { loadActorContext } from "@/server/access/session-actor";
import { financeModuleRegistry, listConfiguredCompanies, readFinanceModules } from "@/server/finance/modules";
import { createCompanyAction, setFinanceModuleAction } from "./actions";

export default function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Checking operator access…</p>}>
      <CompaniesScreen searchParams={searchParams} />
    </Suspense>
  );
}

async function CompaniesScreen({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const notice = first(params.notice);
  const context = await loadActorContext();
  if (context.status === "signed_out") {
    return (
      <Denied title="Sign in required" body="Company setup is not public." />
    );
  }
  if (context.status !== "ready") {
    return <Denied title="Company setup unavailable" body="The page fails closed until the signed-in operator can be verified." />;
  }
  const operator = await isPlatformOperator(context.db, context.actor.userId);
  if (!operator) {
    return <Denied title="Operator access required" body="A company membership does not create companies. No company was created." />;
  }
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Operator"
        title="Companies"
        description={`Signed in as ${context.email}. This creates one company, a finance department, and finance settings. It does not grant Owner Private access.`}
      />
      {notice === "created" ? <p className="text-sm">Company {first(params.companyId)} was created.</p> : null}
      {notice === "rejected" ? <p className="text-sm text-muted">The company was not created.</p> : null}
      {notice === "module-updated" ? <p className="text-sm">The finance module setting was saved.</p> : null}
      {notice === "module-rejected" ? <p className="text-sm text-muted">The finance module setting was not saved.</p> : null}
      <form action={createCompanyAction} className="flex max-w-xl flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-4">
        <input name="companyId" placeholder="company-id" className="rounded-md border border-line bg-background px-3 py-2 text-sm" />
        <input name="name" placeholder="Company name" className="rounded-md border border-line bg-background px-3 py-2 text-sm" />
        <input name="currencyCode" placeholder="Currency code" className="rounded-md border border-line bg-background px-3 py-2 text-sm" />
        <input name="minorScale" placeholder="Scale 0-4" className="rounded-md border border-line bg-background px-3 py-2 text-sm" />
        <input name="memberEmail" placeholder="Existing member email, optional" className="rounded-md border border-line bg-background px-3 py-2 text-sm" />
        <select name="workspaceKind" className="rounded-md border border-line bg-background px-3 py-2 text-sm" defaultValue="shared">
          <option value="shared">Shared draft ledger</option>
          <option value="amg">AMG operating system, company id amg only</option>
        </select>
        <select name="memberRole" className="rounded-md border border-line bg-background px-3 py-2 text-sm" defaultValue="">
          <option value="">No membership</option>
          <option value="staff">Staff in finance</option>
          <option value="administrator">Administrator in finance</option>
        </select>
        <label className="text-sm text-muted">
          <input type="checkbox" name="companyWide" className="mr-2" />
          Company-wide membership instead of the finance department
        </label>
        <button type="submit" className="rounded-md bg-foreground px-3 py-2 text-sm text-background">Create company</button>
      </form>
      <ModuleSettings db={context.db} />
    </div>
  );
}

async function ModuleSettings({ db }: { db: Parameters<typeof listConfiguredCompanies>[0] }) {
  const companies = await listConfiguredCompanies(db);
  const optional = financeModuleRegistry.filter((module) => !module.core);
  const configured = await Promise.all(companies.map(async (company) => ({ ...company, modules: await readFinanceModules(db, company.companyId) })));
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold">Finance modules</h2>
      <p className="text-sm text-muted">Optional modules are stored per company. Turning one on does not grant membership, approval, or records from another company.</p>
      <ul className="flex flex-col gap-2 text-sm">
        {configured.map((company) => (
          <li key={company.companyId}>
            {company.companyId}: {company.modules.filter((module) => !module.core && module.enabled).map((module) => module.label).join(", ") || "no optional modules"}
          </li>
        ))}
      </ul>
      <form action={setFinanceModuleAction} className="flex max-w-xl flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-4">
        <input name="companyId" placeholder="company-id" className="rounded-md border border-line bg-background px-3 py-2 text-sm" />
        <select name="moduleId" className="rounded-md border border-line bg-background px-3 py-2 text-sm">
          {optional.map((module) => (
            <option key={module.id} value={module.id}>{module.label}</option>
          ))}
        </select>
        <select name="enabled" className="rounded-md border border-line bg-background px-3 py-2 text-sm">
          <option value="Y">Enabled</option>
          <option value="N">Disabled</option>
        </select>
        <button type="submit" className="rounded-md bg-foreground px-3 py-2 text-sm text-background">Save module</button>
      </form>
    </div>
  );
}

function Denied({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Operator" title="Companies" description="Private company setup." />
      <EmptyState title={title} body={body} />
    </div>
  );
}

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim() ?? "";
  return trimmed || null;
}
