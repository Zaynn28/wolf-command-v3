"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { isActivePath, type NavItem } from "@/lib/navigation";

const groups = [
  { label: "Workspace", hrefs: ["/finance", "/hr", "/organization", "/assistant", "/academy", "/content-machine"] },
  { label: "Administration", hrefs: ["/owner-private", "/access", "/admin/companies", "/settings"] },
];

function Icon({ name }: { name: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<string, ReactNode> = {
    overview: <path d="M4 7.5 12 3l8 4.5V19a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1V7.5Z" {...common} />,
    finance: <path d="M5 6h14v12H5V6Zm0 4h14M8 14h3" {...common} />,
    hr: <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm6.5 1.5a2.5 2.5 0 1 0 0-5M4.5 19v-1.2A3.3 3.3 0 0 1 7.8 14.5h2.4A3.3 3.3 0 0 1 13.5 17.8V19M14 19v-1a3 3 0 0 1 2.2-2.9" {...common} />,
    organization: <path d="M12 4v4M12 12v8M8 8H4M16 8h4M7 20h10M8 8l4 4 4-4" {...common} />,
    assistant: <path d="M5 6.5h14v9H9l-4 3v-3H5v-9Z" {...common} />,
    academy: <path d="M3 9.5 12 5l9 4.5-9 4.5L3 9.5Zm4 3.2V16c1.4 1.2 3.1 1.8 5 1.8s3.6-.6 5-1.8v-3.3" {...common} />,
    content: <path d="M8 8h.01M16 8h.01M12 16h.01M8 8a4 4 0 0 1 4 4M16 8a4 4 0 0 1-4 4M12 16V12" {...common} />,
    lock: <path d="M8 11V8a4 4 0 0 1 8 0v3M6.5 11h11V19h-11V11Z" {...common} />,
    companies: <path d="M4 19V6.5L12 4l8 2.5V19M9 19v-4h6v4M9 9h.01M12 9h.01M15 9h.01M9 12h.01M12 12h.01M15 12h.01" {...common} />,
    settings: <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM12 4.5v1.6M12 17.9V19.5M4.5 12H6.1M17.9 12h1.6M6.4 6.4l1.1 1.1M16.5 16.5l1.1 1.1M17.6 6.4l-1.1 1.1M7.5 16.5l-1.1 1.1" {...common} />,
    access: <path d="M8 11V8a4 4 0 0 1 8 0v3M6.5 11h11V19h-11V11ZM12 14.5v2" {...common} />,
  };
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      {paths[name]}
    </svg>
  );
}

const iconFor: Record<string, string> = {
  "/": "overview",
  "/finance": "finance",
  "/hr": "hr",
  "/organization": "organization",
  "/assistant": "assistant",
  "/academy": "academy",
  "/content-machine": "content",
  "/owner-private": "lock",
  "/admin/companies": "companies",
  "/access": "access",
  "/settings": "settings",
};

function activeHref(pathname: string, items: readonly NavItem[]) {
  return items
    .filter((item) => isActivePath(pathname, item.href))
    .sort((left, right) => right.href.length - left.href.length)[0]?.href;
}

