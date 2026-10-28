import { deniedFinanceHideLabels, financeFeatureGrant, financeGrantHideScript, financeWorkspaceWithGrants, operatingGrantEffect, readOperatingEnforcement } from "../access/operating-grants";
import { loadActorContext } from "../access/session-actor";
import {
  amgProxyDecision,
  amgProxySearch,
  amgRuntimeOrigin,
  amgSessionBootstrap,
  bzgStandardBooks,
  procurementModuleLock,
  procurementRuntimeAllowed,
  amgUpstreamHeaders,
  financeApiModule,
  isolatedCompanyResult,
  procurementBlockedResult,
  normalizeAmgProxyPath,
  redactAmgStatus,
  rewriteAmgRuntimeText,
  scrubAmgPayload,
  amgJournalReadsProcessMemory,
  usesAmgProcessMemory,
} from "./amg-proxy";
import { financeModuleIsEnabled, type FinanceModuleId } from "./modules";
import {
  deactivateChartAccount,
  deleteChartAccount,
  readChartAccounts,
  saveChartAccount,
  seedChartAccounts,
} from "./chart-accounts";
import {
  atriumJournalRoute,
  createAtriumDraftJournal,
  deleteAtriumDraftJournal,
  journalIdFromPath,
  journalLifecycleUnavailable,
  readAtriumDraftJournal,
  readAtriumDraftJournals,
} from "./atrium-draft-journals";
import {
  atriumCycleRoute,
  createRevenueDocument,
  createSpendingDocument,
  readRevenueDocuments,
  readSpendingDocuments,
} from "./atrium-revenue-spending";
import { readMappingConfiguration, saveMappingConfiguration } from "./mapping-configuration";
import { readOperatingDepartments, saveOperatingDepartment } from "./operating-departments";
import { injectWolfFinanceTheme } from "./wolf-finance-theme";

