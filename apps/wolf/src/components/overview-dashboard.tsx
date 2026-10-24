import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/empty-state";
import { Greeting } from "@/components/greeting";
import type { ConnectionCheck, DemoWorkItem } from "@/lib/demo-data";
import { modules, type NavItem } from "@/lib/navigation";

function DemoLabel() {
  return (
    <span className="rounded border border-line px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">
      Demo
    </span>
  );
}

const moduleIcon: Record<string, ReactNode> = {
  "/finance": (
    <path d="M5 6h14v12H5V6Zm0 4h14M8 14h3" />
  ),
  "/hr": (
    <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm6.5 1.5a2.5 2.5 0 1 0 0-5M4.5 19v-1.2A3.3 3.3 0 0 1 7.8 14.5h2.4A3.3 3.3 0 0 1 13.5 17.8V19" />
  ),
  "/academy": <path d="M3 9.5 12 5l9 4.5-9 4.5L3 9.5Zm4 3.2V16c1.4 1.2 3.1 1.8 5 1.8s3.6-.6 5-1.8v-3.3" />,
  "/content-machine": <path d="M8 8h.01M16 8h.01M12 16h.01M8 8a4 4 0 0 1 4 4M16 8a4 4 0 0 1-4 4M12 16V12" />,
};

const moduleLine: Record<string, string> = {
  "/finance": "Each company has its own records and enabled modules.",
  "/hr": "No people records are stored.",
  "/academy": "No training records are stored.",
  "/content-machine": "No drafts are stored.",
};

