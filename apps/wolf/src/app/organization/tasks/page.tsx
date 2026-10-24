import Link from "next/link";
import { Suspense } from "react";
import { authorize } from "@wolf/shared";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { loadActorContext } from "@/server/access/session-actor";
import { authorizedCompanyIds, listReadableCompanies, readOrganizationTree, readStaffProgress, readTaskOverview } from "@/server/organization/service";
import { evaluateModuleAccess } from "@/server/access/matrix";
import { CreateTaskForm } from "../create-task-form";
import { StaffProgressView } from "../staff-progress";
import { TaskControls } from "../task-controls";

export default function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading tasks…</p>}>
      <TaskCenter searchParams={searchParams} />
    </Suspense>
  );
}

async function TaskCenter({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const context = await loadActorContext();
  if (context.status !== "ready") {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="Demo tasks" title="Owner task center" description="Sign in is required before demo tasks can be shown." />
        <EmptyState title="Sign in required" body="No tasks are shown." />
        <Link href="/login" className="text-sm underline decoration-line underline-offset-4">Go to sign in</Link>
      </div>
    );
  }
  const requested = first(params.companyId);
  const from = first(params.from) ?? "2026-10-01";
  const to = first(params.to) ?? "2026-10-31";
  const today = new Date().toISOString().slice(0, 10);
  const companies = authorizedCompanyIds(context.actor);
  const ownerCompanies = companies.filter(
    (companyId) => authorize({ actor: context.actor, action: "read", resource: { kind: "owner_private", companyId } }).outcome === "allow",
  );
  const adminCompanies = companies.filter(
    (companyId) => evaluateModuleAccess(context.actor, "organization", "create", { companyId }).outcome === "allow",
  );
  const scope = requested && ownerCompanies.includes(requested) ? "owner" : ownerCompanies.length > 0 && !requested ? "owner" : adminCompanies.length > 0 ? "company" : "assigned";
  const [result, progress, companyChoices] = await Promise.all([
    readTaskOverview(context.db, context.actor, { companyId: requested, from, to, today, scope }),
    readStaffProgress(context.db, context.actor, { companyId: requested, today }),
    listReadableCompanies(context.db, context.actor),
  ]);
  if (result.status !== 200 || !("tasks" in result.body)) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="Demo tasks" title="Owner task center" description={"error" in result.body ? result.body.error : "Tasks are not available."} />
        <EmptyState title="Tasks unavailable" body="No tasks are shown." />
      </div>
    );
  }
  const overview = result.body;
  const tree = await readOrganizationTree(context.db, context.actor, requested, "");
  const people = tree.status === 200 && "tree" in tree.body
    ? tree.body.tree.companies.flatMap((company) =>
        company.departments.flatMap((department) =>
          department.positions.flatMap((position) =>
            position.person && adminCompanies.includes(company.id)
              ? [{ id: position.person.id, label: `${position.person.displayName} · ${company.name}`, companyId: company.id, departmentId: department.id }]
              : [],
          ),
        ),
      )
    : [];
  const counts = [
    ["Active", overview.active],
    ["Overdue", overview.overdue],
    ["Blocked", overview.blocked],
    ["In review", overview.inReview],
    ["Completed in period", overview.completedInPeriod],
  ] as const;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Demo tasks"
        title={overview.scope === "owner" ? "Owner task center" : overview.scope === "company" ? "Company tasks" : "Assigned tasks"}
        description="Counts come from the demo tasks this account is allowed to see. An administrator role is not an Owner Private grant."
      />
      <Link href="#staff-progress" className="text-sm underline decoration-line underline-offset-4">Staff progress</Link>
      <form className="flex flex-col gap-3 md:flex-row" action="/organization/tasks">
        <label className="text-sm text-muted">
          Company
          <select name="companyId" defaultValue={requested ?? ""} className="mt-1 block rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground">
            <option value="">Authorized companies</option>
            {companyChoices.map((company) => (
              <option key={company.id} value={company.id}>{company.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-muted">
          From
          <input type="date" name="from" defaultValue={from} className="mt-1 block rounded-md border border-line bg-surface px-3 py-2 text-sm" />
        </label>
        <label className="text-sm text-muted">
          To
          <input type="date" name="to" defaultValue={to} className="mt-1 block rounded-md border border-line bg-surface px-3 py-2 text-sm" />
        </label>
        <button className="self-end rounded-md border border-line bg-raised px-3 py-2 text-sm font-medium" type="submit">Apply</button>
      </form>
      {adminCompanies.length > 0 ? <CreateTaskForm people={people} /> : null}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {counts.map(([label, value]) => (
          <li key={label} className="rounded-lg border border-line bg-surface px-4 py-3">
            <p className="text-xs tracking-[0.14em] text-muted uppercase">{label}</p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </li>
        ))}
      </ul>
      <section className="grid gap-4 lg:grid-cols-2">
        <CountList title="By company" rows={overview.byCompany.map((row) => ({ id: row.companyId, label: row.companyId.toUpperCase(), ...row }))} />
        <CountList title="By department" rows={overview.byDepartment.map((row) => ({ id: `${row.companyId}-${row.departmentId}`, label: row.departmentId, ...row }))} />
      </section>
      {progress.status === 200 && "people" in progress.body ? (
        <StaffProgressView progress={progress.body} />
      ) : (
        <section id="staff-progress" className="rounded-lg border border-line bg-surface px-4 py-4">
          <h2 className="text-lg font-semibold">Staff progress</h2>
          <p className="mt-2 text-sm text-muted">{"error" in progress.body ? progress.body.error : "Staff progress is not available."}</p>
        </section>
      )}
      {overview.tasks.length === 0 ? <EmptyState title="No demo tasks" body="No demo tasks are visible for this account and period." /> : null}
      <div className="grid gap-4">
        {overview.tasks.map((task) => (
          <article key={task.id} id={`task-${task.id}`} className="rounded-lg border border-line bg-surface px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium tracking-wide text-muted uppercase">Demo</span>
              <span className="text-[11px] font-medium text-muted uppercase">{task.status}</span>
              <span className="text-[11px] text-muted uppercase">{task.priority}</span>
              {task.dueOn < today && task.status !== "COMPLETED" ? <span className="text-[11px] font-medium text-accent uppercase">Overdue</span> : null}
            </div>
            <h2 className="mt-2 text-lg font-semibold">{task.title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{task.description}</p>
            <dl className="mt-3 grid gap-2 text-sm md:grid-cols-3">
              <div><dt className="text-muted">Due</dt><dd>{task.dueOn}</dd></div>
              <div><dt className="text-muted">Assignee</dt><dd>{task.assigneeName ?? "Team"}</dd></div>
              <div><dt className="text-muted">Completion</dt><dd>{task.completionCriteria}</dd></div>
            </dl>
            <ol className="mt-4 space-y-2 border-t border-line pt-3 text-sm">
              {task.events.map((event) => (
                <li key={event.id}>
                  <span className="font-medium">{event.previousStatus ?? "New"} → {event.nextStatus}</span>
                  <span className="text-muted"> · {event.actorSource === "demo-seed" ? "Demo seed" : event.actorUserId} · {event.createdAt.slice(0, 10)}</span>
                  {event.reason ? <span className="block text-muted">{event.reason}</span> : null}
                </li>
              ))}
            </ol>
            <TaskControls taskId={task.id} actions={task.allowedActions} />
          </article>
        ))}
      </div>
      <Link href="/organization" className="text-sm underline decoration-line underline-offset-4">Back to the family tree</Link>
    </div>
  );
}

function CountList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ id: string; label: string; active: number; blocked: number; inReview: number; completed: number }>;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface">
      <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? <p className="px-4 py-3 text-sm text-muted">No rows.</p> : (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="grid grid-cols-5 gap-2 px-4 py-3 text-sm">
              <span className="col-span-1 font-medium">{row.label}</span>
              <span>{row.active} active</span>
              <span>{row.blocked} blocked</span>
              <span>{row.inReview} review</span>
              <span>{row.completed} done</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function first(value: string | string[] | undefined): string | null {
  const item = Array.isArray(value) ? value[0] : value;
  return item && item.trim() !== "" ? item : null;
}
