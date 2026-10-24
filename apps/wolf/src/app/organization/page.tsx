import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { loadActorContext } from "@/server/access/session-actor";
import { readOrganizationTree } from "@/server/organization/service";

export default function OrganizationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading the organization…</p>}>
      <OrganizationHome searchParams={searchParams} />
    </Suspense>
  );
}

async function OrganizationHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const companyId = first(params.companyId);
  const query = first(params.q) ?? "";
  const context = await loadActorContext();
  if (context.status === "signed_out") {
    return <Gate title="Sign in required" body="The family tree is available after a Wolf sign-in." href="/login" link="Go to sign in" />;
  }
  if (context.status === "password_change_required") {
    return <Gate title="Password change required" body="Change the Wolf password before opening Organization." href="/account/password" link="Change password" />;
  }
  if (context.status !== "ready") {
    return <Gate title="Organization unavailable" body="Organization fails closed until the signed-in account can be verified." />;
  }
  const result = await readOrganizationTree(context.db, context.actor, companyId, query);
  if (result.status !== 200 || !("tree" in result.body)) {
    return <Gate title="Company unavailable" body={"error" in result.body ? result.body.error : "That company is not available."} />;
  }
  const { companies, tree } = result.body;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Demo organization"
        title="Family tree"
        description="Synthetic people for the companies this account can open. Every card is labeled Demo. Wolf did not read HRIS employee or payroll records."
      />
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-wrap gap-2">
          <CompanyLink href={query ? `/organization?q=${encodeURIComponent(query)}` : "/organization"} active={!companyId} label="All authorized" />
          {companies.map((company) => (
            <CompanyLink
              key={company.id}
              href={`/organization?companyId=${company.id}${query ? `&q=${encodeURIComponent(query)}` : ""}`}
              active={companyId === company.id}
              label={company.name}
            />
          ))}
        </div>
        <form className="flex gap-2" action="/organization">
          {companyId ? <input type="hidden" name="companyId" value={companyId} /> : null}
          <input name="q" defaultValue={query} placeholder="Name, position, or department" className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm md:w-72" />
          <button className="rounded-md border border-line bg-raised px-3 py-2 text-sm font-medium" type="submit">Search</button>
        </form>
      </div>
      <div className="flex gap-3 text-sm">
        <Link href="/organization/tasks" className="underline decoration-line underline-offset-4">Owner task center</Link>
        <Link href="/organization/tasks#staff-progress" className="underline decoration-line underline-offset-4">Staff progress</Link>
      </div>
      {tree.companies.length === 0 ? <EmptyState title="No demo organization" body="No demo departments are recorded for the companies this account can open." /> : null}
      <div className="grid gap-4">
        {tree.companies.filter((company) => company.departments.some((department) => department.positions.length > 0)).map((company) => (
          <section key={company.id} className="rounded-lg border border-line bg-surface">
            <header className="border-b border-line px-4 py-3">
              <h2 className="text-lg font-semibold">{company.name}</h2>
              <p className="text-xs tracking-[0.14em] text-muted uppercase">{company.id}</p>
            </header>
            <div className="flex flex-col">
              {company.departments.map((department) => (
                <details key={department.id} open className="border-t border-line first:border-t-0">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{department.name}</summary>
                  <ul className="grid gap-3 px-4 pb-4 md:grid-cols-2">
                    {department.positions.map((position) => (
                      <li key={position.id} className="rounded-lg border border-line bg-background px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium tracking-wide text-muted uppercase">Demo</span>
                          {position.vacant ? <span className="text-[11px] font-medium text-accent uppercase">Vacant</span> : null}
                          {position.person && position.person.companies.length > 1 ? (
                            <span className="text-[11px] font-medium text-muted uppercase">Multiple companies</span>
                          ) : null}
                        </div>
                        <h3 className="mt-2 text-base font-semibold">
                          {position.person ? (
                            <Link href={`/organization/people/${position.person.id}`} className="underline decoration-line underline-offset-4">{position.person.displayName}</Link>
                          ) : (
                            "Vacant position"
                          )}
                        </h3>
                        <p className="mt-1 text-sm text-muted">{position.title}</p>
                        {position.person ? (
                          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <dt className="text-muted">Status</dt>
                              <dd className="capitalize">{position.person.employmentStatus}</dd>
                            </div>
                            <div>
                              <dt className="text-muted">Manager</dt>
                              <dd>{position.person.companies.find((item) => item.companyId === company.id)?.managerName ?? "None"}</dd>
                            </div>
                          </dl>
                        ) : (
                          <p className="mt-3 text-sm text-muted">No demo person is assigned.</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
      <section>
        <h2 className="text-lg font-semibold">Vacant positions</h2>
        {tree.vacant.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No vacant demo positions are in this view.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {tree.vacant.map((position) => (
              <li key={position.id} className="flex flex-col gap-1 px-4 py-3 md:flex-row md:items-center md:justify-between">
                <span className="font-medium">{position.title}</span>
                <span className="text-sm text-muted">{position.departmentName} · {position.companyId.toUpperCase()} · Demo</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CompanyLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={`rounded-md border px-3 py-2 text-sm ${active ? "border-foreground bg-surface" : "border-line text-muted"}`}>
      {label}
    </Link>
  );
}

function Gate({ title, body, href, link }: { title: string; body: string; href?: string; link?: string }) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Demo organization" title="Family tree" description={body} />
      <EmptyState title={title} body={body} />
      {href && link ? <Link href={href} className="text-sm underline decoration-line underline-offset-4">{link}</Link> : null}
    </div>
  );
}

function first(value: string | string[] | undefined): string | null {
  const item = Array.isArray(value) ? value[0] : value;
  return item && item.trim() !== "" ? item : null;
}
