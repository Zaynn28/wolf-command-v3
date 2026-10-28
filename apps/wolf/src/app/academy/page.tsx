import Link from "next/link";
import { Suspense } from "react";
import { loadActorContext } from "@/server/access/session-actor";
import { readAcademyDirectory, type AcademyLearner, type AcademySection } from "@/server/academy/directory";
import { visibleOperatorCompanyId } from "@/server/companies/operator-list";

export default function AcademyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading academy…</p>}>
      <AcademyHome searchParams={searchParams} />
    </Suspense>
  );
}

async function AcademyHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const companyId = first(params.companyId);
  const query = first(params.q) ?? "";
  const context = await loadActorContext();
  if (context.status === "signed_out") {
    return <Gate title="Sign in required" body="Academy is available after a Wolf sign-in." href="/login" link="Go to sign in" />;
  }
  if (context.status === "password_change_required") {
    return <Gate title="Password change required" body="Change the Wolf password before opening Academy." href="/account/password" link="Change password" />;
  }
  if (context.status !== "ready") {
    return <Gate title="Academy unavailable" body="Academy fails closed until the signed-in account can be verified." />;
  }
  const result = await readAcademyDirectory(context.db, context.actor, companyId, query);
  if (result.status !== 200 || !("sections" in result.body)) {
    return <Gate title="Company unavailable" body={"error" in result.body ? result.body.error : "That company is not available."} />;
  }
  const companies = result.body.companies.filter((company) => visibleOperatorCompanyId(company.id));
  const sections = result.body.sections.filter((section) => visibleOperatorCompanyId(section.companyId));
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Academy</h1>
        <form className="flex gap-2" action="/academy">
          {companyId ? <input type="hidden" name="companyId" value={companyId} /> : null}
          <input name="q" defaultValue={query} placeholder="Name or employee code" aria-label="Search staff" className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm sm:w-64" />
          <button className="rounded-md border border-line bg-raised px-3 py-2 text-sm font-medium" type="submit">Search</button>
        </form>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <CompanyLink href={query ? `/academy?q=${encodeURIComponent(query)}` : "/academy"} active={!companyId} label="All" />
        {companies.map((company) => (
          <CompanyLink
            key={company.id}
            href={`/academy?companyId=${company.id}${query ? `&q=${encodeURIComponent(query)}` : ""}`}
            active={companyId === company.id}
            label={company.name}
          />
        ))}
      </div>
      {sections.length === 0 ? <p className="text-sm text-muted">No companies are available for this account.</p> : null}
      <div className="flex flex-col gap-6">
        {sections.map((section) => (
          <section key={section.companyId} className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">{section.companyName}</h2>
            <StaffList section={section} />
          </section>
        ))}
      </div>
    </div>
  );
}

function StaffList({ section }: { section: AcademySection }) {
  if (section.directory === "unavailable") {
    return <p className="text-sm text-muted">HR employees could not be read for this company.</p>;
  }
  if (section.recorded === 0) {
    return <p className="text-sm text-muted">No HR employees are recorded for this company.</p>;
  }
  if (section.learners.length === 0) {
    return <p className="text-sm text-muted">No matching staff.</p>;
  }
  return <PeopleTable rows={section.learners} />;
}

const peopleColumns = "sm:grid-cols-[minmax(0,1.4fr)_6.5rem_5.5rem_minmax(0,1fr)_minmax(0,1fr)]";

function PeopleTable({ rows }: { rows: AcademyLearner[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className={`hidden border-b border-line px-4 py-2 text-xs font-medium text-muted sm:grid ${peopleColumns} sm:gap-x-3`}>
        <span>Name</span>
        <span>Code</span>
        <span>Status</span>
        <span>Department</span>
        <span>Position</span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((row) => (
          <li key={row.id} className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-4 py-2.5 sm:items-baseline sm:gap-x-3 ${peopleColumns}`}>
            <span className="truncate text-sm font-medium">{row.displayName}</span>
            <span className="text-sm text-muted">{row.employeeCode}</span>
            <span className="text-sm text-muted">{statusLabel[row.employmentStatus]}</span>
            <span className="col-span-2 truncate text-sm text-muted sm:col-span-1">{row.departmentName ?? "—"}</span>
            <span className="col-span-2 truncate text-sm text-muted sm:col-span-1">{row.positionTitle ?? "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const statusLabel: Record<AcademyLearner["employmentStatus"], string> = {
  active: "Active",
  leave: "Leave",
  inactive: "Inactive",
};

function CompanyLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={`rounded-md border px-3 py-2 text-sm ${active ? "border-foreground bg-surface font-medium" : "border-line text-muted"}`}>
      {label}
    </Link>
  );
}

function Gate({ title, body, href, link }: { title: string; body: string; href?: string; link?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted">{body}</p>
      {href && link ? <Link href={href} className="text-sm hover:underline">{link}</Link> : null}
    </div>
  );
}

function first(value: string | string[] | undefined): string | null {
  const item = Array.isArray(value) ? value[0] : value;
  return item && item.trim() !== "" ? item : null;
}