export async function serveFinanceRuntime(request: Request, companyId: string, path: string, prefix: string): Promise<Response> {
  const actorContext = await loadActorContext();
  const enforcement = actorContext.status === "ready"
    ? await readOperatingEnforcement(actorContext.db, actorContext.actor.userId)
    : { assignments: [], grants: [] };
  const workspace = actorContext.status === "ready" ? financeWorkspaceWithGrants(actorContext.actor, companyId, enforcement) : null;
  if (actorContext.status !== "ready" || !workspace) {
    return Response.json({ error: "Finance is not available for this session." }, { status: 403 });
  }
  if (!(await financeModuleIsEnabled(actorContext.db, companyId, "atrium-workflows"))) {
    return Response.json({ error: "Finance is not enabled for this company." }, { status: 403 });
  }
  if (workspace === "procurement" && !(await financeModuleIsEnabled(actorContext.db, companyId, "procurement"))) {
    return Response.json({ error: "Procurement is not enabled for this company." }, { status: 403 });
  }
  const origin = amgRuntimeOrigin(process.env);
  if (!origin) return Response.json({ error: "The Finance runtime origin is refused." }, { status: 503 });

  const incoming = new URL(request.url);
  const targetPath = normalizeAmgProxyPath(`/${path}`);
  const search = amgProxySearch(incoming.search);
  if (!targetPath || search === null || amgProxyDecision(targetPath) === "block") {
    return Response.json({ error: "That Finance operation is blocked." }, { status: 403 });
  }

  if (workspace === "application") {
    const feature = financeFeatureGrant(targetPath);
    if (feature && operatingGrantEffect(enforcement.assignments, enforcement.grants, companyId, feature) === "deny") {
      return Response.json({ error: "That Finance feature is not granted for this role." }, { status: 403 });
    }
  }
  if (workspace === "procurement" && !procurementRuntimeAllowed(targetPath)) {
    const blocked = procurementBlockedResult(request.method, targetPath);
    return Response.json(blocked.body, { status: blocked.status });
  }
  const apiModule = financeApiModule(`${targetPath}${search}`);
  if (workspace === "application" && apiModule && !(await financeModuleIsEnabled(actorContext.db, companyId, apiModule as FinanceModuleId))) {
    return Response.json({ error: "That Finance feature is not enabled for this company." }, { status: 403 });
  }

  if (targetPath === "/api/departments") {
    return serveOperatingDepartments(request, actorContext.db, actorContext.actor, companyId);
  }
  if (targetPath === "/api/mapping") {
    return serveMappingConfiguration(request, actorContext.db, actorContext.actor, companyId);
  }
  // The chart API is company-scoped. Reports, inventory, receivables, and
  // payables keep their own stores until those records are migrated.
  if (targetPath === "/api/accounts" || targetPath.startsWith("/api/accounts/")) {
    return serveChartAccounts(request, actorContext.db, actorContext.actor, companyId, targetPath);
  }
  const journalAction = atriumJournalRoute(request.method, targetPath);
  if (journalAction && !amgJournalReadsProcessMemory(companyId, journalAction)) {
    return serveAtriumDraftJournals(request, actorContext.db, actorContext.actor, actorContext.email, companyId, targetPath, journalAction);
  }
  const cycleAction = atriumCycleRoute(request.method, targetPath);
  if (cycleAction) {
    return serveAtriumCycles(request, actorContext.db, actorContext.actor, actorContext.email, companyId, cycleAction);
  }

  if (targetPath.startsWith("/api/") && !usesAmgProcessMemory(companyId)) {
    const isolated = isolatedCompanyResult(request.method, `${targetPath}${search}`, companyId);
    return Response.json(isolated.body, { status: isolated.status });
  }

  const headers = amgUpstreamHeaders(request.headers, actorContext.email);
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  let upstream: Response;
  try {
    upstream = await fetch(`${origin}${targetPath}${search}`, { method: request.method, headers, body, redirect: "manual" });
  } catch {
    return Response.json({ error: "The Finance application is not running on 127.0.0.1:3099." }, { status: 503 });
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    return Response.json({ error: "The Finance runtime redirect was refused." }, { status: 403 });
  }

  if (targetPath === "/api/status") {
    const payload = await upstream.json().catch(() => ({}));
    return Response.json(redactAmgStatus(payload), { status: upstream.status });
  }

  const upstreamType = upstream.headers.get("content-type") ?? "";
  const textual = /text\/html|javascript|text\/css|json/.test(upstreamType) || /\.(?:html|js|mjs|css|tsx|ts)$/.test(targetPath);
  if (/json/.test(upstreamType)) {
    const payload = await upstream.json().catch(() => ({}));
    return Response.json(scrubAmgPayload(payload), { status: upstream.status });
  }
  if (!textual) {
    return new Response(upstream.body, { status: upstream.status, headers: { "content-type": upstreamType } });
  }
  let text = await upstream.text();
  if (/text\/html/.test(upstreamType) || targetPath === "/" || targetPath === "") {
    const books = companyId === "bzg" ? bzgStandardBooks() : "";
    const hide = financeGrantHideScript(deniedFinanceHideLabels(enforcement, companyId));
    const bootstrap = `${amgSessionBootstrap()}${books}${workspace === "procurement" ? procurementModuleLock() : ""}${hide}`;
    text = text.includes("<head>")
      ? text.replace("<head>", `<head>${bootstrap}`)
      : text.replace("<div id=\"root\"></div>", `${bootstrap}<div id="root"></div>`);
    text = injectWolfFinanceTheme(text);
  }
  text = rewriteAmgRuntimeText(text, prefix, companyId);
  return new Response(text, { status: upstream.status, headers: { "content-type": upstreamType || "text/plain; charset=utf-8" } });
}

