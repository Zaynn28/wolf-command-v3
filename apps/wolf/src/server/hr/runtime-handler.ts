import { randomBytes } from "node:crypto";
import {
  hrAssertionCookie,
  hrAssertionCookieSecure,
  hrEmbeddedSession,
  readHrAssertionCookie,
  readSignedHrAssertion,
  resolveHrAssertionSecret,
  signHrAssertion,
  verifyHrAssertion,
} from "./assertion";
import type { HrCompanyDecision } from "./companies";
import {
  classifyHrProxyPath,
  hrisApiOrigin,
  hrisRuntimeOrigin,
  hrApiForwardHeaders,
  hrProtectedDecision,
  hrProxySearch,
  hrResponseHeaders,
  hrUpstreamHeaders,
  normalizeHrProxyPath,
  rewriteHrisRuntimeText,
  type HrActorGate,
} from "./hris-proxy";

export type HrRuntimeOutcome = "allow" | "denied" | "assertion_rejected" | null;

export type HrRuntimeExecution = {
  response: Response;
  outcome: HrRuntimeOutcome;
};

function hrJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: hrResponseHeaders("application/json; charset=utf-8") });
}

/** Employee self-service may file its own profile request. The employee directory and payroll stay closed. */
export function employeeSelfServiceApi(access: string, path: string, method: string): boolean {
  if (access !== "employee") return true;
  if (method === "GET" || method === "HEAD") {
    return (
      path === "/api/health" ||
      path === "/api/self/profile" ||
      path === "/api/departments" ||
      path === "/api/positions" ||
      path === "/api/profile-change-requests" ||
      /^\/api\/employees\/[^/]+\/photo$/.test(path) ||
      /^\/api\/profile-change-requests\/[^/]+\/photo$/.test(path)
    );
  }
  return method === "POST" && path === "/api/profile-change-requests";
}

