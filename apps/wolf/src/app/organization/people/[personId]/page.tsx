import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { loadActorContext } from "@/server/access/session-actor";
import { readOrganizationPerson } from "@/server/organization/service";

export default function PersonPage({ params }: { params: Promise<{ personId: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading the profile…</p>}>
      <PersonProfile params={params} />
    </Suspense>
  );
}

async function PersonProfile({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  const context = await loadActorContext();
  if (context.status !== "ready") {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="Demo organization" title="Profile" description="Sign in is required before a demo profile can be opened." />
        <EmptyState title="Sign in required" body="No profile is shown." />
        <Link href="/login" className="text-sm underline decoration-line underline-offset-4">Go to sign in</Link>
      </div>
    );
  }
  const result = await readOrganizationPerson(context.db, context.actor, personId);
  if (result.status !== 200 || !("person" in result.body)) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="Demo organization" title="Profile" description="This profile is not available for the signed-in account." />
        <EmptyState title="Profile unavailable" body={"error" in result.body ? result.body.error : "No profile is shown."} />
      </div>
    );
  }
  const { person, tasks } = result.body;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Demo profile" title={person.displayName} description={`${person.id}. This is a synthetic profile. It has no Wolf login and no payroll fields.`} />
      <div className="flex flex-wrap gap-2 text-[11px] font-medium tracking-wide uppercase">
        <span className="rounded-full border border-line px-2 py-0.5 text-muted">Demo</span>
        <span className="rounded-full border border-line px-2 py-0.5 capitalize text-muted">{person.employmentStatus}</span>
        {person.companies.length > 1 ? <span className="rounded-full border border-line px-2 py-0.5 text-muted">Multiple companies</span> : null}
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {person.companies.map((placement) => (
          <li key={`${placement.companyId}-${placement.positionId}`} className="rounded-lg border border-line bg-surface px-4 py-4">
            <p className="text-xs tracking-[0.14em] text-muted uppercase">{placement.companyName}</p>
            <h2 className="mt-2 text-lg font-semibold">{placement.positionTitle}</h2>
            <p className="mt-1 text-sm text-muted">{placement.departmentName}</p>
            <p className="mt-3 text-sm">Manager: {placement.managerName ?? "None"}</p>
          </li>
        ))}
      </ul>
      <section>
        <h2 className="text-lg font-semibold">Assigned demo tasks</h2>
        {tasks.length === 0 ? <p className="mt-3 text-sm text-muted">No demo tasks for this person are visible.</p> : (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span>{task.title} <span className="text-xs text-muted uppercase">Demo</span></span>
                <span className="text-sm text-muted">{task.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Link href="/organization" className="text-sm underline decoration-line underline-offset-4">Back to the family tree</Link>
    </div>
  );
}
