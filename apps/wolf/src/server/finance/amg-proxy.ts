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

// The AMG journal workbench is the Atrium screen. Posted journals live in that
// process, so list and read follow it. Create, delete, and the blocked
// lifecycle routes stay on the Wolf draft store. Other companies never read it.
export function amgJournalReadsProcessMemory(companyId: string, action: string): boolean {
  return companyId === "amg" && (action === "list" || action === "read");
}

function emptyPettyCashBalance(): Record<string, unknown> {
  return {
    float_limit: 0,
    current_balance: 0,
    pending_expenses_total: 0,
    pending_vouchers_count: 0,
    is_low_balance: false,
    total_reimbursed_ytd: 0,
    config: {
      account_name: "",
      gl_account_code: "",
      bank_replenishment_account: "",
      float_limit: 0,
      low_balance_threshold: 0,
      updated_at: "",
    },
  };
}

export function isolatedCompanyResult(method: string, pathname: string, companyId?: string): { status: number; body: unknown } {
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
  if (path === "/api/petty-cash/balance") return { status: 200, body: emptyPettyCashBalance() };
  const report = emptyIsolatedReport(path, companyId);
  if (report) return { status: 200, body: report };
  return { status: 200, body: { error: "No records are stored for this company workflow." } };
}

function reportLine(lineId: string, label: string) {
  return { line_id: lineId, label, amount: 0, account_codes: [] as string[], indent_level: 1 };
}

