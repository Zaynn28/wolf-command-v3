import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { loadActorContext } from "@/server/access/session-actor";
import { readAssistantHome } from "@/server/ai/gateway";
import { readAssistantSetup } from "@/server/ai/setup";
import { clearAssistantSetupAction, saveAssistantSetupAction } from "./actions";
import { AssistantDesk } from "./assistant-desk";

export default function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading the assistant…</p>}>
      <AssistantHome searchParams={searchParams} />
    </Suspense>
  );
}

async function AssistantHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const context = await loadActorContext();
  if (context.status === "signed_out") {
    return <Gate title="Sign in required" body="The assistant is available after a Wolf sign-in." href="/login" link="Go to sign in" />;
  }
  if (context.status === "password_change_required") {
    return <Gate title="Password change required" body="Change the Wolf password before using the assistant." href="/account/password" link="Change password" />;
  }
  if (context.status !== "ready") {
    return <Gate title="Assistant unavailable" body="The assistant fails closed until the signed-in account can be verified." />;
  }
  const home = await readAssistantHome(context.db, context.actor, first(params.companyId), first(params.conversation));
  if ("status" in home) return <Gate title="Assistant unavailable" body={home.error} />;
  const setup = await readAssistantSetup(context.db, context.actor, process.env);
  const configured = setup.ready;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Assistant"
        title="Command"
        description="One company at a time. Answers use organization records this account can already read. Finance and HR records are not connected."
      />
      {home.requestedCompanyDenied ? (
        <p className="rounded-md border border-line bg-surface px-4 py-3 text-sm">That company is not available for this account.</p>
      ) : null}
      <Notice notice={first(params.notice)} reason={first(params.reason)} />
      {setup.canConfigure ? (
        <AssistantSetupForm
          companyId={home.companyId}
          conversationId={home.conversationId}
          model={setup.model}
          source={setup.source}
        />
      ) : null}
      {!configured && !setup.canConfigure ? (
        <p className="rounded-md border border-line bg-surface px-4 py-3 text-sm">The assistant is unavailable until it is configured.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {home.companies.map((company) => (
          <Link
            key={company.id}
            href={`/assistant?companyId=${company.id}`}
            aria-current={company.id === home.companyId ? "page" : undefined}
            className={`rounded-md border px-3 py-2 text-sm ${company.id === home.companyId ? "border-foreground bg-surface" : "border-line text-muted"}`}
          >
            {company.name}
          </Link>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="flex flex-col gap-2">
          <Link href={`/assistant?companyId=${home.companyId}`} className="rounded-md border border-line bg-raised px-3 py-2 text-sm font-medium">
            New conversation
          </Link>
          {home.conversations.length === 0 ? <p className="px-1 text-sm text-muted">No conversations yet.</p> : null}
          {home.conversations.map((conversation) => (
            <Link
              key={conversation.id}
              href={`/assistant?companyId=${conversation.companyId}&conversation=${conversation.id}`}
              aria-current={conversation.id === home.conversationId ? "page" : undefined}
              className={`rounded-md border px-3 py-2 text-sm ${conversation.id === home.conversationId ? "border-foreground bg-surface" : "border-line text-muted"}`}
            >
              {conversation.title}
            </Link>
          ))}
        </aside>
        <div className="flex flex-col gap-4">
          {home.deniedConversation ? (
            <EmptyState title="Conversation unavailable" body="That conversation is not available for this session." />
          ) : null}
          {home.companyId ? (
            <AssistantDesk
              companyId={home.companyId}
              conversationId={home.deniedConversation ? null : home.conversationId}
              configured={configured}
              messages={home.deniedConversation ? [] : home.messages}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AssistantSetupForm({
  companyId,
  conversationId,
  model,
  source,
}: {
  companyId: string | null;
  conversationId: string | null;
  model: string;
  source: "portal" | "environment" | "none";
}) {
  const field = "rounded-md border border-line bg-background px-3 py-2 text-sm";
  const status = source === "portal"
    ? "A key is saved for this portal. Leave the key blank to keep it and change only the model."
    : source === "environment"
      ? "The server already has a key. Saving a key here replaces it for this portal."
      : "Paste the xAI key to turn the assistant on for this portal.";
  return (
    <form action={saveAssistantSetupAction} className="flex max-w-xl flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-4">
      <h2 className="text-sm font-semibold">Configuration</h2>
      <p className="text-sm text-muted">{status}</p>
      <input type="hidden" name="companyId" value={companyId ?? ""} />
      <input type="hidden" name="conversation" value={conversationId ?? ""} />
      <label className="flex flex-col gap-1 text-sm">
        Model
        <input name="model" defaultValue={model} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        xAI key
        <input name="apiKey" type="password" autoComplete="off" placeholder={source === "portal" ? "Leave blank to keep the saved key" : "Paste the xAI key"} className={field} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="rounded-md bg-foreground px-3 py-2 text-sm text-background">Save</button>
        {source === "portal" ? (
          <button type="submit" formAction={clearAssistantSetupAction} className="rounded-md border border-line px-3 py-2 text-sm">Remove saved key</button>
        ) : null}
      </div>
    </form>
  );
}

function Notice({ notice, reason }: { notice: string | null; reason: string | null }) {
  if (notice === "saved") return <p className="rounded-md border border-line bg-surface px-4 py-3 text-sm">The assistant configuration was saved.</p>;
  if (notice === "cleared") return <p className="rounded-md border border-line bg-surface px-4 py-3 text-sm">The saved key was removed.</p>;
  if (notice === "denied") return <p className="rounded-md border border-line bg-surface px-4 py-3 text-sm">That change was refused.</p>;
  if (notice === "invalid") return <p className="rounded-md border border-line bg-surface px-4 py-3 text-sm">{reason || "The assistant configuration was not saved."}</p>;
  return null;
}

function Gate({ title, body, href, link }: { title: string; body: string; href?: string; link?: string }) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Assistant" title={title} description={body} />
      <EmptyState title={title} body={body} />
      {href && link ? <Link href={href} className="text-sm underline decoration-line underline-offset-4">{link}</Link> : null}
    </div>
  );
}

function first(value: string | string[] | undefined): string | null {
  const item = Array.isArray(value) ? value[0] : value;
  return item && item.trim() !== "" ? item : null;
}
