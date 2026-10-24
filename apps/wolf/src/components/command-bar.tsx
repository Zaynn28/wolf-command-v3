"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { NavItem } from "@/lib/navigation";

export function CommandBar({ pages, children }: { pages: readonly NavItem[]; children: ReactNode }) {
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const matches = pages.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()));
  const local = process.env.NODE_ENV !== "production";

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
      <div className="relative min-w-0 w-full flex-1 sm:w-auto">
        <label className="sr-only" htmlFor={inputId}>
          Search pages
        </label>
        <input
          ref={inputRef}
          id={inputId}
          role="combobox"
          aria-expanded={open && query.trim().length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          value={query}
          placeholder="Search anything..."
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          className="w-full rounded-full border border-line bg-background py-2 pr-12 pl-4 text-sm text-foreground outline-none placeholder:text-muted focus-visible:border-accent"
        />
        <kbd className="pointer-events-none absolute top-1/2 right-2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md border border-line bg-raised text-[11px] font-medium text-muted">
          K
        </kbd>
        {open && query.trim() ? (
          <ul id={listId} className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-line bg-surface">
            {matches.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted">No matching page.</li>
            ) : (
              matches.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="block px-3 py-2 text-sm text-foreground hover:bg-raised focus-visible:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    {item.label}
                  </Link>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
        {local ? "LOCAL DEV" : "PRODUCTION"}
      </span>
      <button
        type="button"
        aria-label="No notifications are recorded"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line text-muted hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <div className="min-w-0 shrink-0">{children}</div>
    </div>
  );
}