function emptyIsolatedReport(path: string, companyId?: string): Record<string, unknown> | null {
  if (path === "/api/reports/usali") {
    return {
      period: "All Time",
      property_name: "",
      currency: "IDR (Rp)",
      operating_revenue: [
        reportLine("USALI-REV-ROOMS", "Rooms Revenue"),
        reportLine("USALI-REV-FB", "Food & Beverage Revenue"),
        reportLine("USALI-REV-OTHER", "Other Operated Departments"),
        reportLine("USALI-REV-MISC", "Miscellaneous Income"),
      ],
      total_operating_revenue: 0,
      departmental_expenses: [
        reportLine("USALI-EXP-ROOMS", "Rooms Expenses"),
        reportLine("USALI-EXP-FB", "Food & Beverage Expenses"),
        reportLine("USALI-EXP-OTHER", "Other Operated Departments Expenses"),
      ],
      total_departmental_expenses: 0,
      total_departmental_profit: 0,
      undistributed_operating_expenses: [
        reportLine("USALI-UND-AG", "Administrative & General (A&G)"),
        reportLine("USALI-UND-POM", "Property Operation & Maintenance (POM)"),
        reportLine("USALI-UND-SM", "Sales & Marketing"),
        reportLine("USALI-UND-ENERGY", "Energy, Water & Waste (Utilities)"),
      ],
      total_undistributed_expenses: 0,
      gross_operating_profit: 0,
      management_fees: [reportLine("USALI-MGMT-FEES", "Base & Incentive Management Fees")],
      total_management_fees: 0,
      income_before_non_operating: 0,
      non_operating_expenses: [reportLine("USALI-NON-OP", "Non-Operating Income & Expenses")],
      total_non_operating_expenses: 0,
      ebitda: 0,
      schedules_summary: {
        rooms_revenue: 0,
        rooms_expense: 0,
        rooms_profit: 0,
        fb_revenue: 0,
        fb_expense: 0,
        fb_profit: 0,
        ag_expense: 0,
        pom_expense: 0,
        sm_expense: 0,
        energy_expense: 0,
      },
      reconciliation: {
        posted_revenue_total: 0,
        posted_expense_total: 0,
        report_revenue_total: 0,
        report_expense_total: 0,
        variance: 0,
        is_reconciled: true,
      },
    };
  }
  if (path === "/api/reports/financial-statements" && companyId === "bzg") {
    return {
      period: "All Time",
      property_name: "",
      currency: "IDR (Rp)",
      balance_sheet: {
        assets: [
          reportLine("BS-AST-CASH", "Cash & Cash Equivalents"),
          reportLine("BS-AST-RECEIVABLES", "Accounts Receivable"),
          reportLine("BS-AST-INVENTORY", "Inventories & Operating Supplies"),
          reportLine("BS-AST-PREPAID", "Prepaid Expenses & Security Deposits"),
          reportLine("BS-AST-PPE", "Property, Plant & Equipment"),
          reportLine("BS-AST-DEPR", "Less: Accumulated Depreciation"),
        ],
        total_assets: 0,
        liabilities: [
          reportLine("BS-LIA-AP", "Accounts Payable (Trade Payables)"),
          reportLine("BS-LIA-ACCRUED", "Accrued Payroll & Operational Expenses"),
          reportLine("BS-LIA-TAX", "Sales Taxes Payable"),
          reportLine("BS-LIA-DEBT", "Long-Term Debt & Bank Borrowings"),
        ],
        total_liabilities: 0,
        equity: [
          reportLine("BS-EQU-CAPITAL", "Contributed Capital / Shareholder Capital"),
          reportLine("BS-EQU-RETAINED", "Retained Earnings (Prior Periods)"),
        ],
        total_equity: 0,
        total_liabilities_and_equity: 0,
        is_balanced: true,
        variance: 0,
      },
      income_statement: {
        operating_revenue: [
          reportLine("IS-REV-FB", "Food & Beverage Revenue"),
          reportLine("IS-REV-OTHER", "Other Operating Revenue"),
        ],
        total_operating_revenue: 0,
        cost_of_sales: [
          reportLine("IS-COS-FB", "Food & Beverage Cost of Sales"),
          reportLine("IS-COS-OTHER", "Other Direct Costs"),
        ],
        total_cost_of_sales: 0,
        gross_profit: 0,
        operating_expenses: [
          reportLine("IS-EXP-FB", "Food & Beverage Operating Expenses"),
          reportLine("IS-EXP-AG", "Administrative & General Expenses"),
          reportLine("IS-EXP-POM", "Property Operation & Maintenance"),
          reportLine("IS-EXP-SM", "Sales & Marketing Expenses"),
          reportLine("IS-EXP-UTILITIES", "Utilities & Energy Costs"),
        ],
        total_operating_expenses: 0,
        net_operating_income: 0,
      },
    };
  }
  if (path === "/api/reports/financial-statements") {
    return {
      period: "All Time",
      property_name: "",
      currency: "IDR (Rp)",
      balance_sheet: {
        assets: [
          reportLine("BS-AST-CASH", "Cash & Cash Equivalents"),
          reportLine("BS-AST-RECEIVABLES", "Accounts Receivable & Guest Ledger"),
          reportLine("BS-AST-INVENTORY", "Inventories & Operating Supplies"),
          reportLine("BS-AST-PREPAID", "Prepaid Expenses & Security Deposits"),
          reportLine("BS-AST-PPE", "Property, Plant & Equipment"),
          reportLine("BS-AST-DEPR", "Less: Accumulated Depreciation"),
        ],
        total_assets: 0,
        liabilities: [
          reportLine("BS-LIA-AP", "Accounts Payable (Trade Payables)"),
          reportLine("BS-LIA-ACCRUED", "Accrued Payroll & Operational Expenses"),
          reportLine("BS-LIA-TAX", "Hotel & Sales Taxes Payable"),
          reportLine("BS-LIA-DEBT", "Long-Term Debt & Bank Borrowings"),
        ],
        total_liabilities: 0,
        equity: [
          reportLine("BS-EQU-CAPITAL", "Contributed Capital / Shareholder Capital"),
          reportLine("BS-EQU-RETAINED", "Retained Earnings (Prior Periods)"),
        ],
        total_equity: 0,
        total_liabilities_and_equity: 0,
        is_balanced: true,
        variance: 0,
      },
      income_statement: {
        operating_revenue: [
          reportLine("IS-REV-ROOMS", "Rooms Revenue"),
          reportLine("IS-REV-FB", "Food & Beverage Revenue"),
          reportLine("IS-REV-OTHER", "Other Operating Revenue"),
        ],
        total_operating_revenue: 0,
        cost_of_sales: [
          reportLine("IS-COS-FB", "Food & Beverage Cost of Sales"),
          reportLine("IS-COS-OTHER", "Other Department Direct Costs"),
        ],
        total_cost_of_sales: 0,
        gross_profit: 0,
        operating_expenses: [
          reportLine("IS-EXP-ROOMS", "Rooms Department Operating Expenses"),
          reportLine("IS-EXP-FB", "Food & Beverage Operating Expenses"),
          reportLine("IS-EXP-AG", "Administrative & General Expenses"),
          reportLine("IS-EXP-POM", "Property Operation & Maintenance"),
          reportLine("IS-EXP-SM", "Sales & Marketing Expenses"),
          reportLine("IS-EXP-UTILITIES", "Utilities & Energy Costs"),
        ],
        total_operating_expenses: 0,
        net_operating_income: 0,
      },
    };
  }
  if (path === "/api/reports/drilldown") {
    return {
      report_type: "USALI",
      line_id: "",
      line_label: "",
      period: "All Time",
      line_total: 0,
      accounts: [],
      journal_lines: [],
    };
  }
  if (path === "/api/trial-balance") {
    return { period: "All Time", items: [], total_debits: 0, total_credits: 0, is_balanced: true, variance: 0 };
  }
  if (path === "/api/ledger") {
    return { account: null, entries: [], total_debit: 0, total_credit: 0, ending_balance: 0 };
  }
  return null;
}

