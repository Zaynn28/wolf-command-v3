import Link from "next/link";
import { Suspense } from "react";
import { authorize } from "@wolf/shared";
import { loadActorContext } from "@/server/access/session-actor";
import { visibleOperatorCompanyId } from "@/server/companies/operator-list";
import { authorizedCompanyIds, listReadableCompanies, readOrganizationTree, readStaffProgress, readTaskOverview } from "@/server/organization/service";
import { evaluateModuleAccess } from "@/server/access/matrix";
import { hrStaffCompanyIds } from "@/server/organization/board";
import { CreateTaskForm } from "../create-task-form";
import { OrganizationChrome } from "../organization-chrome";
import { type AssignableStaff } from "../staff-assign-list";
import { StaffProgressView } from "../staff-progress";
import { TaskList } from "../task-list";

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
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="text-sm text-muted">Sign in is required.</p>
        <Link href="/login" className="text-sm hover:underline">Go to sign in</Link>
      </div>
    );
  }
  const requestedRaw = first(params.companyId);
  const requested = requestedRaw && visibleOperatorCompanyId(requestedRaw) ? requestedRaw : null;
  const from = first(params.from) ?? "2026-10-01";
  const to = first(params.to) ?? "2026-10-31";
  const today = new Date().toISOString().slice(0, 10);
  const companies = authorizedCompanyIds(context.actor).filter(visibleOperatorCompanyId);
  const ownerCompanies = companies.filter(
    (companyId) => authorize({ actor: context.actor, action: "read", resource: { kind: "owner_private", companyId } }).outcome === "allow",
  );
  const adminCompanies = companies.filter(
    (companyId) => evaluateModuleAccess(context.actor, "organization", "create", { companyId }).outcome === "allow",
  );
  const scope = requested && ownerCompanies.includes(requested) ? "owner" : ownerCompanies.length > 0 && !requested ? "owner" : adminCompanies.length > 0 ? "company" : "assigned";
  const [result, progress, companyChoices] = await Promise.all([
    readTaskOverview(context.db, context.actor, { companyId: requested, from, to, today, scope }, { mode: "api" }),
    readStaffProgress(context.db, context.actor, { companyId: requested, today }, { mode: "api" }),
    listReadableCompanies(context.db, context.actor),
  ]);
  if (result.status !== 200 || !("tasks" in result.body)) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="text-sm text-muted">{"error" in result.body ? result.body.error : "Tasks are not available."}</p>
      </div>
    );
  }
  const overview = result.body;
  const tree = await readOrganizationTree(context.db, context.actor, requested, "");
  const people = assignableStaff(tree, adminCompanies);
  const companyName = new Map(companyChoices.map((company) => [company.id, company.name]));
  const unavailable = new Set(
    tree.status === 200 && "tree" in tree.body
      ? tree.body.tree.companies.filter((company) => company.directory === "unavailable").map((company) => company.id)
      : [],
  );
  const editable = new Set(hrStaffCompanyIds(context.actor, companyChoices));
  const visibleTasks = overview.tasks.filter((task) => visibleOperatorCompanyId(task.companyId));
  const taskRows = visibleTasks.map((task) => [
    task.title,
    companyName.get(task.companyId) ?? task.companyId.toUpperCase(),
    task.status,
    task.assigneeName ?? "Unassigned",
    task.dueOn,
  ]);
  return (
    <OrganizationChrome
      companies={companyChoices}
      active="tasks"
      addTargets={companyChoices.filter((company) => editable.has(company.id))}
      exportRows={taskRows.length === 0 ? [] : [["Title", "Company", "Status", "Assignee", "Due"], ...taskRows]}
      exportName="organization-tasks.csv"
    >
      <div className="flex flex-wrap gap-2">
        <CompanyLink href="/organization/tasks" active={!requested} label="All" />
        {companyChoices.map((company) => (
          <CompanyLink key={company.id} href={`/organization/tasks?companyId=${company.id}`} active={requested === company.id} label={company.name} />
        ))}
      </div>
      <TaskList
        tasks={visibleTasks.map((task) => ({
          id: task.id,
          title: task.title,
          companyId: task.companyId,
          companyName: companyName.get(task.companyId) ?? task.companyId.toUpperCase(),
          status: task.status,
          assigneeName: task.assigneeName,
          assigneePersonId: task.assigneePersonId,
          dueOn: task.dueOn,
          overdue: task.dueOn < today && task.status !== "COMPLETED",
          allowedActions: task.allowedActions,
          canAssign: adminCompanies.includes(task.companyId) && task.status !== "COMPLETED",
          directoryUnavailable: unavailable.has(task.companyId),
        }))}
        people={people}
      />
      {adminCompanies.length > 0 && people.length > 0 ? (
        <details className="rounded-lg border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">New task</summary>
          <div className="border-t border-line px-4 py-3">
            <CreateTaskForm people={people} />
          </div>
        </details>
      ) : null}
      {progress.status === 200 && "people" in progress.body ? (
        <StaffProgressView progress={progress.body} />
      ) : (
        <section id="staff-progress" className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">Staff progress</h2>
          <p className="text-sm text-muted">{"error" in progress.body ? progress.body.error : "Staff progress is not available."}</p>
        </section>
      )}
    </OrganizationChrome>
  );
}

function CompanyLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={`rounded-md border px-3 py-2 text-sm ${active ? "border-foreground bg-surface font-medium" : "border-line text-muted"}`}>
      {label}
    </Link>
  );
}

function assignableStaff(
  tree: Awaited<ReturnType<typeof readOrganizationTree>>,
  adminCompanies: string[],
): AssignableStaff[] {
  if (tree.status !== 200 || !("tree" in tree.body)) return [];
  const seen = new Set<string>();
  const people: AssignableStaff[] = [];
  for (const company of tree.body.tree.companies) {
    if (!adminCompanies.includes(company.id)) continue;
    for (const department of company.departments) {
      for (const position of department.positions) {
        if (!position.person?.employeeCode) continue;
        const key = `${company.id}:${position.person.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        people.push({
          id: position.person.id,
          name: position.person.displayName,
          employeeCode: position.person.employeeCode,
          companyId: company.id,
          companyName: company.name,
          departmentName: department.name,
          positionTitle: position.title,
        });
      }
    }
  }
  return people.sort((left, right) => left.name.localeCompare(right.name) || left.companyId.localeCompare(right.companyId));
}

function first(value: string | string[] | undefined): string | null {
  const item = Array.isArray(value) ? value[0] : value;
  return item && item.trim() !== "" ? item : null;
}
