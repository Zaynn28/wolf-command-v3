"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export type OrganizationCompanyTab = { id: string; name: string };

export function OrganizationChrome({
  companies,
  active,
  addTargets,
  exportRows,
  exportName,
  children,
}: {
  companies: OrganizationCompanyTab[];
  active: "all" | "tasks" | string;
  addTargets: OrganizationCompanyTab[];
  exportRows: string[][];
  exportName: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-brand-navy)]">Organization</h1>
          <p className="mt-1 text-sm text-muted">Find employees and departments recorded in HR.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={exportRows.length === 0}
            onClick={() => downloadCsv(exportName, exportRows)}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-foreground disabled:opacity-50"
          >
            Export
          </button>
          <AddEmployee targets={addTargets} active={active} />
        </div>
      </header>
      <nav className="flex flex-wrap gap-1" aria-label="Company">
        <Tab href="/organization" active={active === "all"} label="All" />
        {companies.map((company) => (
          <Tab key={company.id} href={`/organization?companyId=${company.id}`} active={active === company.id} label={company.name} />
        ))}
        <Tab href="/organization/tasks" active={active === "tasks"} label="Tasks" />
      </nav>
      {children}
    </div>
  );
}

function Tab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-lg px-3 py-1.5 text-sm ${active ? "bg-[var(--color-brand-navy)] font-medium text-white" : "text-muted hover:bg-surface"}`}
    >
      {label}
    </Link>
  );
}

function AddEmployee({ targets, active }: { targets: OrganizationCompanyTab[]; active: "all" | "tasks" | string }) {
  const current = targets.find((target) => target.id === active);
  const choice = current ?? (targets.length === 1 ? targets[0] : null);
  if (targets.length === 0) return null;
  if (choice) {
    return (
      <a href={addHref(choice.id)} className="rounded-lg bg-[var(--color-brand-navy)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-navy-hover)]">
        Add Employee
      </a>
    );
  }
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-lg bg-[var(--color-brand-navy)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-navy-hover)] [&::-webkit-details-marker]:hidden">
        Add Employee
      </summary>
      <div className="absolute right-0 z-10 mt-1 min-w-40 rounded-lg border border-line bg-surface p-1 shadow-[var(--shadow-popover)]">
        {targets.map((target) => (
          <a key={target.id} href={addHref(target.id)} className="block rounded-md px-3 py-2 text-sm hover:bg-background">
            {target.name}
          </a>
        ))}
      </div>
    </details>
  );
}

function addHref(companyId: string) {
  return `/hr/${companyId}/runtime/?page=employees&add=1`;
}

export function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string) {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${guarded.replaceAll('"', '""')}"`;
}
