"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { OrganizationBoard, BoardPerson } from "@/server/organization/board";
import { OrganizationChrome } from "./organization-chrome";

const pageSize = 10;

export function OrganizationBoardView({
  board,
  activeCompanyId,
}: {
  board: OrganizationBoard;
  activeCompanyId: string | null;
}) {
  const scopeCompanies = activeCompanyId ? board.companies.filter((company) => company.id === activeCompanyId) : board.companies;
  const scopePeople = board.people.filter((person) => !activeCompanyId || person.companyId === activeCompanyId);
  const scopeDepartments = board.departments.filter((department) => !activeCompanyId || department.companyId === activeCompanyId);
  const unavailable = scopeCompanies.filter((company) => company.directory === "unavailable");
  const empty = scopePeople.length === 0 && unavailable.length === 0;
  const [treeQuery, setTreeQuery] = useState("");
  const [query, setQuery] = useState("");
  const [departmentKey, setDepartmentKey] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return scopePeople.filter((person) => {
      if (departmentKey && departmentKey !== `${person.companyId}:${person.department}`) return false;
      if (status && person.status !== status) return false;
      if (!needle) return true;
      return [person.name, person.code, person.department].some((value) => value.toLowerCase().includes(needle));
    });
  }, [departmentKey, query, scopePeople, status]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * pageSize;
  const visible = filtered.slice(start, start + pageSize);
  const selected = scopePeople.find((person) => person.id === selectedId) ?? null;
  const statuses = [...new Set(scopePeople.map((person) => person.status))].sort();
  const departmentOptions = departmentOptionsFor(scopePeople, scopeDepartments);
  const activeCount = scopePeople.filter((person) => person.status === "active").length;
  const joined = scopePeople.filter((person) => person.joinedThisMonth).length;
  const exportRows = filtered.map((person) => [person.name, person.code, person.department === "No department" ? "" : person.department, person.companyName, statusLabel(person.status)]);

  function selectDepartment(next: string) {
    setDepartmentKey(next);
    setPage(1);
  }

  return (
    <OrganizationChrome
      companies={board.companies}
      active={activeCompanyId ?? "all"}
      addTargets={board.addTargets}
      exportRows={exportRows.length === 0 ? [] : [["Name", "Employee code", "Department", "Company", "Status"], ...exportRows]}
      exportName="organization-employees.csv"
    >
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total employees" value={scopePeople.length} note={joined > 0 ? `+${joined} this month` : null} />
        <Stat label="Departments" value={scopeDepartments.length} note={scopeDepartments.length === 1 ? "Active department" : "Active departments"} />
        <Stat label="Companies" value={scopeCompanies.length} note={scopeCompanies.map((company) => company.name).join(" · ")} />
        <Stat label="Active" value={activeCount} note="Employment status in HR" />
      </section>
      {unavailable.length > 0 ? (
        <p className="text-sm text-muted">HR employees could not be read for {unavailable.map((company) => company.name).join(", ")}.</p>
      ) : null}
      {empty ? (
        <div className="rounded-xl border border-dashed border-line bg-surface px-4 py-10 text-center">
          <p className="text-sm text-muted">No HR employees are recorded for this company.</p>
        </div>
      ) : (
        <div className="grid items-start gap-3 xl:grid-cols-[16rem_minmax(0,1fr)_20rem]">
          <DepartmentTree
            companies={scopeCompanies}
            people={scopePeople}
            departments={scopeDepartments}
            query={treeQuery}
            onQuery={setTreeQuery}
            selected={departmentKey}
            onSelect={selectDepartment}
          />
          <EmployeeTable
            rows={visible}
            total={filtered.length}
            start={start}
            page={currentPage}
            pages={pages}
            query={query}
            onQuery={(value) => {
              setQuery(value);
              setPage(1);
            }}
            departmentKey={departmentKey}
            departments={departmentOptions}
            onDepartment={selectDepartment}
            status={status}
            statuses={statuses}
            onStatus={(value) => {
              setStatus(value);
              setPage(1);
            }}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            onPage={setPage}
          />
          {selected ? (
            <PersonDetail
              key={selected.id}
              person={selected}
              departments={board.departments.filter((department) => department.companyId === selected.companyId)}
              canEdit={board.editableCompanyIds.includes(selected.companyId)}
            />
          ) : (
            <aside className="rounded-xl border border-line bg-surface px-4 py-8 text-sm text-muted">Select an employee to see their HR record.</aside>
          )}
        </div>
      )}
    </OrganizationChrome>
  );
}

