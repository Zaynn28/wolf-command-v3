import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { loadActorContext } from "@/server/access/session-actor";
import { isPlatformOperator } from "@/server/admin/companies";
import { financeSurfaceLabel, financeWorkspace, listFinanceCompanies } from "@/server/finance/companies";

export default function FinancePage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Checking finance access…</p>}>
      <FinanceHome />
    </Suspense>
  );
}

async function FinanceHome() {
  const context = await loadActorContext();
  if (context.status === "signed_out") {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="Finance" title="Finance" description="Sign in is required before a company workspace can be opened." />
        <EmptyState title="Sign in required" body="No company finance workspace is shown." />
        <Link href="/login" className="text-sm text-foreground underline decoration-line underline-offset-4">Go to sign in</Link>
      </div>
    );
  }
  if (context.status === "password_change_required") {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="Finance" title="Finance" description="Change the temporary Wolf password before opening Finance." />
        <Link href="/account/password" className="text-sm text-foreground underline decoration-line underline-offset-4">Change password</Link>
      </div>
    );
  }
  if (context.status !== "ready") {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="Finance" title="Finance" description="Finance fails closed until the signed-in account can be verified." />
        <EmptyState title="Finance unavailable" body="No company workspace is shown." />
      </div>
    );
  }

  const cards = await listFinanceCompanies(context.db, context.actor);
  const operator = await isPlatformOperator(context.db, context.actor.userId);
  return (
    <div className="flex flex-col gap-8">
      <header className="max-w-xl">
        <p className="text-sm font-medium text-muted">Finance</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">Choose a company</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Choose a company to open Finance. Records stay with the company you select.
        </p>
      </header>
      {cards.length === 0 ? (
        <EmptyState title="No finance company" body="This account is not assigned to a finance department. No books are shown." />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {cards.map((card) => {
            const meta = workspaceMeta(card.workspaceKind, card.currencyCode, card.minorScale);
            return (
              <li key={card.companyId}>
                <Link
                  href={`/finance/${card.companyId}`}
                  className="block rounded-lg border border-line bg-surface px-4 py-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <p className="text-base font-semibold text-foreground">{card.name}</p>
                  <p className="mt-2 text-sm text-muted">
                    {financeWorkspace(context.actor, card.companyId) === "procurement" ? "Procurement" : card.companyId}
                  </p>
                  <p className="mt-2 text-sm text-muted">
                    {meta.detail}
                    {meta.posting ? <span className="font-medium text-foreground"> {meta.posting}</span> : null}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {operator ? (
        <p className="text-sm text-muted">
          Operators provision companies at <Link className="text-foreground underline" href="/admin/companies">Companies</Link>. That page is not public registration.
        </p>
      ) : null}
    </div>
  );
}

function workspaceMeta(kind: "shared" | "amg" | "unconfigured", currency: string | null, scale: number | null) {
  if (kind === "unconfigured") {
    return { detail: "Finance settings are not configured. No books are shown until an operator finishes setup.", posting: null };
  }
  return { detail: `${currency ?? "Currency not set"} · scale ${scale ?? "not set"}`, posting: "Posting off" };
}