function Glyph({ href, gold }: { href: string; gold?: boolean }) {
  return (
    <span className={`grid h-9 w-9 place-items-center rounded-lg border ${gold ? "border-accent/50 bg-accent/10 text-accent" : "border-line bg-background text-muted"}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {moduleIcon[href]}
      </svg>
    </span>
  );
}

export function ModuleCards({ items = modules }: { items?: readonly NavItem[] }) {
  return (
    <section aria-labelledby="modules-heading" className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-4">
        <h2 id="modules-heading" className="text-base font-semibold">
          Module status
        </h2>
        <p className="mt-1 text-sm text-muted">No module on this page is connected to live data.</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((module) => {
          const finance = module.href === "/finance";
          return (
            <li key={module.href} className={`rounded-xl border bg-background p-4 ${finance ? "border-accent" : "border-line"}`}>
              <div className="flex items-start gap-3">
                <Glyph href={module.href} gold={finance} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{module.label}</p>
                  <p className="mt-1 text-sm leading-5 text-muted">{moduleLine[module.href] ?? module.description}</p>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-xs text-muted">
                  <span className={`h-1.5 w-1.5 rounded-full ${finance ? "bg-accent" : "bg-muted"}`} aria-hidden="true" />
                  Not connected
                </p>
                <Link
                  href={module.href}
                  className={`rounded-full px-3 py-1 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    finance ? "bg-accent text-on-accent" : "border border-line text-foreground hover:bg-raised"
                  }`}
                >
                  Open
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function WorkQueue({ items }: { items: readonly DemoWorkItem[] }) {
  return (
    <section aria-labelledby="queue-heading" className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h2 id="queue-heading" className="text-lg font-semibold">
          Work queue
        </h2>
        <DemoLabel />
      </div>
      {items.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="No sample tasks"
            body="The work queue is empty. No live tasks are loaded because no work source is connected."
          />
        </div>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id} className="border-b border-line px-4 py-3 last:border-b-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{item.title}</p>
                <p className="text-sm text-muted">{item.module}</p>
              </div>
              <p className="mt-1 text-sm text-muted">{item.note}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HealthGlyph({ children }: { children: ReactNode }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-background text-muted">
      {children}
    </span>
  );
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function SystemHealth({ email }: { email: string }) {
  const rows = [
    {
      id: "session",
      name: "Session",
      detail: `Open for ${email}. No authentication health check is recorded.`,
      state: "Signed in",
      tone: "text-foreground bg-foreground/10",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3 5 6v6c0 4 2.8 6.8 7 8 4.2-1.2 7-4 7-8V6l-7-3Z" {...stroke} />
        </svg>
      ),
    },
    {
      id: "database",
      name: "Database",
      detail: "No database health check is recorded.",
      state: "Unknown",
      tone: "text-accent bg-accent/15",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <ellipse cx="12" cy="7" rx="7" ry="3" {...stroke} />
          <path d="M5 7v10c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" {...stroke} />
        </svg>
      ),
    },
    {
      id: "external",
      name: "External integrations",
      detail: "Posting, people, training, and publishing sources are not connected.",
      state: "Not connected",
      tone: "text-muted bg-raised",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 18a4 4 0 1 1 .5-8 5 5 0 0 1 9.6-1.5A3.5 3.5 0 1 1 18 18H7Z" {...stroke} />
        </svg>
      ),
    },
  ];

  return (
    <section aria-labelledby="health-heading" className="rounded-xl border border-line bg-surface p-4">
      <h2 id="health-heading" className="text-base font-semibold">
        System health
      </h2>
      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-3 rounded-lg px-1 py-2">
            <HealthGlyph>{row.icon}</HealthGlyph>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{row.name}</p>
              <p className="mt-0.5 text-xs leading-5 text-muted">{row.detail}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${row.tone}`}>{row.state}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function QuickActions() {
  const actions = [
    { href: "/finance", label: "Switch company", detail: "Open Finance and choose a company." },
    { href: "/account/password", label: "Change password", detail: "Update the Wolf password." },
    { href: "/settings", label: "Settings", detail: "Your profile for this session." },
  ];

  return (
    <section aria-labelledby="actions-heading" className="rounded-xl border border-line bg-surface p-4">
      <h2 id="actions-heading" className="text-base font-semibold">
        Quick actions
      </h2>
      <ul className="mt-2">
        {actions.map((action) => (
          <li key={action.href} className="border-t border-line first:border-t-0">
            <Link
              href={action.href}
              className="flex items-center gap-3 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-background text-muted" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M8 12h8M13 7l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{action.label}</span>
                <span className="mt-0.5 block text-xs text-muted">{action.detail}</span>
              </span>
              <span className="text-muted" aria-hidden="true">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ActivityEmpty() {
  return (
    <section aria-labelledby="activity-heading" className="rounded-xl border border-line bg-surface p-4">
      <h2 id="activity-heading" className="text-base font-semibold">
        Recent activity
      </h2>
      <p className="mt-3 text-sm leading-6 text-muted">No activity is recorded.</p>
    </section>
  );
}

export function GetStarted() {
  return (
    <section aria-labelledby="start-heading" className="relative min-h-40 overflow-hidden rounded-xl border border-line">
      <Image src="/mountain.jpg" alt="" fill sizes="(min-width: 768px) 40vw, 100vw" className="object-cover" />
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative flex h-full flex-col justify-end p-4">
        <h2 id="start-heading" className="text-base font-semibold text-foreground">
          Get started
        </h2>
        <p className="mt-1 max-w-xs text-sm leading-6 text-foreground/80">
          Explore the modules in this workspace. No setup guide is published.
        </p>
      </div>
    </section>
  );
}

export function CurrentCompany() {
  return (
    <section aria-labelledby="company-heading" className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-background text-accent" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 19V6.5L12 4l8 2.5V19M9 19v-4h6v4" strokeLinejoin="round" />
          </svg>
        </span>
        <div className="min-w-0">
          <h2 id="company-heading" className="text-base font-semibold">
            Current company
          </h2>
          <p className="mt-1 text-sm text-foreground">No company is selected</p>
          <p className="mt-1 text-xs leading-5 text-muted">Choose a company in Finance. Records stay with that company.</p>
        </div>
      </div>
      <Link
        href="/finance"
        className="mt-4 block rounded-lg border border-line px-3 py-2 text-center text-sm font-medium text-foreground hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Switch company
      </Link>
    </section>
  );
}

export function OverviewCommand({ email }: { email: string }) {
  const local = process.env.NODE_ENV !== "production";
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="relative overflow-hidden rounded-xl border border-line">
        <Image src="/mountain.jpg" alt="" fill priority sizes="100vw" className="object-cover object-[center_40%]" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/55 to-black/20" />
        <div className="relative flex flex-wrap items-end justify-between gap-4 px-5 py-7 sm:px-6">
          <div className="min-w-0">
            <Greeting />
            <p className="mt-2 max-w-xl text-sm text-foreground/80">
              Your operations at a glance. Keep your systems running and stay productive.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-black/45 px-3 py-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-accent/20 text-accent" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <rect x="3" y="4" width="18" height="12" rx="1.5" />
                <path d="M8 20h8M12 16v4" strokeLinecap="round" />
              </svg>
            </span>
            <div>
              <p className="text-[10px] font-semibold tracking-[0.14em] text-accent">{local ? "LOCAL DEVELOPMENT" : "PRODUCTION"}</p>
              <p className="text-sm font-medium text-foreground">Wolf V3</p>
            </div>
          </div>
        </div>
      </header>
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(17rem,0.85fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <ModuleCards />
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <ActivityEmpty />
            <GetStarted />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <SystemHealth email={email} />
          <QuickActions />
          <CurrentCompany />
        </div>
      </div>
    </div>
  );
}

export function SystemStatus({ checks }: { checks: readonly ConnectionCheck[] }) {
  return (
    <section aria-labelledby="status-heading" className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h2 id="status-heading" className="text-lg font-semibold">
          System status
        </h2>
        <DemoLabel />
      </div>
      {checks.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="No status readings"
            body="Status checks are unavailable. No integration is connected, so there is nothing to report."
          />
        </div>
      ) : (
        <ul>
          {checks.map((check) => (
            <li key={check.id} className="border-b border-line px-4 py-3 last:border-b-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{check.name}</p>
                <p className="text-sm text-muted">Not connected</p>
              </div>
              <p className="mt-1 text-sm text-muted">{check.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
