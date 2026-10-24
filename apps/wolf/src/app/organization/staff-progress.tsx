import Link from "next/link";
import type { StaffProgress, StaffProgressTask, StaffTaskCounts } from "@/server/organization/service";

const countLabels = [
  ["ASSIGNED", "ASSIGNED"],
  ["ACCEPTED", "ACCEPTED"],
  ["IN_PROGRESS", "IN_PROGRESS"],
  ["BLOCKED", "BLOCKED"],
  ["IN_REVIEW", "IN_REVIEW"],
  ["COMPLETED", "COMPLETED"],
  ["overdue", "Overdue"],
] as const;

export function StaffProgressView({ progress }: { progress: StaffProgress }) {
  const companyLabel = progress.companies.map((company) => company.name).join(", ");
  return (
    <section id="staff-progress" className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{progress.ownerView ? "Owner view" : "Staff progress"}</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          {progress.ownerView
            ? "This is the owner view of demo staff progress for companies covered by an Owner Private grant."
            : "Demo staff progress for companies this account administers. An administrator role is not an Owner Private grant."}
          {" "}
          Each number is a count of demo tasks in that status. Overdue means the due date is before today and the status is not COMPLETED.
        </p>
        <p className="mt-2 text-sm text-muted">Companies in this view: {companyLabel || "None"}</p>
      </div>
      {progress.people.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface px-4 py-8 text-center text-sm text-muted">
          No demo people are placed in this view.
        </p>
      ) : (
        <div className="grid gap-4">
          {progress.people.map((person) => (
            <article key={person.id} className="rounded-lg border border-line bg-surface px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium tracking-wide text-muted uppercase">Demo</span>
                <span className="text-[11px] font-medium text-muted uppercase">{person.employmentStatus}</span>
                {person.companies.length > 1 ? <span className="text-[11px] font-medium text-muted uppercase">Multiple companies</span> : null}
              </div>
              <h3 className="mt-2 text-lg font-semibold">
                <Link href={`/organization/people/${person.id}`} className="underline decoration-line underline-offset-4">{person.displayName}</Link>
              </h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-muted">
                {person.companies.map((placement) => (
                  <li key={`${placement.companyId}-${placement.positionId}`}>
                    {placement.companyName} · {placement.departmentName} · {placement.positionTitle}
                  </li>
                ))}
              </ul>
              <CountGrid counts={person.counts} />
              {person.tasks.length === 0 ? (
                <p className="mt-4 text-sm text-muted">No demo tasks are assigned to this person in this view.</p>
              ) : (
                <TaskLines tasks={person.tasks} />
              )}
            </article>
          ))}
        </div>
      )}
      <article className="rounded-lg border border-line bg-surface px-4 py-4">
        <h3 className="text-lg font-semibold">Unassigned team tasks</h3>
        <p className="mt-2 text-sm text-muted">Demo tasks with a team and no person assigned. They are not counted on a staff member.</p>
        <CountGrid counts={progress.unassigned.counts} />
        {progress.unassigned.tasks.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No unassigned team tasks are in this view.</p>
        ) : (
          <TaskLines tasks={progress.unassigned.tasks} />
        )}
      </article>
    </section>
  );
}

function CountGrid({ counts }: { counts: StaffTaskCounts }) {
  return (
    <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {countLabels.map(([key, label]) => (
        <li key={key} className="rounded-md border border-line px-2 py-2">
          <p className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</p>
          <p className="mt-1 text-lg font-semibold">{counts[key]}</p>
        </li>
      ))}
    </ul>
  );
}

function TaskLines({ tasks }: { tasks: StaffProgressTask[] }) {
  return (
    <ul className="mt-4 divide-y divide-line border-t border-line">
      {tasks.map((task) => (
        <li key={task.id} className="flex flex-col gap-1 py-3 text-sm md:flex-row md:items-center md:justify-between">
          <Link href={`/organization/tasks?companyId=${task.companyId}#task-${task.id}`} className="font-medium underline decoration-line underline-offset-4">
            {task.title}
          </Link>
          <span className="text-muted">
            {task.status} · {task.companyName} · {task.dueOn}
            {task.teamDepartmentName ? ` · ${task.teamDepartmentName}` : ""}
            {task.overdue ? " · Overdue" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
