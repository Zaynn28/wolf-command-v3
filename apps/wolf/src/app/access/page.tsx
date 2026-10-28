import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { loadActorContext } from "@/server/access/session-actor";
import { assignableCapabilities, capabilityById, unavailableCapabilities } from "@/server/access/policy-model";
import { previewCompanyAccess, readAccessDesk, simulateAccessDraft } from "@/server/access/policy-service";
import {
  assignAccessPositionAction,
  createAccessPositionAction,
  createAccessRoleAction,
  deactivateAccessRoleAction,
  duplicateAccessRoleAction,
  openAccessDraftAction,
  publishAccessDraftAction,
  removeDraftRowAction,
  rollbackAccessPolicyAction,
  saveAccessAssignmentAction,
  saveAccessExceptionAction,
  saveOperatingGrantsAction,
} from "./actions";

const field = "rounded-md border border-line bg-background px-3 py-2 text-sm";
const panel = "flex flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-4";

export default function AccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Checking access…</p>}>
      <AccessScreen searchParams={searchParams} />
    </Suspense>
  );
}

async function AccessScreen({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const context = await loadActorContext();
  if (context.status === "signed_out") {
    return <Denied title="Sign in required" body="Access policies are available after a Wolf sign-in." />;
  }
  if (context.status !== "ready") {
    return <Denied title="Access unavailable" body="The page fails closed until the signed-in account can be verified." />;
  }
  const desk = await readAccessDesk(context.db, context.actor, first(params.companyId));
  if (desk.status === "denied") {
    return <Denied title="Administrator access required" body="A staff membership does not open access policies." />;
  }
  const companyId = desk.company?.id ?? "";
  const account = first(params.account) ?? "";
  const view = first(params.view);
  const now = new Date();
  const preview = companyId && account && view === "preview"
    ? await previewCompanyAccess(context.db, context.actor, companyId, account, now)
    : null;
  const simulation = companyId && account && view === "simulate"
    ? await simulateAccessDraft(context.db, context.actor, companyId, account, now)
    : null;
  const activeRoles = desk.roles.filter((role) => role.status === "active");
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Administration"
        title="Access"
        description="Positions name a job. Operating roles can grant or withhold interfaces, features, and approvals. A saved grant applies only after a person is assigned that role. People with no assignment keep their current membership."
      />
      <Notice notice={first(params.notice)} reason={first(params.reason)} />
      <div className="flex flex-wrap gap-2">
        {desk.companies.map((company) => (
          <Link
            key={company.id}
            href={`/access?companyId=${company.id}`}
            aria-current={company.id === companyId ? "page" : undefined}
            className={`rounded-md border px-3 py-2 text-sm ${company.id === companyId ? "border-foreground bg-surface" : "border-line text-muted"}`}
          >
            {company.name}
          </Link>
        ))}
      </div>
      {desk.company ? (
        <section className={panel}>
          <h2 className="text-sm font-semibold">Company policy</h2>
          <p className="text-sm text-muted">
            {desk.published ? `Published version ${desk.published.versionNumber}: ${desk.published.reason}` : "No published policy yet. Existing memberships stay in place."}
            {desk.draft ? ` Draft version ${desk.draft.versionNumber} is open: ${desk.draft.reason}` : ""}
          </p>
        </section>
      ) : (
        <EmptyState title="No administered company" body="This account has no administrator or owner membership." />
      )}
      {desk.operating ? (
        <section id="operating-system" className="flex flex-col gap-4" data-operating-profile={desk.operating.profile} data-operating-company={companyId}>
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Operating system</h2>
            <p className="text-sm text-muted">
              {desk.operating.profile === "hotel"
                ? "Hotel starter for AMG. Rooms, USALI, owner pool, integrations, service charge, night audit, PMS, and guest ledger can be granted here. They are not Owner Private."
                : "Neutral starter. People, finance, procurement, and operations. USALI, owner pool, and Rooms are not offered."}
            </p>
            <p className="text-sm text-muted">
              Each switch is saved for this company and role. It does not replace staff, administrator, or owner, and it does not change who can sign in. Nobody is assigned an operating role until you assign one, so current memberships stay as they are.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {desk.operating.units.map((unit) => (
              <section key={unit.code} className={panel}>
                <h3 className="text-sm font-semibold">{unit.name}</h3>
                <p className="text-sm text-muted">{unit.summary}</p>
                {unit.roles.length === 0 ? <p className="text-sm text-muted">No starter responsibility. This unit grants nothing.</p> : null}
                {unit.roles.map((role) => (
                  <div key={role.code} className="flex flex-col gap-2 border-t border-line pt-3">
                    <p className="text-sm font-medium">{role.name}</p>
                    <p className="text-sm text-muted">{role.summary}</p>
                    <p className="text-sm text-muted">
                      Existing check: {role.responsibilities.map((item) => item.capabilityLabel).join(", ") || "None"}
                    </p>
                    <GrantEditor companyId={companyId} roleCode={role.code} grants={role.grants} />
                  </div>
                ))}
              </section>
            ))}
          </div>
        </section>
      ) : null}
      <section className="grid gap-6 lg:grid-cols-2">
        <Catalog title="Enforced capabilities" items={assignableCapabilities.map((capability) => ({ id: capability.id, label: capability.label, detail: capability.description }))} />
        <Catalog title="Unavailable in this portal" items={unavailableCapabilities.map((capability) => ({ id: capability.id, label: capability.label, detail: capability.unavailableReason ?? capability.description }))} />
      </section>
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Roles</h2>
          {desk.roles.length === 0 ? <p className="text-sm text-muted">No roles yet.</p> : null}
          <ul className="flex flex-col gap-2">
            {desk.roles.map((role) => (
              <li key={role.id} className={panel}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{role.name} <span className="text-muted">{role.status}</span></p>
                  {role.status === "active" ? (
                    <div className="flex gap-2">
                      <form action={duplicateAccessRoleAction}>
                        <input type="hidden" name="companyId" value={companyId} />
                        <input type="hidden" name="roleId" value={role.id} />
                        <button type="submit" className="text-sm text-muted">Copy</button>
                      </form>
                      <form action={deactivateAccessRoleAction}>
                        <input type="hidden" name="companyId" value={companyId} />
                        <input type="hidden" name="roleId" value={role.id} />
                        <button type="submit" className="text-sm text-muted">Deactivate</button>
                      </form>
                    </div>
                  ) : null}
                </div>
                {role.description ? <p className="text-sm text-muted">{role.description}</p> : null}
                <p className="text-sm">{role.capabilityIds.map((id) => capabilityById(id)?.label ?? id).join(", ") || "No capabilities"}</p>
              </li>
            ))}
          </ul>
        </div>
        <form action={createAccessRoleAction} className={panel}>
          <h2 className="text-sm font-semibold">New role</h2>
          <input type="hidden" name="companyId" value={companyId} />
          <input name="name" placeholder="Role name" className={field} />
          <input name="description" placeholder="Description" className={field} />
          <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {assignableCapabilities.map((capability) => (
              <label key={capability.id} className="text-sm">
                <input type="checkbox" name="capabilityIds" value={capability.id} className="mr-2" />
                {capability.label}
              </label>
            ))}
          </div>
          <button type="submit" className="rounded-md bg-foreground px-3 py-2 text-sm text-background">Save role</button>
        </form>
      </section>
      {desk.company ? (
        <>
          <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold">Positions in {desk.company.name}</h2>
              <p className="text-sm text-muted">Holding a position does not change memberships or grants.</p>
              {desk.positions.length === 0 ? <p className="text-sm text-muted">No positions yet.</p> : null}
              <ul className="flex flex-col gap-2">
                {desk.positions.map((position) => {
                  const holders = desk.holders.filter((holder) => holder.positionId === position.id).map((holder) => holder.email);
                  const suggested = desk.roles.find((role) => role.id === position.suggestedRoleId)?.name;
                  return (
                    <li key={position.id} className={panel}>
                      <p className="text-sm font-medium">{position.name} <span className="text-muted">{position.status}</span></p>
                      <p className="text-sm text-muted">{position.departmentId ?? "Company"}{suggested ? ` · suggested ${suggested}` : ""}</p>
                      <p className="text-sm">{holders.length > 0 ? holders.join(", ") : "No holder"}</p>
                      {position.status === "active" ? (
                        <form action={assignAccessPositionAction} className="flex flex-wrap gap-2">
                          <input type="hidden" name="companyId" value={companyId} />
                          <input type="hidden" name="positionId" value={position.id} />
                          <input name="email" placeholder="Wolf account email" className={field} />
                          <button type="submit" className="rounded-md border border-line px-3 py-2 text-sm">Assign holder</button>
                        </form>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
            <form action={createAccessPositionAction} className={panel}>
              <h2 className="text-sm font-semibold">New position</h2>
              <input type="hidden" name="companyId" value={companyId} />
              <input name="name" placeholder="Position name" className={field} />
              <input name="description" placeholder="Description" className={field} />
              <select name="departmentId" className={field} defaultValue="">
                <option value="">Company, no department</option>
                {desk.departments.map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </select>
              <select name="suggestedRoleId" className={field} defaultValue="">
                <option value="">No suggested role</option>
                {activeRoles.map((role) => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
              <select name="reportsToId" className={field} defaultValue="">
                <option value="">No reporting position</option>
                {desk.positions.filter((position) => position.status === "active").map((position) => (
                  <option key={position.id} value={position.id}>{position.name}</option>
                ))}
              </select>
              <button type="submit" className="rounded-md bg-foreground px-3 py-2 text-sm text-background">Save position</button>
            </form>
          </section>
          <section className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold">Draft and publish</h2>
            {desk.draft ? null : (
              <form action={openAccessDraftAction} className={panel}>
                <input type="hidden" name="companyId" value={companyId} />
                <input name="reason" placeholder="Reason for the draft" className={field} />
                <button type="submit" className="rounded-md bg-foreground px-3 py-2 text-sm text-background">Open draft</button>
              </form>
            )}
            {desk.draft ? (
              <>
                {desk.assignments.length === 0 ? <p className="text-sm text-muted">The draft has no assignments yet.</p> : null}
                <ul className="flex flex-col gap-2">
                  {desk.assignments.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-4 py-3 text-sm">
                      <span>
                        {row.email} · {row.kind} · {row.effect}
                        {row.roleName ? ` · ${row.roleName}` : ""}
                        {row.capabilityId ? ` · ${capabilityById(row.capabilityId)?.label ?? row.capabilityId}` : ""}
                        {row.departmentId ? ` · ${row.departmentId}` : ""}
                        {row.expiresAt ? ` · until ${row.expiresAt}` : ""}
                      </span>
                      <form action={removeDraftRowAction}>
                        <input type="hidden" name="companyId" value={companyId} />
                        <input type="hidden" name="assignmentId" value={row.id} />
                        <button type="submit" className="text-muted">Remove</button>
                      </form>
                    </li>
                  ))}
                </ul>
                <div className="grid gap-4 lg:grid-cols-2">
                  <form action={saveAccessAssignmentAction} className={panel}>
                    <h3 className="text-sm font-semibold">Assign a role</h3>
                    <input type="hidden" name="companyId" value={companyId} />
                    <input name="email" placeholder="Wolf account email" className={field} />
                    <select name="roleId" className={field} defaultValue="">
                      <option value="">Role</option>
                      {activeRoles.map((role) => (
                        <option key={role.id} value={role.id}>{role.name}</option>
                      ))}
                    </select>
                    <select name="departmentId" className={field} defaultValue="">
                      <option value="">Department, when the role needs one</option>
                      {desk.departments.map((department) => (
                        <option key={department.id} value={department.id}>{department.name}</option>
                      ))}
                    </select>
                    <button type="submit" className="rounded-md border border-line px-3 py-2 text-sm">Save assignment</button>
                  </form>
                  <form action={saveAccessExceptionAction} className={panel}>
                    <h3 className="text-sm font-semibold">Temporary exception</h3>
                    <input type="hidden" name="companyId" value={companyId} />
                    <input name="email" placeholder="Wolf account email" className={field} />
                    <select name="capabilityId" className={field} defaultValue="">
                      <option value="">Enforced capability</option>
                      {assignableCapabilities.map((capability) => (
                        <option key={capability.id} value={capability.id}>{capability.label}</option>
                      ))}
                    </select>
                    <select name="effect" className={field} defaultValue="allow">
                      <option value="allow">Allow</option>
                      <option value="deny">Deny</option>
                    </select>
                    <select name="departmentId" className={field} defaultValue="">
                      <option value="">Department, when the capability needs one</option>
                      {desk.departments.map((department) => (
                        <option key={department.id} value={department.id}>{department.name}</option>
                      ))}
                    </select>
                    <input name="justification" placeholder="Justification" className={field} />
                    <input name="expiresOn" type="date" className={field} />
                    <button type="submit" className="rounded-md border border-line px-3 py-2 text-sm">Save exception</button>
                  </form>
                </div>
                <form action={publishAccessDraftAction} className={panel}>
                  <h3 className="text-sm font-semibold">Publish</h3>
                  <p className="text-sm text-muted">Publishing replaces policy memberships and grants for this company. The last administrator or owner cannot be removed.</p>
                  <input type="hidden" name="companyId" value={companyId} />
                  <input name="reason" placeholder="Reason to publish" className={field} defaultValue={desk.draft.reason} />
                  <button type="submit" className="rounded-md bg-foreground px-3 py-2 text-sm text-background">Publish draft</button>
                </form>
              </>
            ) : null}
          </section>
          <section className="grid gap-6 lg:grid-cols-2">
            <form className={panel} action="/access">
              <h2 className="text-sm font-semibold">Effective access</h2>
              <input type="hidden" name="companyId" value={companyId} />
              <input name="account" defaultValue={account} placeholder="Wolf account email" className={field} />
              <div className="flex gap-2">
                <button type="submit" name="view" value="preview" className="rounded-md border border-line px-3 py-2 text-sm">Preview published</button>
                <button type="submit" name="view" value="simulate" className="rounded-md border border-line px-3 py-2 text-sm">Simulate draft</button>
              </div>
              {preview?.status === "invalid" ? <p className="text-sm text-muted">{preview.reason}</p> : null}
              {preview?.status === "ok" ? (
                <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto text-sm">
                  {preview.lines.filter((line) => line.effective || line.availability === "unavailable").map((line) => (
                    <li key={line.capabilityId}>{line.label}: {line.effective ? "allowed" : "unavailable"} · {line.source}</li>
                  ))}
                </ul>
              ) : null}
              {simulation?.status === "invalid" ? <p className="text-sm text-muted">{simulation.reason}</p> : null}
              {simulation?.status === "ok" && simulation.errors.length > 0 ? <p className="text-sm text-muted">{simulation.errors[0]}</p> : null}
              {simulation?.status === "ok" && simulation.errors.length === 0 ? (
                <Simulation changes={simulation.changes.filter((change) => change.change !== "unchanged")} />
              ) : null}
            </form>
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold">Versions</h2>
              {desk.history.versions.length === 0 ? <p className="text-sm text-muted">No versions yet.</p> : null}
              <ul className="flex flex-col gap-2">
                {desk.history.versions.map((version) => (
                  <li key={version.id} className={panel}>
                    <p className="text-sm font-medium">Version {version.versionNumber} · {version.status}</p>
                    <p className="text-sm text-muted">{version.reason}</p>
                    <p className="text-sm text-muted">{version.author}{version.publishedAt ? ` · ${version.publishedAt}` : ""}</p>
                    {version.status !== "draft" ? (
                      <form action={rollbackAccessPolicyAction} className="flex flex-wrap gap-2">
                        <input type="hidden" name="companyId" value={companyId} />
                        <input type="hidden" name="versionId" value={version.id} />
                        <input name="reason" placeholder="Reason to restore this version" className={field} />
                        <button type="submit" className="rounded-md border border-line px-3 py-2 text-sm">Restore</button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function GrantEditor({
  companyId,
  roleCode,
  grants,
}: {
  companyId: string;
  roleCode: string;
  grants: Array<{
    code: string;
    app: string;
    appLabel: string;
    section: "features" | "approvals";
    label: string;
    detail: string;
    hotelOnly: boolean;
    enabled: boolean;
  }>;
}) {
  const apps: Array<{ app: string; label: string; features: typeof grants; approvals: typeof grants }> = [];
  for (const grant of grants) {
    let app = apps.find((item) => item.app === grant.app);
    if (!app) {
      app = { app: grant.app, label: grant.appLabel, features: [], approvals: [] };
      apps.push(app);
    }
    if (grant.section === "approvals") app.approvals.push(grant);
    else app.features.push(grant);
  }
  return (
    <form action={saveOperatingGrantsAction} className="flex flex-col gap-3" data-operating-role={roleCode}>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="roleCode" value={roleCode} />
      {apps.map((app) => (
        <fieldset key={app.app} className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{app.label}</legend>
          {app.features.map((grant) => (
            <GrantToggle key={grant.code} grant={grant} />
          ))}
          {app.approvals.length > 0 ? <p className="pt-1 text-sm font-medium">Approvals</p> : null}
          {app.approvals.map((grant) => (
            <GrantToggle key={grant.code} grant={grant} />
          ))}
        </fieldset>
      ))}
      <button type="submit" className="w-fit rounded-md border border-line px-3 py-2 text-sm">Save grants</button>
    </form>
  );
}

function GrantToggle({
  grant,
}: {
  grant: { code: string; label: string; detail: string; hotelOnly: boolean; enabled: boolean };
}) {
  return (
    <label className="flex items-start gap-2 text-sm" data-grant={grant.code}>
      <input type="hidden" name="offered" value={grant.code} />
      <input type="checkbox" name="enabled" value={grant.code} defaultChecked={grant.enabled} className="mt-1" />
      <span>
        <span>{grant.label}{grant.hotelOnly ? " · hotel" : ""}</span>
        <span className="block text-muted">{grant.detail}</span>
      </span>
    </label>
  );
}

function Simulation({ changes }: { changes: Array<{ label: string; before: string; after: string }> }) {
  return (
    <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto text-sm">
      {changes.length === 0 ? <li className="text-muted">The draft does not change this account.</li> : null}
      {changes.map((change) => (
        <li key={change.label}>{change.label}: {change.before} to {change.after}</li>
      ))}
    </ul>
  );
}

function Catalog({ title, items }: { title: string; items: Array<{ id: string; label: string; detail: string }> }) {
  return (
    <section className={panel}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
        {items.map((item) => (
          <li key={item.id}>
            <p className="text-sm font-medium">{item.label}</p>
            <p className="text-sm text-muted">{item.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Notice({ notice, reason }: { notice: string | null; reason: string | null }) {
  if (!notice) return null;
  const saved = notice === "role-saved" || notice === "role-copied" || notice === "position-saved" || notice === "position-assigned" || notice === "draft-open" || notice === "assignment-saved" || notice === "exception-saved" || notice === "assignment-removed" || notice === "published" || notice === "rolled-back" || notice === "role-inactive" || notice === "grants-saved";
  const body = notice === "denied"
    ? "That change was refused."
    : notice === "invalid"
      ? (reason || "That change was not saved.")
      : saved
        ? "Saved."
        : null;
  if (!body) return null;
  return <p className="rounded-md border border-line bg-surface px-4 py-3 text-sm">{body}</p>;
}

function Denied({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Administration" title="Access" description="Positions, roles, and company policies." />
      <EmptyState title={title} body={body} />
    </div>
  );
}

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.length > 0 ? raw : null;
}