export function bzgStandardBooks(): string {
  return `<script>(function(){var hotel=["USALI","Owner Pool","Service Charge","Gratuities","Night Audit","PMS","Guest Ledger","Guest Folio","City Ledger","Revenue Cycle","Revenue Ingestion","Transient Rooms","Integrations","hotel operational"];function label(node){return (node.innerText||node.textContent||"").replace(/\\s+/g," ").trim()}function hotelOnly(text){for(var i=0;i<hotel.length;i++)if(text.indexOf(hotel[i])!==-1)return true;return false}function hide(node){if(node)node.style.display="none"}function standard(){hide(document.getElementById("nav-pillar-integrations"));hide(document.getElementById("nav-operations-service-charge"));hide(document.getElementById("nav-reports-owner-pool"));hide(document.getElementById("btn-quick-owner-pool"));hide(document.getElementById("btn-quick-service-charge"));var buttons=document.querySelectorAll("button,option");var financial=null;var spending=null;for(var i=0;i<buttons.length;i++){var text=label(buttons[i]);if(text.length>180)continue;if(hotelOnly(text))hide(buttons[i]);if(!financial&&text.indexOf("Balance Sheet")!==-1&&!hotelOnly(text)&&text.length<90)financial=buttons[i];if(!spending&&text.indexOf("Spending Cycle")!==-1&&text.length<90)spending=buttons[i]}var leaves=document.querySelectorAll("span,p,h1,h2,h3,label");for(var j=0;j<leaves.length;j++){if(leaves[j].children.length!==0)continue;var leaf=leaves[j].textContent||"";if(leaf.indexOf("Hotel Inventory")!==-1)leaves[j].textContent=leaf.replace("Hotel Inventory","Inventory");else if(hotelOnly(leaf))hide(leaves[j])}var body=document.body?document.body.innerText:"";if(financial&&(body.indexOf("USALI")!==-1||body.indexOf("Owner Pool")!==-1))financial.click();if(spending&&(body.indexOf("Night Audit")!==-1||body.indexOf("Gratuities Pool")!==-1||body.indexOf("Guest Folio")!==-1||body.indexOf("City Ledger")!==-1))spending.click()}function start(){standard();new MutationObserver(standard).observe(document.documentElement,{childList:true,subtree:true,characterData:true})}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start()})();</script>`;
}

export function amgSessionBootstrap(): string {
  return `<script>(function(){try{localStorage.setItem("amg_auth_session","active")}catch(e){}var remove=Storage.prototype.removeItem;Storage.prototype.removeItem=function(key){if(key==="amg_auth_session"||key==="amg_auth_email")return;return remove.call(this,key)};function watch(){var buttons=document.querySelectorAll("button");for(var i=0;i<buttons.length;i++){var label=buttons[i].textContent||"";if(label.indexOf("Keluar")!==-1||label.indexOf("Kunci Sesi")!==-1)buttons[i].style.display="none"}var text=document.body?document.body.textContent||"":"";if(text.indexOf("Sign in with Google")!==-1&&sessionStorage.getItem("wolf-finance-auth")!=="1"){sessionStorage.setItem("wolf-finance-auth","1");location.reload()}}function start(){watch();new MutationObserver(watch).observe(document.documentElement,{childList:true,subtree:true})}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start()})();</script>`;
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
