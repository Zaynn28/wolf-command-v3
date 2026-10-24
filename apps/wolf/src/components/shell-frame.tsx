"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CommandBar } from "@/components/command-bar";
import type { NavItem } from "@/lib/navigation";

export function ShellFrame({
  pages,
  navigation,
  mobile,
  session,
  financeSession,
  children,
}: {
  pages: readonly NavItem[];
  navigation: ReactNode;
  mobile: ReactNode;
  session: ReactNode;
  financeSession?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const financeApp = /^\/finance\/[a-z0-9-]+/.test(pathname);
  const hrApp = /^\/hr\/(?:amg|bzg|ggv)(?:\/|$)/.test(pathname);
  const financeHome = pathname === "/finance";
  if (financeApp || hrApp) return <div className="min-h-dvh bg-background text-foreground">{children}</div>;
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-20 focus:rounded-md focus:bg-raised focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      <div className="md:grid md:grid-cols-[16.25rem_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface md:flex">
          <div className="flex items-center gap-3 px-4 pt-5 pb-4">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-on-accent" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2 4.5 6.2v6.3c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6.2L12 2Zm-1.2 6.2c.7-.8 2.7-.8 3.4 0 .4.5.3 1.2-.1 1.6-.2.2-.1.5.1.7.7.5 1.1 1.3 1.1 2.2 0 1.6-1.3 2.8-3.3 2.8s-3.3-1.2-3.3-2.8c0-.9.4-1.7 1.1-2.2.2-.2.3-.5.1-.7-.4-.4-.5-1.1-.1-1.6Z" />
              </svg>
            </span>
            <div className="leading-none">
              <p className="text-[13px] font-semibold tracking-[0.18em] text-foreground">WOLF</p>
              <p className="mt-1 text-[10px] font-medium tracking-[0.2em] text-muted">INTELLIGENCE</p>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{navigation}</div>
          <div className="px-3 pb-4">
            <div className="rounded-lg border border-line bg-background px-3 py-2.5">
              <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                {process.env.NODE_ENV === "production" ? "Production" : "Local Development"}
              </p>
              <p className="mt-0.5 pl-3.5 text-[11px] text-muted">Wolf V3</p>
            </div>
          </div>
        </aside>
        <div className="min-w-0">
          {mobile}
          <div className="border-b border-line bg-background/80 px-4 py-3 sm:px-5">
            <CommandBar pages={pages}>{financeHome ? (financeSession ?? session) : session}</CommandBar>
          </div>
          <main id="main" className="min-w-0 px-4 py-4 sm:px-5 sm:py-5">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