export async function executeHrRuntime(input: {
  request: Request;
  companyId: string;
  path: string;
  prefix: string;
  actorStatus: HrActorGate;
  companyOpen: boolean;
  hrAccess: "administrator" | "staff" | "employee" | null;
  userId: string | null;
  email: string | null;
  env: Record<string, string | undefined>;
  nowSeconds: number;
  fetchImpl?: typeof fetch;
}): Promise<HrRuntimeExecution> {
  const incoming = new URL(input.request.url);
  const targetPath = normalizeHrProxyPath(`/${input.path}`);
  const search = hrProxySearch(incoming.search);
  const operation = !targetPath || search === null ? "refused" : classifyHrProxyPath(targetPath, input.env.NODE_ENV === "production" ? "production" : "development");
  const secret = resolveHrAssertionSecret(input.env);
  const assertionToken = readHrAssertionCookie(input.request.headers.get("cookie"));
  const signed = assertionToken && secret ? readSignedHrAssertion(assertionToken, secret) : null;
  const assertion =
    (operation === "session" || operation === "api") && secret && input.actorStatus === "ready" && input.userId
      ? verifyHrAssertion(assertionToken ?? "", secret, input.nowSeconds, {
          userId: input.userId,
          companyId: input.companyId,
        })
      : null;
  const otherCompanyAssertion = operation === "session" && signed !== null && signed.companyId !== input.companyId;
  const decision = hrProtectedDecision({
    actorStatus: input.actorStatus,
    companyOpen: input.companyOpen,
    operation,
    method: input.request.method,
    assertionAccepted: operation === "session" ? !otherCompanyAssertion : assertion !== null,
  });
  if (decision.status !== 200) {
    const outcome = decision.reason === "assertion" ? "assertion_rejected" : "denied";
    console.info(JSON.stringify({ event: decision.reason === "api" ? "hr_api" : "hr_access", companyId: input.companyId, outcome, module: "hr" }));
    const error =
      decision.reason === "api"
        ? "HR records are not connected for this company."
        : decision.reason === "path" || decision.reason === "method"
          ? "That HR operation is blocked."
          : "HR is not available for this session.";
    return { response: hrJson(decision.status, { error }), outcome };
  }
  const opened: HrCompanyDecision =
    input.companyOpen && input.hrAccess && (input.companyId === "amg" || input.companyId === "bzg" || input.companyId === "ggv")
      ? { status: "unlinked", companyId: input.companyId, orgId: input.companyId === "amg" ? "AMG" : input.companyId === "bzg" ? "BZG" : "GGV", access: input.hrAccess }
      : { status: "denied" };
  if (!secret || !targetPath || search === null || opened.status !== "unlinked" || input.actorStatus !== "ready" || !input.userId || !input.email) {
    return { response: hrJson(503, { error: "HR sign-in is not configured." }), outcome: null };
  }

  if (operation === "session") {
    const token = signHrAssertion(secret, {
      sub: input.userId,
      companyId: opened.companyId,
      iat: input.nowSeconds,
      jti: randomBytes(16).toString("base64url"),
      workspace: opened.access === "employee" ? "self" : "hr",
    });
    const fresh = verifyHrAssertion(token, secret, input.nowSeconds, { userId: input.userId, companyId: input.companyId });
    const session = hrEmbeddedSession(opened, fresh, input.email);
    const outcome = session.status === 200 ? "allow" : "assertion_rejected";
    console.info(JSON.stringify({ event: "hr_session", companyId: input.companyId, outcome, module: "hr" }));
    const headers = hrResponseHeaders("application/json; charset=utf-8");
    if (session.status === 200) {
      headers.append("set-cookie", hrAssertionCookie(token, opened.companyId, hrAssertionCookieSecure(input.env, incoming.protocol)));
    }
    return { response: new Response(JSON.stringify(session.body), { status: session.status, headers }), outcome };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  if (operation === "api" && opened.status === "unlinked" && !employeeSelfServiceApi(opened.access, targetPath, input.request.method)) {
    return { response: hrJson(403, { error: "That HR operation is blocked." }), outcome: "denied" };
  }
  if (operation === "api") {
    const apiOrigin = hrisApiOrigin(input.env);
    if (!apiOrigin || !assertion || !assertionToken) {
      return { response: hrJson(503, { error: "The HR API origin is refused." }), outcome: null };
    }
    let body: ArrayBuffer | undefined;
    if (input.request.method !== "GET" && input.request.method !== "HEAD") {
      body = await input.request.arrayBuffer();
      if (body.byteLength > 1_000_000) {
        return { response: hrJson(413, { error: "That HR operation is blocked." }), outcome: "denied" };
      }
    }
    let apiUpstream: Response;
    try {
      apiUpstream = await fetchImpl(`${apiOrigin}${targetPath}${search}`, {
        method: input.request.method,
        headers: hrApiForwardHeaders(input.request.headers, assertionToken),
        body: body && body.byteLength > 0 ? body : undefined,
        redirect: "manual",
      });
    } catch {
      return { response: hrJson(503, { error: "The HR API is not running on 127.0.0.1:3012." }), outcome: null };
    }
    if (apiUpstream.status >= 300 && apiUpstream.status < 400) {
      return { response: hrJson(403, { error: "The HR runtime redirect was refused." }), outcome: "denied" };
    }
    const apiType = apiUpstream.headers.get("content-type") ?? "application/json";
    return {
      response: new Response(apiUpstream.body, { status: apiUpstream.status, headers: hrResponseHeaders(apiType) }),
      outcome: apiUpstream.status < 400 ? "allow" : "denied",
    };
  }

  const origin = hrisRuntimeOrigin(input.env);
  if (!origin) return { response: hrJson(503, { error: "The HR runtime origin is refused." }), outcome: null };

  let upstream: Response;
  try {
    upstream = await fetchImpl(`${origin}${targetPath}${search}`, {
      method: input.request.method,
      headers: hrUpstreamHeaders(input.request.headers),
      redirect: "manual",
    });
  } catch {
    return { response: hrJson(503, { error: "The HR application is not running on 127.0.0.1:3011." }), outcome: null };
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    return { response: hrJson(403, { error: "The HR runtime redirect was refused." }), outcome: "denied" };
  }

  const upstreamType = upstream.headers.get("content-type") ?? "";
  const textual = /text\/html|javascript|text\/css/.test(upstreamType) || /\.(?:html|js|mjs|css|tsx|ts)$/.test(targetPath);
  const headers = hrResponseHeaders(textual ? upstreamType || "text/plain; charset=utf-8" : upstreamType);
  const html = /text\/html/.test(upstreamType) || targetPath === "/" || targetPath === "";
  if (html && input.request.method === "GET") {
    const token = signHrAssertion(secret, {
      sub: input.userId,
      companyId: opened.companyId,
      iat: input.nowSeconds,
      jti: randomBytes(16).toString("base64url"),
      workspace: opened.access === "employee" ? "self" : "hr",
    });
    headers.append("set-cookie", hrAssertionCookie(token, opened.companyId, hrAssertionCookieSecure(input.env, incoming.protocol)));
  }
  if (!textual) {
    return { response: new Response(upstream.body, { status: upstream.status, headers }), outcome: null };
  }
  let text = rewriteHrisRuntimeText(await upstream.text(), input.prefix);
  if (html) {
    text = text.replace("<div id=\"root\"></div>", `<script>window.__WOLF_HR_EMBEDDED__=true</script><div id="root"></div>`);
  }
  return { response: new Response(text, { status: upstream.status, headers }), outcome: null };
}