async function serveOperatingDepartments(
  request: Request,
  db: Parameters<typeof readOperatingDepartments>[0],
  actor: Parameters<typeof readOperatingDepartments>[1],
  companyId: string,
): Promise<Response> {
  if (request.method === "GET" || request.method === "HEAD") {
    const result = await readOperatingDepartments(db, actor, companyId);
    if (result.status === "denied") return Response.json({ error: "Finance is not available for this company." }, { status: 403 });
    return Response.json(result.departments);
  }
  if (request.method !== "POST") return Response.json({ error: "That department operation is not available." }, { status: 405 });
  let payload: { department_code?: unknown; department_name?: unknown; active?: unknown };
  try {
    const parsed = JSON.parse(await request.text()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return Response.json({ error: "A department needs a code and a name." }, { status: 400 });
    }
    payload = parsed;
  } catch {
    return Response.json({ error: "A department needs a code and a name." }, { status: 400 });
  }
  const saved = await saveOperatingDepartment(db, actor, companyId, payload, new Date());
  if (saved.status === "denied") return Response.json({ error: "Finance is not available for this company." }, { status: 403 });
  if (saved.status === "invalid") return Response.json({ error: saved.reason }, { status: 400 });
  return Response.json(saved.department);
}

async function serveMappingConfiguration(
  request: Request,
  db: Parameters<typeof readMappingConfiguration>[0],
  actor: Parameters<typeof readMappingConfiguration>[1],
  companyId: string,
): Promise<Response> {
  if (request.method === "GET" || request.method === "HEAD") {
    const result = await readMappingConfiguration(db, actor, companyId);
    if (result.status === "denied") return Response.json({ error: "Finance is not available for this company." }, { status: 403 });
    return Response.json(result.configuration);
  }
  if (request.method !== "POST") return Response.json({ error: "That mapping operation is not available." }, { status: 405 });
  let payload: unknown;
  try {
    payload = JSON.parse(await request.text()) as unknown;
  } catch {
    return Response.json({ error: "Mapping configuration is not valid." }, { status: 400 });
  }
  const saved = await saveMappingConfiguration(db, actor, companyId, payload, new Date());
  if (saved.status === "denied") return Response.json({ error: "Finance is not available for this company." }, { status: 403 });
  if (saved.status === "invalid") return Response.json({ error: saved.reason }, { status: 400 });
  return Response.json(saved.configuration);
}

async function serveChartAccounts(
  request: Request,
  db: Parameters<typeof readChartAccounts>[0],
  actor: Parameters<typeof readChartAccounts>[1],
  companyId: string,
  targetPath: string,
): Promise<Response> {
  const denied = Response.json({ error: "Finance is not available for this company." }, { status: 403 });
  if (targetPath === "/api/accounts") {
    if (request.method === "GET" || request.method === "HEAD") {
      const result = await readChartAccounts(db, actor, companyId);
      if (result.status === "denied") return denied;
      return Response.json(result.accounts);
    }
    if (request.method !== "POST") return Response.json({ error: "That account operation is not available." }, { status: 405 });
    let payload: unknown;
    try {
      payload = JSON.parse(await request.text()) as unknown;
    } catch {
      return Response.json({ error: "Account code, name, type, and normal balance are required." }, { status: 400 });
    }
    const saved = await saveChartAccount(db, actor, companyId, payload, new Date());
    if (saved.status === "denied") return denied;
    if (saved.status === "invalid" || saved.status === "blocked") return Response.json({ error: saved.reason }, { status: 400 });
    return Response.json(saved.account);
  }
  if (targetPath === "/api/accounts/deactivate") {
    if (request.method !== "POST") return Response.json({ error: "That account operation is not available." }, { status: 405 });
    const result = await deactivateChartAccount(db, actor, companyId);
    if (result.status === "denied") return denied;
    return Response.json({ error: result.reason }, { status: 400 });
  }
  if (targetPath === "/api/accounts/seed-usali") {
    if (request.method !== "POST") return Response.json({ error: "That account operation is not available." }, { status: 405 });
    const result = await seedChartAccounts(db, actor, companyId);
    if (result.status === "denied") return denied;
    return Response.json({ error: result.reason }, { status: 400 });
  }
  const code = targetPath.slice("/api/accounts/".length);
  if (!code || code.includes("/")) return Response.json({ error: "That account operation is not available." }, { status: 403 });
  if (request.method !== "DELETE") return Response.json({ error: "That account operation is not available." }, { status: 405 });
  const result = await deleteChartAccount(db, actor, companyId);
  if (result.status === "denied") return denied;
  return Response.json({ error: result.reason }, { status: 400 });
}

