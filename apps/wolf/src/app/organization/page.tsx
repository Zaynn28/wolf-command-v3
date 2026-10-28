import Link from "next/link";
import { Suspense } from "react";
import { loadActorContext } from "@/server/access/session-actor";
import { readOrganizationBoard } from "@/server/organization/board";
import { OrganizationBoardView } from "./organization-board";

export default function OrganizationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading the organization…</p>}>
      <OrganizationHome searchParams={searchParams} />
    </Suspense>
  );
}

async function OrganizationHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const companyId = first(params.companyId);
  const context = await loadActorContext();
  if (context.status === "signed_out") {
    return <Gate title="Sign in required" body="Organization is available after a Wolf sign-in." href="/login" link="Go to sign in" />;
  }
  if (context.status === "password_change_required") {
    return <Gate title="Password change required" body="Change the Wolf password before opening Organization." href="/account/password" link="Change password" />;
  }
  if (context.status !== "ready") {
    return <Gate title="Organization unavailable" body="Organization fails closed until the signed-in account can be verified." />;
  }
  const result = await readOrganizationBoard(context.db, context.actor, new Date());
  if (result.status !== 200 || !("people" in result.body)) {
    return <Gate title="Company unavailable" body={"error" in result.body ? result.body.error : "That company is not available."} />;
  }
  if (companyId && !result.body.companies.some((company) => company.id === companyId)) {
    return <Gate title="Company unavailable" body="That company is not available." />;
  }
  return <OrganizationBoardView board={result.body} activeCompanyId={companyId} />;
}

function Gate({ title, body, href, link }: { title: string; body: string; href?: string; link?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">Organization</h1>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-sm text-muted">{body}</p>
      {href && link ? <Link href={href} className="text-sm hover:underline">{link}</Link> : null}
    </div>
  );
}

function first(value: string | string[] | undefined): string | null {
  const item = Array.isArray(value) ? value[0] : value;
  return item && item.trim() !== "" ? item : null;
}
