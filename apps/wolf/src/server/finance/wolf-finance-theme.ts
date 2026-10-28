const themeMarker = "wolf-finance-theme";

const wolfFinanceThemeCss = `
@media screen {
  :root {
    color-scheme: light;
    --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    --font-mono: ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace;
    --color-brand-navy: #182435;
    --color-brand-navy-hover: #223147;
    --color-brand-navy-active: #2B425A;
    --color-brand-gold: #ECB956;
    --color-brand-gold-soft: #F0D391;
    --color-app-background: #F5F7F9;
    --color-surface: #FFFFFF;
    --color-surface-subtle: #F8FAFB;
    --color-surface-muted: #F1F4F6;
    --color-text-primary: #172334;
    --color-text-secondary: #556275;
    --color-text-muted: #8A95A2;
    --color-text-on-dark: #FFFFFF;
    --color-text-on-dark-muted: #AEB9C8;
    --color-border: #E5E8EC;
    --color-border-subtle: #EDF0F3;
    --color-border-strong: #CFD6DD;
    --color-sidebar-background: #182435;
    --color-sidebar-surface: #223147;
    --color-sidebar-active: #2B425A;
    --color-sidebar-text: #AEB9C8;
    --color-sidebar-text-active: #FFFFFF;
    --color-sidebar-muted: #78889E;
    --color-action-primary: #1D3045;
    --color-action-primary-hover: #29435F;
    --color-action-secondary: #426B8D;
    --color-blue-background: #E7EFF7;
    --color-blue-foreground: #3B6A92;
    --color-green-background: #E7F3EA;
    --color-green-foreground: #4A7C59;
    --color-amber-background: #F8EEDB;
    --color-amber-foreground: #9A712B;
    --color-violet-background: #EFEBF7;
    --color-violet-foreground: #69588E;
    --color-success-background: #E6F2E9;
    --color-success-foreground: #4F7F5C;
    --color-warning-background: #F8EDDB;
    --color-warning-foreground: #926B2B;
    --color-danger-background: #F8E8E4;
    --color-danger-foreground: #AB5949;
    --color-danger-solid: #CF654B;
    --color-neutral-background: #EDF0F3;
    --color-neutral-foreground: #697686;
    --color-focus-ring: rgba(55, 110, 166, 0.24);
    --color-overlay: rgba(18, 27, 39, 0.48);
    --shadow-card: 0 9px 22px rgba(33, 47, 63, 0.07);
    --shadow-popover: 0 18px 45px rgba(27, 36, 51, 0.14);
    --shadow-modal: 0 28px 70px rgba(11, 19, 29, 0.24);
    --wolf-bg: var(--color-app-background);
    --wolf-surface: var(--color-surface);
    --wolf-raised: var(--color-surface-muted);
    --wolf-line: var(--color-border);
    --wolf-ink: var(--color-text-primary);
    --wolf-body: var(--color-text-secondary);
    --wolf-muted: var(--color-text-muted);
    --wolf-accent: var(--color-action-primary);
    --wolf-accent-ink: var(--color-text-on-dark);
    --wolf-positive: var(--color-green-foreground);
    --wolf-danger: var(--color-danger-foreground);
    --wolf-danger-fill: var(--color-danger-solid);
  }
  html, body, #root {
    background: var(--wolf-bg) !important;
    color: var(--wolf-ink) !important;
    height: 100%;
    min-height: 100%;
  }
  html, body {
    margin: 0;
    overflow: hidden;
  }
  #root > div {
    height: 100% !important;
    min-height: 100% !important;
    max-height: 100%;
    overflow: hidden;
  }
  #root > div > main {
    flex: 1 1 auto;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
  }
  ::selection { background: var(--color-brand-gold); color: var(--color-brand-navy); }
  * { scrollbar-color: var(--wolf-line) var(--wolf-bg); }
  header.sticky { box-shadow: none; }

  [class~="bg-slate-50"],
  [class*="bg-slate-50/"] { background-color: var(--wolf-bg) !important; }
  [class~="bg-white"],
  [class*="bg-white/"],
  [class*="bg-slate-100"],
  [class*="bg-gray-"],
  [class*="bg-zinc-"],
  [class*="bg-neutral-"],
  [class*="bg-stone-"] {
    background-color: var(--wolf-surface) !important;
  }
  [class*="bg-slate-2"],
  [class*="bg-slate-3"] {
    background-color: var(--wolf-raised) !important;
  }
  [class~="bg-slate-800"],
  [class~="bg-slate-900"],
  [class~="bg-slate-950"],
  [class~="bg-black"] {
    background-color: var(--color-brand-navy) !important;
    color: var(--color-text-on-dark) !important;
  }
  [class*="bg-black/"] {
    background-color: var(--color-overlay) !important;
  }
  [class*="bg-indigo"],
  [class*="bg-sky"],
  [class*="bg-blue"],
  [class*="bg-cyan"],
  [class*="bg-amber"],
  [class*="bg-yellow"],
  [class*="bg-orange"],
  [class*="bg-emerald"],
  [class*="bg-green"],
  [class*="bg-lime"],
  [class*="bg-teal"],
  [class*="bg-rose"],
  [class*="bg-red"],
  [class*="bg-purple"],
  [class*="bg-violet"],
  [class*="bg-fuchsia"],
  [class*="bg-pink"] {
    background-color: var(--wolf-surface) !important;
    color: var(--wolf-ink) !important;
  }

  [class*="text-slate-9"],
  [class*="text-slate-8"],
  [class*="text-black"],
  [class*="text-gray-9"],
  [class*="text-gray-8"] { color: var(--wolf-ink) !important; }
  [class*="text-slate-7"],
  [class*="text-slate-6"] { color: var(--wolf-body) !important; }
  [class*="text-slate-5"],
  [class*="text-slate-4"],
  [class*="text-slate-3"],
  [class*="text-gray-5"],
  [class*="text-gray-4"] { color: var(--wolf-muted) !important; }
  [class*="text-indigo"],
  [class*="text-sky"],
  [class*="text-blue"],
  [class*="text-cyan"],
  [class*="text-amber"],
  [class*="text-yellow"],
  [class*="text-orange"],
  [class*="text-lime"],
  [class*="text-teal"],
  [class*="text-emerald"],
  [class*="text-green"],
  [class*="text-purple"],
  [class*="text-violet"],
  [class*="text-fuchsia"],
  [class*="text-pink"],
  [class*="text-red"],
  [class*="text-rose"],
  [class*="text-[10px]"][class*="text-emerald"],
  [class*="text-[10px]"][class*="text-green"],
  [class*="text-[11px]"][class*="text-emerald"],
  [class*="text-xs"][class*="text-emerald"],
  [class*="text-xs"][class*="text-green"],
  [class*="text-[10px]"][class*="text-red"],
  [class*="text-[10px]"][class*="text-rose"],
  [class*="text-[11px]"][class*="text-red"],
  [class*="text-[11px]"][class*="text-rose"],
  [class*="text-xs"][class*="text-red"],
  [class*="text-xs"][class*="text-rose"],
  [class*="text-xs"][class*="text-amber"],
  [class*="text-xs"][class*="text-blue"],
  [class*="text-xs"][class*="text-indigo"],
  [class*="text-right"][class*="text-emerald"],
  [class*="text-right"][class*="text-green"],
  [class*="text-2xl"][class*="text-emerald"],
  [class*="text-xl"][class*="text-emerald"],
  [class*="text-base"][class*="text-emerald"],
  [class*="font-mono"][class*="font-semibold"][class*="text-emerald"],
  [class*="text-right"][class*="text-red"],
  [class*="text-right"][class*="text-rose"],
  [class*="text-2xl"][class*="text-red"],
  [class*="text-2xl"][class*="text-rose"],
  [class*="text-base"][class*="text-red"],
  [class*="text-base"][class*="text-rose"] { color: var(--wolf-ink) !important; }
  [class~="bg-slate-50"],
  [class*="bg-slate-50/"] {
    background-color: var(--wolf-bg) !important;
    color: var(--wolf-ink) !important;
  }
  [class~="bg-white"] {
    background-color: var(--wolf-surface) !important;
  }

  [class*="border-slate"],
  [class*="border-white"],
  [class*="border-gray"],
  [class*="border-zinc"],
  [class*="border-neutral"] { border-color: var(--wolf-line) !important; }
  [class*="border-indigo"],
  [class*="border-sky"],
  [class*="border-blue"],
  [class*="border-cyan"],
  [class*="border-amber"],
  [class*="border-orange"],
  [class*="border-yellow"],
  [class*="border-emerald"],
  [class*="border-green"],
  [class*="border-teal"],
  [class*="border-rose"],
  [class*="border-red"],
  [class*="border-purple"],
  [class*="border-violet"] { border-color: var(--wolf-line) !important; }
  [class*="divide-"] > :not(:last-child) { border-color: var(--wolf-line) !important; }
  [class*="ring-"] { --tw-ring-color: var(--color-focus-ring) !important; }
  [class*="fill-indigo"],
  [class*="fill-sky"],
  [class*="fill-blue"],
  [class*="stroke-indigo"],
  [class*="stroke-sky"],
  [class*="stroke-blue"],
  [class*="fill-amber"],
  [class*="stroke-amber"],
  [class*="fill-emerald"],
  [class*="stroke-emerald"],
  [class*="fill-rose"],
  [class*="stroke-rose"],
  [class*="fill-purple"],
  [class*="stroke-purple"] { color: var(--wolf-ink) !important; }

  button[class~="bg-red-600"],
  button[class~="bg-red-500"],
  button[class~="bg-rose-600"],
  button[class~="bg-rose-500"],
  a[class~="bg-red-600"],
  a[class~="bg-rose-600"],
  button.bg-slate-900,
  a.bg-slate-900,
  button[class~="bg-indigo-600"],
  button[class~="bg-indigo-500"],
  button[class~="bg-blue-600"],
  button[class~="bg-blue-500"],
  button[class~="bg-sky-600"],
  button[class~="bg-emerald-600"],
  button[class~="bg-amber-500"],
  button[class~="bg-purple-600"] {
    background-color: var(--color-brand-navy) !important;
    border-color: var(--color-brand-navy) !important;
    color: var(--color-text-on-dark) !important;
    box-shadow: none !important;
  }
  button.bg-slate-900[class*="bg-slate-900"]:hover,
  a.bg-slate-900[class*="bg-slate-900"]:hover,
  button[class~="bg-indigo-600"]:hover,
  button[class~="bg-blue-600"]:hover {
    background-color: var(--color-sidebar-active) !important;
    color: var(--color-text-on-dark) !important;
  }
  button[class~="bg-red-600"] *,
  button[class~="bg-rose-600"] *,
  a[class~="bg-red-600"] *,
  button.bg-slate-900[class*="bg-slate-900"] *,
  a.bg-slate-900[class*="bg-slate-900"] *,
  button[class~="bg-indigo-600"][class] *,
  button[class~="bg-indigo-500"] *,
  button[class~="bg-blue-600"] *,
  button[class~="bg-blue-500"] *,
  button[class~="bg-sky-600"] *,
  button.bg-slate-900[class*="bg-slate-900"]:hover *,
  a.bg-slate-900[class*="bg-slate-900"]:hover *,
  button[class~="bg-indigo-600"]:hover *,
  button[class~="bg-blue-600"]:hover *,
  button[class~="bg-emerald-600"] *,
  button[class~="bg-purple-600"] *,
  button[class~="bg-amber-500"] * {
    color: var(--color-text-on-dark) !important;
  }
  button[class~="bg-white"],
  a[class~="bg-white"] {
    background-color: var(--color-surface) !important;
    color: var(--color-text-primary) !important;
    border-color: var(--color-border-strong) !important;
  }

  input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]),
  select,
  textarea {
    background-color: var(--color-surface) !important;
    color: var(--wolf-ink) !important;
    border-color: var(--wolf-line) !important;
    color-scheme: light;
    caret-color: var(--wolf-ink);
  }
  select option, select optgroup {
    background-color: var(--wolf-surface);
    color: var(--wolf-ink);
  }
  input::placeholder, textarea::placeholder { color: var(--wolf-muted) !important; opacity: 1; }
  input:focus, select:focus, textarea:focus, button:focus-visible {
    outline: 2px solid var(--color-brand-navy);
    outline-offset: 1px;
  }
  ::-webkit-calendar-picker-indicator { filter: none; }

  .report-preview-active.bg-white {
    background-color: var(--wolf-surface) !important;
    color: var(--wolf-ink) !important;
  }
  .report-preview-active.bg-white *,
  .report-preview-active.bg-white h1,
  .report-preview-active.bg-white .header-title-block,
  .report-preview-active.bg-white .header-title-block *,
  .report-preview-active.bg-white .header-top-rule,
  .report-preview-active.bg-white .header-top-rule *,
  .report-preview-active.bg-white .header-col-rule,
  .report-preview-active.bg-white .header-col-rule * {
    background-color: transparent !important;
    color: var(--wolf-ink) !important;
  }
  .report-preview-active.bg-white thead,
  .report-preview-active.bg-white th {
    background-color: var(--wolf-raised) !important;
    color: var(--wolf-body) !important;
    border-color: var(--wolf-line) !important;
  }
  .report-preview-active.bg-white td {
    color: var(--wolf-ink) !important;
    border-color: var(--wolf-line) !important;
  }

  #root > div {
    display: grid !important;
    grid-template-columns: 16.25rem minmax(0, 1fr) !important;
    grid-template-rows: minmax(0, 1fr) auto !important;
    align-items: stretch !important;
  }
  header.sticky {
    grid-column: 1 !important;
    grid-row: 1 / span 2 !important;
  }
  #root > div > main {
    grid-column: 2 !important;
    grid-row: 1 !important;
    width: 100% !important;
  }
  #root > div > footer {
    grid-column: 2 !important;
    grid-row: 2 !important;
    width: auto !important;
    height: auto !important;
  }
  header.sticky {
    position: sticky !important;
    top: 0 !important;
    display: flex !important;
    flex-direction: column !important;
    flex: 0 0 16.25rem !important;
    width: 16.25rem !important;
    min-width: 16.25rem !important;
    max-width: 16.25rem !important;
    height: 100% !important;
    max-height: 100% !important;
    overflow-x: hidden !important;
    overflow-y: auto !important;
    background: var(--color-sidebar-background) !important;
    color: var(--color-sidebar-text) !important;
    border: 0 !important;
    border-right: 1px solid var(--color-sidebar-surface) !important;
    box-shadow: none !important;
  }
  header.sticky > div,
  header.sticky [class*="bg-white"],
  header.sticky [class*="bg-slate"] {
    background: transparent !important;
    background-color: transparent !important;
    border-color: transparent !important;
    box-shadow: none !important;
  }
  header.sticky .max-w-7xl,
  header.sticky [class*="max-w-"] {
    max-width: none !important;
    width: 100% !important;
    margin: 0 !important;
  }
  header.sticky > div:first-child > div {
    flex-direction: column !important;
    align-items: stretch !important;
    height: auto !important;
    gap: 0.75rem !important;
    padding: 1rem 0.75rem 0.5rem !important;
  }
  header.sticky .truncate {
    overflow: visible !important;
    text-overflow: clip !important;
    white-space: normal !important;
  }
  header.sticky span,
  header.sticky button,
  header.sticky a,
  header.sticky svg {
    color: var(--color-sidebar-text) !important;
  }
  header.sticky .font-extrabold {
    color: var(--color-sidebar-text-active) !important;
  }
  header.sticky nav {
    display: flex !important;
    flex-direction: column !important;
    align-items: stretch !important;
    min-width: 0 !important;
    width: 100% !important;
    gap: 0.125rem !important;
    padding: 0.25rem 0.5rem 0.75rem !important;
  }
  header.sticky nav button,
  header.sticky > div:nth-child(n+3) button {
    width: 100% !important;
    justify-content: flex-start !important;
    background: transparent !important;
    background-color: transparent !important;
    color: var(--color-sidebar-text) !important;
    border-color: transparent !important;
    box-shadow: none !important;
    border-radius: 0.5rem !important;
  }
  header.sticky nav button.bg-slate-900,
  header.sticky nav button[class~="bg-slate-900"],
  header.sticky > div:nth-child(n+3) button.bg-slate-900,
  header.sticky > div:nth-child(n+3) button[class~="bg-slate-900"] {
    background: var(--color-sidebar-active) !important;
    background-color: var(--color-sidebar-active) !important;
    color: var(--color-sidebar-text-active) !important;
  }
  header.sticky nav button.bg-slate-900 *,
  header.sticky nav button[class~="bg-slate-900"] *,
  header.sticky > div:nth-child(n+3) button[class~="bg-slate-900"] * {
    color: var(--color-sidebar-text-active) !important;
  }
  header.sticky .absolute {
    position: static !important;
    width: 100% !important;
    margin-top: 0.5rem !important;
    background: var(--color-sidebar-surface) !important;
    background-color: var(--color-sidebar-surface) !important;
    color: var(--color-sidebar-text-active) !important;
  }
  #root > div > main,
  main[class*="max-w-7xl"] {
    max-width: none !important;
    width: auto !important;
    flex: 1 1 auto !important;
    min-width: 0 !important;
    margin: 0 !important;
    background: var(--wolf-bg) !important;
  }

  main [class*="bg-gradient"],
  main [class*="bg-linear-"] {
    background-image: none !important;
    background-color: var(--color-surface) !important;
    color: var(--color-text-primary) !important;
    border-color: var(--color-border-strong) !important;
    box-shadow: none !important;
  }
  main [class~="bg-slate-700"]:not(button):not(a),
  main [class~="bg-slate-800"]:not(button):not(a),
  main [class~="bg-slate-900"]:not(button):not(a),
  main [class~="bg-slate-950"]:not(button):not(a),
  main [class~="bg-black"]:not(button):not(a) {
    background-color: var(--color-surface) !important;
    color: var(--color-text-primary) !important;
    border-color: var(--color-border-strong) !important;
  }
  main [class*="border-slate"],
  main [class*="border-emerald"],
  main [class*="border-green"],
  main [class*="border-blue"],
  main [class*="border-amber"],
  main [class*="border-orange"],
  main [class*="border-rose"],
  main [class*="border-red"] {
    border-color: var(--color-border-strong) !important;
  }
  main [class~="text-white"],
  main [class*="text-white/"] {
    color: var(--color-text-primary) !important;
  }
  main [class*="text-slate-5"],
  main [class*="text-slate-4"],
  main [class*="text-slate-3"],
  main [class*="text-gray-5"],
  main [class*="text-gray-4"] {
    color: #3E4C5E !important;
  }
  main [class*="text-emerald"],
  main [class*="text-green"],
  main [class*="text-lime"],
  main [class*="text-teal"] {
    color: #1F6B45 !important;
  }
  main [class*="text-amber"],
  main [class*="text-yellow"],
  main [class*="text-orange"] {
    color: #8A5A16 !important;
  }
  main [class*="text-red"],
  main [class*="text-rose"] {
    color: #9B3A32 !important;
  }
  main [class*="text-blue"],
  main [class*="text-indigo"],
  main [class*="text-sky"],
  main [class*="text-cyan"],
  main [class*="text-purple"],
  main [class*="text-violet"],
  main [class*="text-fuchsia"],
  main [class*="text-pink"] {
    color: var(--color-text-primary) !important;
  }
  main thead,
  main thead th {
    background-color: var(--color-surface-muted) !important;
    color: #3E4C5E !important;
  }
  main button[class~="bg-slate-700"],
  main button[class~="bg-slate-800"],
  main button[class~="bg-slate-900"],
  main a[class~="bg-slate-800"],
  main a[class~="bg-slate-900"],
  main button[class~="bg-indigo-600"],
  main button[class~="bg-indigo-500"],
  main button[class~="bg-blue-600"],
  main button[class~="bg-blue-500"],
  main button[class~="bg-sky-600"],
  main button[class~="bg-emerald-600"],
  main button[class~="bg-purple-600"],
  main button[class~="bg-amber-500"],
  main a[class~="bg-indigo-600"],
  main a[class~="bg-blue-600"],
  main button[class*="from-indigo"],
  main button[class*="from-blue"],
  main a[class*="from-indigo"],
  main a[class*="from-blue"] {
    background-image: none !important;
    background-color: var(--color-brand-navy) !important;
    border-color: var(--color-brand-navy) !important;
    color: var(--color-text-on-dark) !important;
  }
  main button[class~="bg-slate-700"] *,
  main button[class~="bg-slate-800"] *,
  main button[class~="bg-slate-900"] *,
  main a[class~="bg-slate-800"] *,
  main a[class~="bg-slate-900"] *,
  main button[class~="bg-indigo-600"] *,
  main button[class~="bg-indigo-500"] *,
  main button[class~="bg-blue-600"] *,
  main button[class~="bg-blue-500"] *,
  main button[class~="bg-sky-600"] *,
  main button[class~="bg-emerald-600"] *,
  main button[class~="bg-purple-600"] *,
  main button[class~="bg-amber-500"] *,
  main a[class~="bg-indigo-600"] *,
  main a[class~="bg-blue-600"] *,
  main button[class*="from-indigo"] *,
  main button[class*="from-blue"] *,
  main a[class*="from-indigo"] *,
  main a[class*="from-blue"] * {
    color: var(--color-text-on-dark) !important;
  }
  main button[class~="bg-white"],
  main a[class~="bg-white"] {
    background-color: var(--color-surface) !important;
    color: var(--color-text-primary) !important;
    border-color: var(--color-border-strong) !important;
  }
  main button[class~="bg-white"] *,
  main a[class~="bg-white"] * {
    color: var(--color-text-primary) !important;
  }
}
`.trim();

