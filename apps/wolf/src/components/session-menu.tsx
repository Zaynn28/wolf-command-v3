import { logoutAction } from "@/app/login/actions";
import { readSignedInEmail } from "@/server/auth/current-session";
import { SubmitButton } from "@/components/submit-button";

type SessionMenuProps = {
  layout?: "spread" | "cluster" | "chip";
  primarySignOut?: boolean;
};

export async function SessionMenu({ layout = "spread", primarySignOut = false }: SessionMenuProps = {}) {
  const email = await readSignedInEmail();
  const linkClass = primarySignOut
    ? "font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    : "text-foreground underline decoration-line underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

  if (!email) {
    return (
      <p className="text-sm text-muted">
        <a href="/login" className={linkClass}>
          Sign in
        </a>
      </p>
    );
  }

  const identity = (
    <p className="min-w-0 text-muted">
      Signed in as <span className="break-all text-foreground">{email}</span>
    </p>
  );
  const password = (
    <a href="/account/password" className={linkClass}>
      Change password
    </a>
  );
  const signOut = (
    <SubmitButton tone={primarySignOut ? "primary" : "neutral"} pendingLabel="Signing out…">
      Sign out
    </SubmitButton>
  );

  if (layout === "chip") {
    return (
      <details className="relative">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-line bg-surface py-1 pr-3 pl-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-raised text-muted" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="8" r="3" stroke="currentColor" strokeWidth="1.6" />
              <path d="M5.5 19c.8-3 3-4.5 6.5-4.5s5.7 1.5 6.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
          <span className="hidden min-w-0 text-left sm:block">
            <span className="block text-[10px] leading-3 tracking-wide text-muted uppercase">Signed in</span>
            <span className="block max-w-[12rem] truncate text-xs font-medium text-foreground">{email}</span>
          </span>
        </summary>
        <div className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-line bg-surface p-3">
          <p className="break-all text-xs text-muted">{email}</p>
          <a href="/account/password" className="mt-3 block text-sm font-medium text-foreground">
            Change password
          </a>
          <form action={logoutAction} className="mt-3">
            {signOut}
          </form>
        </div>
      </details>
    );
  }

  if (layout === "cluster") {
    return (
      <form action={logoutAction} className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {password}
        <span className="hidden h-4 w-px bg-line sm:block" aria-hidden="true" />
        {identity}
        {signOut}
      </form>
    );
  }

  return (
    <form action={logoutAction} className="flex w-full flex-wrap items-center justify-between gap-3 text-sm">
      {identity}
      <p className="flex flex-wrap items-center gap-3">
        {password}
        {signOut}
      </p>
    </form>
  );
}
