const runtimePrefix = "/finance/amg-runtime";
const allowedOrigin = "http://127.0.0.1:3099";

const blockedPrefixes = [
  "/api/sheets",
  "/api/auth",
  "/api/admin/mock-data",
  "/api/admin/access-control",
  "/api/integrations",
];

const secretKey = /password|secret|token|privatekey|clientemail|spreadsheet|credential|cookie|authorization/i;

export function amgRuntimeOrigin(env: Record<string, string | undefined>): string | null {
  const value = env.WOLF_AMG_RUNTIME_ORIGIN ?? allowedOrigin;
  return value === allowedOrigin ? value : null;
}

export function normalizeAmgProxyPath(raw: string): string | null {
  const withoutQuery = raw.split("?")[0] ?? raw;
  let value = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  if (value.includes("\\") || value.includes("\0")) return null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) break;
      value = decoded;
    } catch {
      return null;
    }
  }
  if (!value.startsWith("/") || value.includes("..") || value.includes("\\") || value.includes("\0")) return null;
  return value.replace(/\/{2,}/g, "/");
}

export function amgProxySearch(search: string): string | null {
  if (search.length > 2048 || search.includes("\0") || search.includes("\r") || search.includes("\n")) return null;
  return search;
}

export function amgProxyDecision(pathname: string): "allow" | "block" {
  const path = normalizeAmgProxyPath(pathname);
  if (!path) return "block";
  const lower = path.toLowerCase();
  return blockedPrefixes.some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`)) ? "block" : "allow";
}

export function amgUpstreamHeaders(incoming: Headers, email: string): Headers {
  const headers = new Headers();
  const contentType = incoming.get("content-type");
  if (contentType && !/[\r\n]/.test(contentType)) headers.set("content-type", contentType);
  if (email && !/[\r\n]/.test(email)) headers.set("x-user-name", email);
  return headers;
}

export function scrubAmgPayload(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload.map((item) => scrubAmgPayload(item));
  if (!payload || typeof payload !== "object") {
    if (typeof payload === "string" && /BEGIN PRIVATE KEY|GOOGLE_|service account/i.test(payload)) return null;
    return payload;
  }
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (secretKey.test(key.replace(/[_-]/g, ""))) continue;
    scrubbed[key] = scrubAmgPayload(value);
  }
  return scrubbed;
}

const financeHeaderNames: Record<string, string> = {
  amg: "AMG Finance",
  bzg: "BZG Finance",
  ggv: "GGV Finance",
};

const atriumHeaderClass = "font-extrabold text-slate-900 tracking-tight text-sm uppercase truncate";
const atriumHeaderPattern = new RegExp(`${atriumHeaderClass.replaceAll(" ", "\\s+")}([\\s\\S]{0,240}?)PT ATRIUM MANAGEMENT GROUP`);

export function rewriteAmgRuntimeText(body: string, prefix = runtimePrefix, companyId?: string): string {
  const headerName = companyId ? financeHeaderNames[companyId] : undefined;
  const withHeader = headerName
    ? body.replace(atriumHeaderPattern, `${atriumHeaderClass.replace(" uppercase", "")}$1${headerName}`)
    : body;
  return withHeader
    .replaceAll("'/api/", `'${prefix}/api/`)
    .replaceAll('"/api/', `"${prefix}/api/`)
    .replaceAll("`/api/", `\`${prefix}/api/`)
    .replaceAll('src="/', `src="${prefix}/`)
    .replaceAll("src='/", `src='${prefix}/`)
    .replaceAll('href="/@', `href="${prefix}/@`)
    .replaceAll('href="/src', `href="${prefix}/src`)
    .replaceAll('from "/', `from "${prefix}/`)
    .replaceAll("from '/", `from '${prefix}/`)
    .replaceAll('import "/', `import "${prefix}/`)
    .replaceAll("import '/", `import '${prefix}/`)
    .replaceAll('import("/', `import("${prefix}/`)
    .replaceAll("import('/", `import('${prefix}/`);
}

const emptyListPaths = new Set([
  "/api/accounts",
  "/api/departments",
  "/api/journals",
  "/api/revenue",
  "/api/spending",
  "/api/controls/exceptions",
  "/api/inventory/categories",
  "/api/inventory/storerooms",
  "/api/inventory/items",
  "/api/inventory/receipts",
  "/api/inventory/requisitions",
  "/api/inventory/purchase-orders",
  "/api/inventory/counts",
  "/api/inventory/adjustments",
  "/api/inventory/movements",
  "/api/ar/items",
  "/api/ap/items",
  "/api/petty-cash/transactions",
  "/api/tax/rules",
  "/api/tax/obligations",
  "/api/tax/documents",
  "/api/owner-pool/units",
  "/api/owner-pool/batches",
  "/api/service-charge/employees",
  "/api/service-charge/cycles",
]);