const sheetsPanelHide = `<script id="wolf-finance-sheets-hide">(function(){
  function hide(){
    var nodes=document.querySelectorAll("span");
    for(var i=0;i<nodes.length;i++){
      if((nodes[i].textContent||"").indexOf("Google Sheets Datastore")===-1)continue;
      var card=nodes[i];
      for(var n=0;n<8&&card;n++){
        var name=String(card.className||"");
        if(name.indexOf("rounded-xl")!==-1){card.style.display="none";break}
        card=card.parentElement;
      }
    }
  }
  function start(){hide();new MutationObserver(hide).observe(document.documentElement,{childList:true,subtree:true})}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start();
})();</script>`;

export const wolfFinanceReceiptCameraScript = `<script id="wolf-finance-receipt-camera">(function(){
  function text(node){
    return ((node && node.textContent) || "").replace(/\\s+/g, " ").trim();
  }
  function hideMocks(){
    var nodes=document.querySelectorAll("span,button");
    for(var i=0;i<nodes.length;i++){
      var label=text(nodes[i]);
      var mock=label.indexOf("Quick Mock Data Presets")!==-1||label.indexOf("Sample Receipt Photo")!==-1||label.indexOf("Kitchen Fresh Herbs")!==-1||label.indexOf("Plumbing Valve")!==-1||(label.indexOf("Courier")!==-1&&label.indexOf("Stamps")!==-1);
      if(!mock)continue;
      if(nodes[i].tagName==="BUTTON"){nodes[i].disabled=true;nodes[i].style.display="none";}
      var card=nodes[i];
      for(var n=0;n<6&&card;n++){
        if(String(card.className||"").indexOf("bg-amber")!==-1){card.style.display="none";break;}
        card=card.parentElement;
      }
    }
  }
  function relabel(){
    var notes=document.querySelectorAll("p");
    for(var i=0;i<notes.length;i++){
      if(notes[i].children.length!==0)continue;
      if(text(notes[i]).indexOf("mock sample")===-1)continue;
      notes[i].textContent="Opens the device camera. If camera access is denied, choose a photo file.";
    }
  }
  function paintClearedFloat(summary){
    if(!summary||summary.float_limit!==0)return;
    var nodes=document.querySelectorAll("span");
    for(var i=0;i<nodes.length;i++){
      if(nodes[i].children.length)continue;
      var label=text(nodes[i]);
      if(label.indexOf("Fixed Imprest System")!==-1&&label.indexOf("10,000,000")!==-1)nodes[i].textContent="Fixed Imprest System (Rp 0)";
      if(label!=="Imprest Float Ceiling")continue;
      var card=nodes[i].parentElement;
      if(!card)continue;
      var amounts=card.querySelectorAll("span");
      for(var j=0;j<amounts.length;j++){
        var amount=text(amounts[j]);
        if(amount.indexOf("Rp")===0&&amount!=="Rp 0")amounts[j].textContent="Rp 0";
      }
    }
  }
  var clearedFloat=null;
  function refreshBalance(){
    var path=location.pathname||"";
    var marker="/runtime";
    var cut=path.indexOf(marker);
    if(cut===-1)return;
    var url=path.slice(0,cut+marker.length)+"/"+"api"+"/petty-cash/balance";
    fetch(url).then(function(res){return res.json();}).then(function(body){
      clearedFloat=body&&body.float_limit===0?body:null;
      paintClearedFloat(clearedFloat);
    }).catch(function(){});
  }
  function sync(){hideMocks();relabel();paintClearedFloat(clearedFloat);}
  function zoneFrom(target){
    var node=target&&target.nodeType===1?target:target&&target.parentElement;
    for(var n=0;n<8&&node;n++){
      if(String(node.className||"").indexOf("border-dashed")!==-1&&text(node).indexOf("Click to Upload Receipt Photo")!==-1)return node;
      node=node.parentElement;
    }
    return null;
  }
  function fileInput(zone){
    var root=zone&&zone.parentElement;
    if(!root)return null;
    var inputs=root.querySelectorAll("input");
    for(var i=0;i<inputs.length;i++)if((inputs[i].getAttribute("type")||"")==="file")return inputs[i];
    return null;
  }
  function stopStream(video){
    var stream=video&&video.srcObject;
    var tracks=stream&&stream.getTracks?stream.getTracks():[];
    for(var i=0;i<tracks.length;i++)tracks[i].stop();
    if(video)video.srcObject=null;
  }
  function closePanel(panel, video){
    stopStream(video);
    if(panel&&panel.parentNode)panel.parentNode.removeChild(panel);
  }
  function openCamera(zone){
    if(document.getElementById("wolf-receipt-camera"))return;
    var panel=document.createElement("div");
    panel.id="wolf-receipt-camera";
    panel.style.cssText="position:fixed;inset:0;z-index:80;background:rgba(15,23,42,.72);display:flex;align-items:center;justify-content:center;padding:24px;";
    var card=document.createElement("div");
    card.style.cssText="width:min(440px,100%);background:#fff;border-radius:16px;padding:16px;box-shadow:0 16px 40px rgba(15,23,42,.25);";
    var title=document.createElement("p");
    title.textContent="Receipt camera";
    title.style.cssText="margin:0 0 8px;font-weight:700;color:#182435;";
    var status=document.createElement("p");
    status.textContent="Requesting the camera…";
    status.style.cssText="margin:0 0 12px;color:#526070;font-size:13px;";
    var video=document.createElement("video");
    video.autoplay=true;video.muted=true;video.playsInline=true;
    video.style.cssText="width:100%;border-radius:12px;background:#111;max-height:320px;object-fit:cover;";
    var shot=document.createElement("canvas");
    shot.style.cssText="width:100%;border-radius:12px;background:#111;display:none;";
    var row=document.createElement("div");
    row.style.cssText="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;";
    function button(label){
      var node=document.createElement("button");
      node.type="button";
      node.textContent=label;
      node.style.cssText="border:0;border-radius:8px;padding:8px 12px;font-weight:600;background:#182435;color:#fff;";
      return node;
    }
    var capture=button("Capture");
    var retake=button("Retake");
    var usePhoto=button("Use photo");
    var chooseFile=button("Choose file");
    var cancel=button("Cancel");
    cancel.style.background="#e8edf2";cancel.style.color="#182435";
    retake.disabled=true;usePhoto.disabled=true;chooseFile.style.display="none";
    row.appendChild(cancel);row.appendChild(chooseFile);row.appendChild(retake);row.appendChild(capture);row.appendChild(usePhoto);
    card.appendChild(title);card.appendChild(status);card.appendChild(video);card.appendChild(shot);card.appendChild(row);
    panel.appendChild(card);
    (document.body||document.documentElement).appendChild(panel);
    panel.addEventListener("click",function(event){if(event.target===panel)closePanel(panel,video);});
    cancel.addEventListener("click",function(){closePanel(panel,video);});
    chooseFile.addEventListener("click",function(){
      var input=fileInput(zone);
      closePanel(panel,video);
      if(input)input.click();
    });
    function showLive(){
      shot.style.display="none";video.style.display="block";
      capture.disabled=false;retake.disabled=true;usePhoto.disabled=true;
      status.textContent="Camera ready. Capture the receipt. Retake if the shot is wrong.";
    }
    retake.addEventListener("click",showLive);
    capture.addEventListener("click",function(){
      var width=video.videoWidth||0;var height=video.videoHeight||0;
      if(!width||!height){status.textContent="The camera is not ready yet.";return;}
      shot.width=width;shot.height=height;
      var context=shot.getContext("2d");
      if(!context)return;
      context.drawImage(video,0,0,width,height);
      video.style.display="none";shot.style.display="block";
      capture.disabled=true;retake.disabled=false;usePhoto.disabled=false;
      status.textContent="Preview ready. Use this photo, or retake it.";
    });
    usePhoto.addEventListener("click",function(){
      if(!shot.toBlob){status.textContent="This browser cannot save the camera photo.";return;}
      shot.toBlob(function(blob){
        var input=fileInput(zone);
        if(!blob||!input||typeof File==="undefined"||typeof DataTransfer==="undefined"){
          status.textContent="The photo could not be attached. Choose a file instead.";
          chooseFile.style.display="inline-block";
          return;
        }
        var file=new File([blob],"receipt-camera.jpg",{type:"image/jpeg"});
        var transfer=new DataTransfer();
        transfer.items.add(file);
        input.files=transfer.files;
        input.dispatchEvent(new Event("change",{bubbles:true}));
        closePanel(panel,video);
      },"image/jpeg",0.92);
    });
    var devices=navigator.mediaDevices;
    var request=devices&&devices.getUserMedia?devices.getUserMedia({audio:false,video:{facingMode:{ideal:"environment"}}}):Promise.reject(new Error("camera-unavailable"));
    request.then(function(stream){video.srcObject=stream;return video.play();}).then(showLive).catch(function(){
      video.style.display="none";capture.style.display="none";retake.style.display="none";usePhoto.style.display="none";
      chooseFile.style.display="inline-block";
      status.textContent="Camera access was denied or is unavailable. Choose a receipt photo file instead.";
    });
  }
  document.addEventListener("click",function(event){
    var label=text(event.target);
    if(label.indexOf("Kitchen Fresh Herbs")!==-1||label.indexOf("Plumbing Valve")!==-1||(label.indexOf("Courier")!==-1&&label.indexOf("Stamps")!==-1)||label.indexOf("Quick Mock Data Presets")!==-1){
      event.preventDefault();event.stopPropagation();return;
    }
    var zone=zoneFrom(event.target);
    if(!zone)return;
    event.preventDefault();event.stopPropagation();
    openCamera(zone);
  },true);
  function start(){sync();refreshBalance();new MutationObserver(sync).observe(document.documentElement,{childList:true,subtree:true,characterData:true});}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start();
})();</script>`;

export function injectWolfFinanceTheme(html: string): string {
  if (html.includes(themeMarker)) return html;
  const style = `<style id="${themeMarker}">${wolfFinanceThemeCss}</style>${sheetsPanelHide}${wolfFinanceReceiptCameraScript}`;
  if (html.includes("</head>")) return html.replace("</head>", `${style}</head>`);
  return `${style}${html}`;
}
