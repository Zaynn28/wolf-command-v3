import "server-only";
import type { ReactNode } from "react";
import { connection } from "next/server";
import { EmptyState } from "@/components/empty-state";
import { OverviewCommand } from "@/components/overview-dashboard";
import { PageHeader } from "@/components/page-header";
import { loadGuardedModule, type GuardedModuleState } from "@/server/access/gate";
import type { ModuleId } from "@/server/access/matrix";

type SearchParams = Record<string, string | string[] | undefined>;

export async function AccessPanel({
  module,
  searchParams,
  title,
  description,
  emptyTitle,
  emptyBody,
}: {
  module: ModuleId;
  searchParams: Promise<SearchParams>;
  title: string;
  description: string;
  emptyTitle: string;
  emptyBody: string;
}) {
  await connection();
  const params = await searchParams;
  const view = await loadGuardedModule(module, {
    companyId: first(params.companyId),
    departmentId: first(params.departmentId),
    userId: first(params.userId),
    role: first(params.role),
    grant: first(params.grant),
  });
  return <AccessBody view={view} module={module} title={title} description={description} emptyTitle={emptyTitle} emptyBody={emptyBody} />;
}

function AccessBody({
  view,
  module,
  title,
  description,
  emptyTitle,
  emptyBody,
}: {
  view: GuardedModuleState;
  module: ModuleId;
  title: string;
  description: string;
  emptyTitle: string;
  emptyBody: string;
}) {
  if (view.state === "signed_out") {
    return (
      <DeniedFrame title={title} description="Sign in is required before this page checks access.">
        <EmptyState title="Sign in required" body="No records are shown." />
        <p className="text-sm text-muted">
          <a href="/login" className="text-foreground underline decoration-line underline-offset-4">
            Go to sign in
          </a>
        </p>
      </DeniedFrame>
    );
  }

  if (view.state === "password_change_required") {
    return (
      <DeniedFrame title={title} description={`Change the temporary Wolf password for ${view.email} before this module can be opened.`}>
        <EmptyState title="Password change required" body="No records are shown." />
        <p className="text-sm text-muted">
          <a href="/account/password" className="text-foreground underline decoration-line underline-offset-4">
            Change password
          </a>
        </p>
      </DeniedFrame>
    );
  }

  if (view.state === "unavailable") {
    return (
      <DeniedFrame title={title} description="Access cannot be checked because the local database is not configured or could not be reached.">
        <EmptyState title="Access unavailable" body="The page fails closed until the local database can be read." />
      </DeniedFrame>
    );
  }

  if (view.state === "denied") {
    const description =
      module === "owner_private"
        ? `Access denied for ${view.email}. This account does not have an explicit Owner Private grant.`
        : `Access denied for ${view.email}. This account does not have the required membership or permission.`;
    return (
      <DeniedFrame title={title} description={description}>
        <EmptyState title="No records" body="No records are shown." />
      </DeniedFrame>
    );
  }

  if (module === "overview") {
    return <OverviewCommand email={view.email} />;
  }

  if (module === "settings") {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader
          eyebrow="Your account"
          title="Settings"
          description={`These settings belong to ${view.email}. Account administration is separate from this profile.`}
        />
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          <li className="px-4 py-4">
            <h2 className="text-sm font-semibold">Email</h2>
            <p className="mt-1 text-sm text-muted">{view.email}</p>
          </li>
          <li className="px-4 py-4">
            <h2 className="text-sm font-semibold">Wolf password</h2>
            <p className="mt-1 text-sm text-muted">
              <a href="/account/password" className="text-foreground underline decoration-line underline-offset-4">
                Change the Wolf password
              </a>
            </p>
          </li>
          {view.canAdminister ? (
            <li className="px-4 py-4">
              <h2 className="text-sm font-semibold">Account administration</h2>
              <p className="mt-1 text-sm leading-6 text-muted">
                An administrator membership can provision accounts with the local command. That command does not send email and does not list passwords here.
              </p>
            </li>
          ) : null}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Access check" title={title} description={description} />
      <EmptyState title={emptyTitle} body={emptyBody} />
      {view.records.length > 0 ? (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {view.records.map((record) => (
            <li key={record.id} className="px-4 py-4">
              <p className="text-sm font-medium">{record.title}</p>
              <p className="mt-1 text-sm text-muted">{record.companyId}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function DeniedFrame({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Access check" title={title} description={description} />
      {children}
    </div>
  );
}

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim() ?? "";
  return trimmed || null;
}