function Stat({ label, value, note }: { label: string; value: number; note: string | null }) {
  return (
    <article className="rounded-xl border border-line bg-surface px-4 py-3 shadow-[var(--shadow-card)]">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-brand-navy)]">{value}</p>
      {note ? <p className={`mt-1 text-xs ${note.startsWith("+") ? "text-[var(--color-success-foreground)]" : "text-muted"}`}>{note}</p> : null}
    </article>
  );
}

function DepartmentTree({
  companies,
  people,
  departments,
  query,
  onQuery,
  selected,
  onSelect,
}: {
  companies: OrganizationBoard["companies"];
  people: BoardPerson[];
  departments: OrganizationBoard["departments"];
  query: string;
  onQuery: (value: string) => void;
  selected: string;
  onSelect: (key: string) => void;
}) {
  const needle = query.trim().toLowerCase();
  const nodes = companies.map((company) => {
    const counts = new Map<string, number>();
    for (const person of people) {
      if (person.companyId !== company.id) continue;
      counts.set(person.department, (counts.get(person.department) ?? 0) + 1);
    }
    const names = new Set<string>([...counts.keys(), ...departments.filter((department) => department.companyId === company.id).map((department) => department.name)]);
    const rows = [...names]
      .filter((name) => name !== "No department")
      .sort((left, right) => left.localeCompare(right))
      .map((name) => ({ name, count: counts.get(name) ?? 0 }));
    if ((counts.get("No department") ?? 0) > 0) rows.push({ name: "No department", count: counts.get("No department") ?? 0 });
    return { company, rows: needle ? rows.filter((row) => row.name.toLowerCase().includes(needle)) : rows, employees: people.filter((person) => person.companyId === company.id).length };
  }).filter((node) => needle === "" || node.rows.length > 0);

  return (
    <aside className="rounded-xl border border-line bg-surface p-3">
      <h2 className="px-1 text-sm font-semibold">Organization tree</h2>
      <label className="mt-2 block">
        <span className="sr-only">Search departments</span>
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search department..."
          className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm"
        />
      </label>
      {nodes.length === 0 ? <p className="px-1 py-3 text-sm text-muted">No matching departments.</p> : null}
      <ul className="mt-2 flex flex-col gap-2">
        {nodes.map((node) => (
          <li key={node.company.id}>
            <p className="px-1 text-sm font-medium">{node.company.name}</p>
            <p className="px-1 text-xs text-muted">{node.employees} {node.employees === 1 ? "employee" : "employees"}</p>
            <ul className="mt-1">
              {node.rows.map((row) => {
                const key = `${node.company.id}:${row.name}`;
                const active = selected === key;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => onSelect(active ? "" : key)}
                      className={`flex w-full items-center justify-between rounded-lg border-l-2 px-2 py-1.5 text-left text-sm ${active ? "border-accent bg-background" : "border-transparent hover:bg-background"}`}
                    >
                      <span className="truncate">{row.name}</span>
                      <span className="shrink-0 text-xs text-muted">{row.count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function EmployeeTable({
  rows,
  total,
  start,
  page,
  pages,
  query,
  onQuery,
  departmentKey,
  departments,
  onDepartment,
  status,
  statuses,
  onStatus,
  selectedId,
  onSelect,
  onPage,
}: {
  rows: BoardPerson[];
  total: number;
  start: number;
  page: number;
  pages: number;
  query: string;
  onQuery: (value: string) => void;
  departmentKey: string;
  departments: Array<{ key: string; label: string }>;
  onDepartment: (value: string) => void;
  status: string;
  statuses: string[];
  onStatus: (value: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPage: (page: number) => void;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface">
      <div className="flex flex-col gap-2 border-b border-line px-3 py-3 lg:flex-row lg:items-center">
        <h2 className="text-sm font-semibold lg:mr-auto">Employees ({total})</h2>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search employees</span>
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search by name, code, or department..."
            className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm"
          />
        </label>
        <select aria-label="Department" value={departmentKey} onChange={(event) => onDepartment(event.target.value)} className="rounded-lg border border-line bg-background px-2 py-2 text-sm">
          <option value="">All departments</option>
          {departments.map((department) => (
            <option key={department.key} value={department.key}>{department.label}</option>
          ))}
        </select>
        <select aria-label="Status" value={status} onChange={(event) => onStatus(event.target.value)} className="rounded-lg border border-line bg-background px-2 py-2 text-sm">
          <option value="">All statuses</option>
          {statuses.map((item) => (
            <option key={item} value={item}>{statusLabel(item)}</option>
          ))}
        </select>
      </div>
      {total === 0 ? (
        <p className="px-4 py-8 text-sm text-muted">No employees match this filter.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Employee code</th>
                <th className="px-3 py-2 font-medium">Department</th>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((person) => {
                const selected = person.id === selectedId;
                return (
                  <tr key={person.id} className={selected ? "bg-background" : "hover:bg-background"}>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => onSelect(person.id)} className="flex items-center gap-2 text-left font-medium" aria-pressed={selected}>
                        <Avatar person={person} small />
                        <span className="truncate">{person.name}</span>
                      </button>
                    </td>
                    <td className="px-3 py-2 text-muted">{person.code}</td>
                    <td className="px-3 py-2 text-muted">{person.department === "No department" ? "—" : person.department}</td>
                    <td className="px-3 py-2 text-muted">{person.companyName}</td>
                    <td className="px-3 py-2"><StatusPill status={person.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs text-muted">
        <span>{total === 0 ? "Showing 0" : `Showing ${start + 1}–${Math.min(start + pageSize, total)} of ${total}`}</span>
        <div className="flex gap-1">
          {Array.from({ length: pages }, (_, index) => index + 1).map((number) => (
            <button
              key={number}
              type="button"
              onClick={() => onPage(number)}
              aria-current={number === page ? "page" : undefined}
              className={`h-7 min-w-7 rounded-md px-2 ${number === page ? "bg-[var(--color-brand-navy)] text-white" : "hover:bg-background"}`}
            >
              {number}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function PersonDetail({
  person,
  departments,
  canEdit,
}: {
  person: BoardPerson;
  departments: OrganizationBoard["departments"];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [contact, setContact] = useState<{ email: string | null; phone: string | null } | null>(null);
  const [changing, setChanging] = useState(false);
  const [departmentId, setDepartmentId] = useState(person.departmentId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/organization/people/${person.id}/contact`)
      .then(async (response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (cancelled || !body || typeof body !== "object") return;
        const record = body as { email?: unknown; phone?: unknown };
        setContact({
          email: typeof record.email === "string" ? record.email : null,
          phone: typeof record.phone === "string" ? record.phone : null,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [person.id]);

  async function saveDepartment() {
    setPending(true);
    setError("");
    const response = await fetch(`/api/organization/people/${person.id}/department`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ departmentId }),
    });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "The department was not changed.");
      return;
    }
    setChanging(false);
    router.refresh();
  }

  const editHref = person.hrId
    ? `/hr/${person.companyId}/runtime/?page=employees&employee=${encodeURIComponent(person.hrId)}`
    : `/hr/${person.companyId}/runtime/?page=employees`;

  return (
    <aside className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <Avatar person={person} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold">{person.name}</h2>
            <StatusPill status={person.status} />
          </div>
          <p className="text-sm text-muted">{person.code}</p>
          <p className="text-sm text-muted">{person.department === "No department" ? "No department" : person.department}</p>
        </div>
      </div>
      <h3 className="mt-4 text-sm font-semibold">Overview</h3>
      <dl className="mt-2 flex flex-col gap-2 text-sm">
        {contact?.email ? <Detail label="Email" value={contact.email} /> : null}
        {contact?.phone ? <Detail label="Phone" value={contact.phone} /> : null}
        <Detail label="Department" value={person.department === "No department" ? "—" : person.department} />
        <Detail label="Company" value={person.companyName} />
        {person.joinDate ? <Detail label="Joined" value={formatJoined(person.joinDate)} /> : null}
      </dl>
      {canEdit ? (
        <div className="mt-4 flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Quick actions</h3>
          <a href={editHref} className="rounded-lg bg-[var(--color-brand-navy)] px-3 py-2 text-center text-sm font-medium text-white hover:bg-[var(--color-brand-navy-hover)]">
            Edit Employee
          </a>
          {departments.length > 0 ? (
            changing ? (
              <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveDepartment();
                }}
              >
                <label className="text-sm text-muted">
                  Department
                  <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="mt-1 block w-full rounded-lg border border-line bg-background px-2 py-2 text-sm text-foreground">
                    <option value="">Select a department</option>
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>{department.name}</option>
                    ))}
                  </select>
                </label>
                <button type="submit" disabled={pending || departmentId === "" || departmentId === person.departmentId} className="rounded-lg border border-line px-3 py-2 text-sm font-medium disabled:opacity-50">
                  Save department
                </button>
                <button type="button" onClick={() => setChanging(false)} className="text-sm text-muted">
                  Cancel
                </button>
                {error ? <p className="text-sm text-muted">{error}</p> : null}
              </form>
            ) : (
              <button type="button" onClick={() => setChanging(true)} className="rounded-lg border border-line px-3 py-2 text-sm font-medium">
                Change department
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

function Avatar({ person, small }: { person: BoardPerson; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  const size = small ? "h-7 w-7 text-[10px]" : "h-12 w-12 text-sm";
  if (!person.hasPhoto || failed) {
    return <span className={`grid ${size} shrink-0 place-items-center rounded-full bg-[var(--color-brand-navy)] font-semibold text-white`}>{initials(person.name)}</span>;
  }
  return (
    <img
      src={`/api/organization/people/${person.id}/photo`}
      alt=""
      className={`${size} shrink-0 rounded-full object-cover`}
      onError={() => setFailed(true)}
    />
  );
}

function StatusPill({ status }: { status: string }) {
  const active = status === "active";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${active ? "bg-[var(--color-success-background)] text-[var(--color-success-foreground)]" : "bg-[var(--color-neutral-background)] text-[var(--color-neutral-foreground)]"}`}>
      {statusLabel(status)}
    </span>
  );
}

function departmentOptionsFor(people: BoardPerson[], departments: OrganizationBoard["departments"]) {
  const options = new Map<string, string>();
  for (const department of departments) options.set(`${department.companyId}:${department.name}`, department.name);
  for (const person of people) {
    const key = `${person.companyId}:${person.department}`;
    if (!options.has(key)) options.set(key, person.department === "No department" ? "No department" : person.department);
  }
  return [...options.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function statusLabel(status: string) {
  if (status === "active") return "Active";
  if (status === "leave") return "On leave";
  if (status === "inactive") return "Inactive";
  return status;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function formatJoined(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[Number(match[2]) - 1];
  if (!month) return iso;
  return `${Number(match[3])} ${month} ${match[1]}`;
}
