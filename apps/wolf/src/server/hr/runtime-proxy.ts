import { clientIpFromHeaders } from "../auth/http";
import { fingerprintEmail } from "../auth/crypto";
import { writeAudit } from "../auth/audit";
import { loadActorContext } from "../access/session-actor";
import { openHrCompany } from "./companies";
import { hrisRuntimeOrigin, normalizeHrProxyPath, rewriteHrisRuntimeText } from "./hris-proxy";
import { executeHrRuntime } from "./runtime-handler";

export { hrisRuntimeOrigin, normalizeHrProxyPath, rewriteHrisRuntimeText };

async function auditHr(
  actorContext: Awaited<ReturnType<typeof loadActorContext>>,
  request: Request,
  companyId: string,
  outcome: "allow" | "denied" | "assertion_rejected",
): Promise<void> {
  if (actorContext.status !== "ready") return;
  try {
    await writeAudit(actorContext.db, {
      eventType: outcome === "allow" ? "authorization_allowed" : "authorization_denied",
      userId: actorContext.actor.userId,
      companyId,
      resourceType: "hr_screen",
      resourceId: companyId,
      emailFingerprint: fingerprintEmail(actorContext.email),
      ip: clientIpFromHeaders(request.headers),
      metadata: { module: "hr", action: "open_screen", outcome },
      createdAt: new Date(),
    });
  } catch {
    console.info(JSON.stringify({ event: "hr_audit_failed", companyId, outcome, module: "hr" }));
  }
}

export async function serveHrRuntime(request: Request, companyId: string, path: string, prefix: string): Promise<Response> {
  const actorContext = await loadActorContext();
  const opened = actorContext.status === "ready" ? openHrCompany(actorContext.actor, companyId) : { status: "denied" as const };
  const result = await executeHrRuntime({
    request,
    companyId,
    path,
    prefix,
    actorStatus: actorContext.status,
    companyOpen: opened.status === "unlinked",
    hrAccess: opened.status === "unlinked" ? opened.access : null,
    userId: actorContext.status === "ready" ? actorContext.actor.userId : null,
    email: actorContext.status === "ready" ? actorContext.email : null,
    env: process.env,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (result.outcome) await auditHr(actorContext, request, companyId, result.outcome);
  return result.response;
}
