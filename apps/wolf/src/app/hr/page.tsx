import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { loadActorContext } from "@/server/access/session-actor";
import { grantedHrAccess } from "@/server/access/operating-grants";

export default function HrPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Checking HR access…</p>}>
      <HrHome />
    </Suspense>
  );
}

async function HrHome() {
  const context = await loadActorContext();
  if (context.status === "signed_out") {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="HR" title="HR" description="Sign in is required before a company workspace can be opened." />
        <EmptyState title="Sign in required" body="No people records are shown." />
        <Link href="/login" className="text-sm text-foreground underline decoration-line underline-offset-4">Go to sign in</Link>
      </div>
    );
  }
  if (context.status === "password_change_required") {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="HR" title="HR" description="Change the temporary Wolf password before opening HR." />
        <Link href="/account/password" className="text-sm text-foreground underline decoration-line underline-offset-4">Change password</Link>
      </div>
    );
  }
  if (context.status !== "ready") {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="HR" title="HR" description="HR fails closed until the signed-in account can be verified." />
        <EmptyState title="HR unavailable" body="No people records are shown." />
      </div>
    );
  }

  const hr = await grantedHrAccess(context.db, context.actor);
  const companyIds = hr.ids;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="HR"
        title="Choose a company"
        description="Choose a company to open HR. People records stay with that company. A Wolf role does not grant an HRIS role."
      />
      {companyIds.length === 0 ? (
        <EmptyState title="No HR company" body="This account is not assigned to an HR department. No people records are shown." />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {companyIds.map((companyId) => (
            <li key={companyId}>
              <Link
                href={`/hr/${companyId}`}
                className="block rounded-lg border border-line bg-surface px-4 py-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <p className="text-base font-semibold text-foreground">{companyId.toUpperCase()}</p>
                <p className="mt-2 text-sm text-muted">{hr.access(companyId) === "employee" ? "Employee" : companyId}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