export function financeApiModule(pathname: string): "inventory" | "service-charges" | "owner-pool" | "petty-cash" | "tax" | "hotel-operations" | null {
  const path = pathname.split("?")[0] ?? pathname;
  if (path.startsWith("/api/inventory") || path.startsWith("/api/ar/") || path.startsWith("/api/ap/")) return "inventory";
  if (path.startsWith("/api/service-charge")) return "service-charges";
  if (path.startsWith("/api/owner-pool")) return "owner-pool";
  if (path.startsWith("/api/petty-cash")) return "petty-cash";
  if (path.startsWith("/api/tax")) return "tax";
  if (path.startsWith("/api/revenue") || path.startsWith("/api/spending")) return "hotel-operations";
  return null;
}

export function usesAmgProcessMemory(companyId: string): boolean {
  return companyId === "amg";
}

export function isolatedCompanyResult(method: string, pathname: string): { status: number; body: unknown } {
  const path = pathname.split("?")[0] ?? pathname;
  if (method !== "GET" && method !== "HEAD") {
    return { status: 403, body: { error: "This company cannot use an AMG process-memory workflow." } };
  }
  if (path === "/api/status" || path === "/api/health") {
    return {
      status: 200,
      body: { status: "ok", connected: false, hasCredentials: false, spreadsheetId: null, clientEmail: null, error: null },
    };
  }
  if (emptyListPaths.has(path)) return { status: 200, body: [] };
  return { status: 200, body: { error: "No records are stored for this company workflow." } };
}

export function amgSessionBootstrap(): string {
  return `<script>try{localStorage.setItem("amg_auth_session","active")}catch(e){}</script>`;
}

export function procurementBlockedResult(method: string, path: string): { status: number; body: unknown } {
  if (method === "GET" || method === "HEAD") return isolatedCompanyResult("GET", path);
  return { status: 403, body: { error: "That Finance feature is not available for this account." } };
}

export function procurementActorAction(method: string, path: string): "read" | "update" | "delete" | "approve" {
  if (method === "DELETE") return "delete";
  if (/\/approve(?:\/|$)/.test(path)) return "approve";
  if (method === "GET" || method === "HEAD") return "read";
  return "update";
}

export function procurementRuntimeAllowed(path: string): boolean {
  const value = path.split("?")[0] ?? path;
  if (!value.startsWith("/api/")) return true;
  if (value === "/api/status" || value === "/api/health") return true;
  return value === "/api/inventory" || value.startsWith("/api/inventory/");
}

export function procurementModuleLock(): string {
  return `<script>(function(){var operations="nav-pillar-operations";var procurement="nav-operations-inventory";function hide(node){if(node&&node.style.display!=="none")node.style.display="none";}function openProcurement(){var pillars=document.querySelectorAll('[id^="nav-pillar-"]');for(var i=0;i<pillars.length;i++){if(pillars[i].id!==operations)hide(pillars[i]);}var ops=document.getElementById(operations);if(ops&&ops.className.indexOf("bg-slate-900")<0){ops.click();return;}hide(document.querySelector('button[title="Current authenticated user session"]'));var buttons=document.querySelectorAll("button");for(var j=0;j<buttons.length;j++){var button=buttons[j];if(button.id===procurement)continue;var text=button.textContent||"";if(text.indexOf("Revenue Cycle")>=0||text.indexOf("Spending Cycle")>=0||text.indexOf("Service Charge")>=0||text.indexOf("Petty Cash")>=0||text.indexOf("Switch Role")>=0)hide(button);}var item=document.getElementById(procurement);if(item&&item.className.indexOf("bg-slate-900")<0)item.click();}function start(){openProcurement();new MutationObserver(openProcurement).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:["class"]});}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start();})();</script>`;
}

export function redactAmgStatus(payload: unknown): Record<string, unknown> {
  const source = scrubAmgPayload(payload);
  const record = source && typeof source === "object" && !Array.isArray(source) ? (source as Record<string, unknown>) : {};
  return { ...record, connected: false, hasCredentials: false, spreadsheetId: null, clientEmail: null, error: null };
}