async function serveAtriumDraftJournals(
  request: Request,
  db: Parameters<typeof readAtriumDraftJournals>[0],
  actor: Parameters<typeof readAtriumDraftJournals>[1],
  email: string,
  companyId: string,
  targetPath: string,
  action: "list" | "create" | "read" | "remove" | "unavailable",
): Promise<Response> {
  const denied = Response.json({ error: "Finance is not available for this company." }, { status: 403 });
  if (action === "unavailable") return Response.json({ error: journalLifecycleUnavailable }, { status: 403 });
  if (action === "list") {
    const result = await readAtriumDraftJournals(db, actor, companyId);
    if (result.status === "denied") return denied;
    return Response.json(result.journals);
  }
  if (action === "create") {
    let payload: unknown;
    try {
      payload = JSON.parse(await request.text()) as unknown;
    } catch {
      return Response.json({ error: "A draft journal needs a header and lines." }, { status: 400 });
    }
    const saved = await createAtriumDraftJournal(db, actor, companyId, email, payload, new Date());
    if (saved.status === "denied") return denied;
    if (saved.status === "invalid") return Response.json({ error: saved.reason }, { status: 400 });
    return Response.json(saved.journal);
  }
  const journalId = journalIdFromPath(targetPath);
  if (!journalId) return Response.json({ error: "Journal not found" }, { status: 404 });
  if (action === "read") {
    const result = await readAtriumDraftJournal(db, actor, companyId, journalId);
    if (result.status === "denied") return denied;
    if (result.status === "missing") return Response.json({ error: "Journal not found" }, { status: 404 });
    return Response.json(result.journal);
  }
  const removed = await deleteAtriumDraftJournal(db, actor, companyId, journalId, new Date());
  if (removed.status === "denied") return denied;
  if (removed.status === "missing") return Response.json({ error: "Journal not found" }, { status: 404 });
  if (removed.status === "linked") return Response.json({ error: removed.reason }, { status: 400 });
  return Response.json({ success: true });
}

async function serveAtriumCycles(
  request: Request,
  db: Parameters<typeof readRevenueDocuments>[0],
  actor: Parameters<typeof readRevenueDocuments>[1],
  email: string,
  companyId: string,
  action: "revenue-list" | "revenue-create" | "spending-list" | "spending-create" | "unavailable",
): Promise<Response> {
  const denied = Response.json({ error: "Finance is not available for this company." }, { status: 403 });
  if (action === "unavailable") return Response.json({ error: "That revenue or spending operation is not available." }, { status: 403 });
  if (action === "revenue-list" || action === "spending-list") {
    const result = action === "revenue-list" ? await readRevenueDocuments(db, actor, companyId) : await readSpendingDocuments(db, actor, companyId);
    if (result.status === "denied") return denied;
    return Response.json(result.documents);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await request.text()) as unknown;
  } catch {
    return Response.json({ error: action === "revenue-create" ? "The revenue document is not valid." : "The spending document is not valid." }, { status: 400 });
  }
  const saved = action === "revenue-create"
    ? await createRevenueDocument(db, actor, companyId, email, payload, new Date())
    : await createSpendingDocument(db, actor, companyId, email, payload, new Date());
  if (saved.status === "denied") return denied;
  if (saved.status === "invalid") return Response.json({ error: saved.reason }, { status: 400 });
  return Response.json({ transaction: saved.transaction, draftJournal: saved.draftJournal });
}
