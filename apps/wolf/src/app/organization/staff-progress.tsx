import Link from "next/link";
import type { StaffProgress, StaffProgressTask } from "@/server/organization/service";

const columns = "sm:grid-cols-[minmax(0,1.4fr)_6.5rem_minmax(0,1fr)]";

function departmentLabel(name: string) {
  return name === "No department" ? "—" : name;
}

export function StaffProgressView({ progress }: { progress: StaffProgress }) {
  const showCompany = progress.companies.length > 1;
  return (
    <section id="staff-progress" className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Staff progress</h2>
      {progress.unavailableCompanyIds.length > 0 ? (
        <p className="text-sm text-muted">HR employees could not be read for {progress.unavailableCompanyIds.join(", ")}.</p>
      ) : null}
      {progress.people.length === 0 ? (
        <p className="text-sm text-muted">No HR employees are recorded for this company.</p>
      ) : (
        <div className="max-w-5xl overflow-hidden rounded-lg border border-line bg-surface">
          <div className={`hidden border-b border-line px-4 py-2 text-xs font-medium text-muted sm:grid ${columns} sm:gap-x-3`}>
            <span>Name</span>
            <span>Code</span>
            <span>Department</span>
          </div>
          <ul className="divide-y divide-line">
            {progress.people.map((person) => {
              const department = [...new Set(person.companies.map((placement) => departmentLabel(placement.departmentName)))].join(", ");
              return (
                <li key={person.id} className="px-4 py-2.5">
                  <div className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 sm:items-baseline sm:gap-x-3 ${columns}`}>
                    <Link href={`/organization/people/${person.id}`} className="truncate text-sm font-medium hover:underline">
                      {person.displayName}
                    </Link>
                    <span className="text-sm text-muted">{person.employeeCode}</span>
                    <span className="col-span-2 truncate text-sm text-muted sm:col-span-1">{department}</span>
                  </div>
                  {person.tasks.length > 0 ? <TaskLines tasks={person.tasks} showCompany={showCompany} /> : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {progress.unassigned.tasks.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Unassigned</h3>
          <TaskLines tasks={progress.unassigned.tasks} showCompany={showCompany} />
        </div>
      ) : null}
    </section>
  );
}

function TaskLines({ tasks, showCompany }: { tasks: StaffProgressTask[]; showCompany: boolean }) {
  return (
    <ul className="mt-1.5 flex flex-col gap-1">
      {tasks.map((task) => (
        <li key={task.id} className="text-sm">
          <Link href={`/organization/tasks?companyId=${task.companyId}#task-${task.id}`} className="hover:underline">
            {task.title}
          </Link>
          <span className="text-muted">
            {" "}
            · {task.status}
            {showCompany ? ` · ${task.companyName}` : ""}
            {" · "}
            <span className={task.overdue ? "text-accent" : undefined}>{task.dueOn}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
