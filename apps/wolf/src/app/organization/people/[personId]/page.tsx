import Link from "next/link";
import { Suspense } from "react";
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
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted">Sign in is required.</p>
        <Link href="/login" className="text-sm hover:underline">Go to sign in</Link>
      </div>
    );
  }
  const result = await readOrganizationPerson(context.db, context.actor, personId);
  if (result.status !== 200 || !("person" in result.body)) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted">{"error" in result.body ? result.body.error : "This profile is not available."}</p>
        <Link href="/organization" className="text-sm text-muted hover:underline">Family tree</Link>
      </div>
    );
  }
  const { person, tasks } = result.body;
  const department = [...new Set(person.companies.map((placement) => (placement.departmentName === "No department" ? "—" : placement.departmentName)))].join(", ");
  const companyName = new Map(person.companies.map((placement) => [placement.companyId, placement.companyName]));
  const meta = [person.employeeCode, department].filter((item) => item && item.trim() !== "").join(" · ");
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{person.displayName}</h1>
        {meta ? <p className="mt-1 text-sm text-muted">{meta}</p> : null}
      </header>
      {tasks.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">Tasks</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {tasks.map((task) => (
              <li key={task.id} className="flex flex-col gap-0.5 px-4 py-2.5 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                <Link href={`/organization/tasks?companyId=${task.companyId}#task-${task.id}`} className="font-medium hover:underline">{task.title}</Link>
                <span className="text-muted">{companyName.get(task.companyId) ?? task.companyId.toUpperCase()} · {task.status}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Link href="/organization" className="text-sm text-muted hover:underline">Family tree</Link>
    </div>
  );
}