function NavLinks({ items, onNavigate }: { items: readonly NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const currentHref = activeHref(pathname, items);
  const overview = items.find((item) => item.href === "/");

  return (
    <div className="flex flex-col gap-5">
      {overview ? (
        <Link
          href={overview.href}
          aria-current={currentHref === overview.href ? "page" : undefined}
          onClick={onNavigate}
          className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            currentHref === overview.href
              ? "bg-accent font-medium text-on-accent"
              : "text-muted hover:bg-raised hover:text-foreground"
          }`}
        >
          <Icon name="overview" />
          {overview.label}
        </Link>
      ) : null}
      {groups.map((group) => {
        const groupItems = group.hrefs.flatMap((href) => items.filter((item) => item.href === href));
        if (groupItems.length === 0) return null;
        return (
          <div key={group.label}>
            <p className="px-3 pb-2 text-[10px] font-medium tracking-[0.16em] text-muted uppercase">{group.label}</p>
            <ul className="flex flex-col gap-0.5">
              {groupItems.map((item) => {
                const active = currentHref === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={onNavigate}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                        active ? "bg-accent font-medium text-on-accent" : "text-muted hover:bg-raised hover:text-foreground"
                      }`}
                    >
                      <Icon name={iconFor[item.href] ?? "overview"} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function DesktopNav({ items }: { items: readonly NavItem[] }) {
  return (
    <nav aria-label="Primary" className="px-3 py-2">
      <NavLinks items={items} />
    </nav>
  );
}

const DRAWER_MS = 240;

export function MobileNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;
  const current = items.find((item) => item.href === activeHref(pathname, items));
  const dialogRef = useRef<HTMLDialogElement>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!open) {
      if (!dialog.open) return;
      dialog.dataset.state = "closed";
      if (reduce) {
        dialog.close();
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled || !dialog.open) return;
        settled = true;
        dialog.close();
      };
      const onTransitionEnd = (event: TransitionEvent) => {
        if (event.target === dialog && event.propertyName === "transform") finish();
      };
      dialog.addEventListener("transitionend", onTransitionEnd);
      const timeout = window.setTimeout(finish, DRAWER_MS);
      return () => {
        settled = true;
        window.clearTimeout(timeout);
        dialog.removeEventListener("transitionend", onTransitionEnd);
      };
    }

    if (!dialog.open) dialog.showModal();
    if (reduce) {
      dialog.dataset.state = "open";
    } else if (dialog.dataset.state !== "open") {
      dialog.dataset.state = "closed";
      void dialog.offsetWidth;
      dialog.dataset.state = "open";
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const media = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (media.matches) setOpenPath(null);
    };
    media.addEventListener("change", onChange);
    return () => {
      document.body.style.overflow = previousOverflow;
      media.removeEventListener("change", onChange);
    };
  }, [open]);

  useEffect(() => {
    aliveRef.current = true;
    const dialog = dialogRef.current;
    return () => {
      aliveRef.current = false;
      if (dialog?.open) dialog.close();
    };
  }, []);

  function close() {
    if (!aliveRef.current) return;
    setOpenPath(null);
  }

  function onDialogClick(event: ReactMouseEvent<HTMLDialogElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!inside) close();
  }

  return (
    <div className="border-b border-line bg-surface md:hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-foreground">WOLF</p>
          <p className="truncate text-sm text-muted">{current?.label ?? "Navigation"}</p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-line bg-raised px-3 py-2 text-sm font-medium text-foreground"
          aria-expanded={open}
          aria-controls="mobile-navigation"
          onClick={() => (open ? close() : setOpenPath(pathname))}
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>
      <dialog
        ref={dialogRef}
        id="mobile-navigation"
        aria-label="Primary"
        className="mobile-nav-drawer"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={close}
        onClick={onDialogClick}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-on-accent" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2 4.5 6.2v6.3c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6.2L12 2Zm-1.2 6.2c.7-.8 2.7-.8 3.4 0 .4.5.3 1.2-.1 1.6-.2.2-.1.5.1.7.7.5 1.1 1.3 1.1 2.2 0 1.6-1.3 2.8-3.3 2.8s-3.3-1.2-3.3-2.8c0-.9.4-1.7 1.1-2.2.2-.2.3-.5.1-.7-.4-.4-.5-1.1-.1-1.6Z" />
                </svg>
              </span>
              <div className="min-w-0 leading-none">
                <p className="text-[13px] font-semibold tracking-[0.18em] text-foreground">WOLF</p>
                <p className="mt-1 truncate text-[10px] font-medium tracking-[0.2em] text-muted">{current?.label ?? "Navigation"}</p>
              </div>
            </div>
            <button
              type="button"
              className="rounded-lg border border-line bg-raised px-3 py-2 text-sm font-medium text-foreground"
              onClick={close}
            >
              Close
            </button>
          </div>
          <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto px-3 py-2 pb-6">
            <NavLinks items={items} onNavigate={close} />
          </nav>
        </div>
      </dialog>
    </div>
  );
}
