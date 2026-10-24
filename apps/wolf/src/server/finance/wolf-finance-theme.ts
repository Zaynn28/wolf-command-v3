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
  }
  ::selection { background: var(--color-brand-gold); color: var(--color-brand-navy); }
  * { scrollbar-color: var(--wolf-line) var(--wolf-bg); }
  header.sticky { box-shadow: inset 0 2px 0 var(--color-brand-gold); }

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
  [class*="bg-slate-8"],
  [class*="bg-slate-9"],
  [class*="bg-black"] {
    background-color: var(--color-brand-navy) !important;
    color: var(--color-text-on-dark) !important;
  }
  [class*="bg-black/"] {
    background-color: var(--color-overlay) !important;
  }
  [class*="bg-indigo"],
  [class*="bg-sky"],
  [class*="bg-blue"],
  [class*="bg-cyan"] {
    background-color: var(--color-blue-background) !important;
    color: var(--color-blue-foreground) !important;
  }
  [class*="bg-amber"],
  [class*="bg-yellow"],
  [class*="bg-orange"] {
    background-color: var(--color-amber-background) !important;
    color: var(--color-amber-foreground) !important;
  }
  [class*="bg-emerald"],
  [class*="bg-green"],
  [class*="bg-lime"],
  [class*="bg-teal"] {
    background-color: var(--color-green-background) !important;
    color: var(--color-green-foreground) !important;
  }
  [class*="bg-rose"],
  [class*="bg-red"] {
    background-color: var(--color-danger-background) !important;
    color: var(--color-danger-foreground) !important;
  }
  [class*="bg-purple"],
  [class*="bg-violet"],
  [class*="bg-fuchsia"],
  [class*="bg-pink"] {
    background-color: var(--color-violet-background) !important;
    color: var(--color-violet-foreground) !important;
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
  [class*="text-cyan"] { color: var(--color-blue-foreground) !important; }
  [class*="text-amber"],
  [class*="text-yellow"],
  [class*="text-orange"] { color: var(--color-amber-foreground) !important; }
  [class*="text-lime"],
  [class*="text-teal"],
  [class*="text-emerald"],
  [class*="text-green"] { color: var(--color-green-foreground) !important; }
  [class*="text-purple"],
  [class*="text-violet"],
  [class*="text-fuchsia"],
  [class*="text-pink"] { color: var(--color-violet-foreground) !important; }
  [class*="text-red"],
  [class*="text-rose"] { color: var(--color-danger-foreground) !important; }
  [class*="text-[10px]"][class*="text-emerald"],
  [class*="text-[10px]"][class*="text-green"],
  [class*="text-[11px]"][class*="text-emerald"],
  [class*="text-xs"][class*="text-emerald"],
  [class*="text-xs"][class*="text-green"] { color: var(--color-green-foreground) !important; }
  [class*="text-[10px]"][class*="text-red"],
  [class*="text-[10px]"][class*="text-rose"],
  [class*="text-[11px]"][class*="text-red"],
  [class*="text-[11px]"][class*="text-rose"],
  [class*="text-xs"][class*="text-red"],
  [class*="text-xs"][class*="text-rose"] { color: var(--color-danger-foreground) !important; }
  [class*="text-xs"][class*="text-amber"] { color: var(--color-amber-foreground) !important; }
  [class*="text-xs"][class*="text-blue"],
  [class*="text-xs"][class*="text-indigo"] { color: var(--color-blue-foreground) !important; }
  [class*="text-right"][class*="text-emerald"],
  [class*="text-right"][class*="text-green"],
  [class*="text-2xl"][class*="text-emerald"],
  [class*="text-xl"][class*="text-emerald"],
  [class*="text-base"][class*="text-emerald"],
  [class*="font-mono"][class*="font-semibold"][class*="text-emerald"] { color: var(--wolf-positive) !important; }
  [class*="text-right"][class*="text-red"],
  [class*="text-right"][class*="text-rose"],
  [class*="text-2xl"][class*="text-red"],
  [class*="text-2xl"][class*="text-rose"],
  [class*="text-base"][class*="text-red"],
  [class*="text-base"][class*="text-rose"] { color: var(--wolf-danger) !important; }
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
  [class*="border-cyan"] { border-color: var(--color-blue-foreground) !important; }
  [class*="border-amber"],
  [class*="border-orange"],
  [class*="border-yellow"] { border-color: var(--color-amber-foreground) !important; }
  [class*="border-emerald"],
  [class*="border-green"],
  [class*="border-teal"] { border-color: var(--color-green-foreground) !important; }
  [class*="border-rose"],
  [class*="border-red"] { border-color: var(--color-danger-foreground) !important; }
  [class*="border-purple"],
  [class*="border-violet"] { border-color: var(--color-violet-foreground) !important; }
  [class*="divide-"] > :not(:last-child) { border-color: var(--wolf-line) !important; }
  [class*="ring-"] { --tw-ring-color: var(--color-focus-ring) !important; }
  [class*="fill-indigo"],
  [class*="fill-sky"],
  [class*="fill-blue"],
  [class*="stroke-indigo"],
  [class*="stroke-sky"],
  [class*="stroke-blue"] { color: var(--color-blue-foreground) !important; }
  [class*="fill-amber"],
  [class*="stroke-amber"] { color: var(--color-amber-foreground) !important; }
  [class*="fill-emerald"],
  [class*="stroke-emerald"] { color: var(--color-green-foreground) !important; }
  [class*="fill-rose"],
  [class*="stroke-rose"] { color: var(--color-danger-foreground) !important; }
  [class*="fill-purple"],
  [class*="stroke-purple"] { color: var(--color-violet-foreground) !important; }

  button[class~="bg-red-600"],
  button[class~="bg-red-500"],
  button[class~="bg-rose-600"],
  button[class~="bg-rose-500"],
  a[class~="bg-red-600"],
  a[class~="bg-rose-600"] {
    background-color: var(--wolf-danger-fill) !important;
    border-color: var(--wolf-danger-fill) !important;
    color: var(--color-text-on-dark) !important;
  }
  button[class~="bg-red-600"] *,
  button[class~="bg-rose-600"] *,
  a[class~="bg-red-600"] * { color: var(--color-text-on-dark) !important; }

  button.bg-slate-900,
  a.bg-slate-900,
  .rounded-full.bg-slate-900,
  button[class~="bg-indigo-600"],
  button[class~="bg-indigo-500"],
  button[class~="bg-blue-600"],
  button[class~="bg-blue-500"],
  button[class~="bg-sky-600"] {
    background-color: var(--wolf-accent) !important;
    border-color: var(--color-action-primary) !important;
    color: var(--wolf-accent-ink) !important;
  }
  button[class~="bg-emerald-600"] {
    background-color: var(--color-green-foreground) !important;
    border-color: var(--color-green-foreground) !important;
    color: var(--color-text-on-dark) !important;
  }
  button[class~="bg-amber-500"] {
    background-color: var(--color-warning-foreground) !important;
    border-color: var(--color-warning-foreground) !important;
    color: var(--color-text-on-dark) !important;
  }
  button[class~="bg-purple-600"] {
    background-color: var(--color-violet-foreground) !important;
    border-color: var(--color-violet-foreground) !important;
    color: var(--color-text-on-dark) !important;
  }
  button.bg-slate-900:hover,
  a.bg-slate-900:hover,
  button[class~="bg-indigo-600"]:hover,
  button[class~="bg-blue-600"]:hover {
    background-color: var(--color-action-primary-hover) !important;
    color: var(--wolf-accent-ink) !important;
  }
  button.bg-slate-900[class*="bg-slate-900"] *,
  a.bg-slate-900[class*="bg-slate-900"] *,
  .rounded-full.bg-slate-900,
  .bg-slate-900.text-white,
  button[class~="bg-indigo-600"][class] *,
  button[class~="bg-indigo-500"] *,
  button[class~="bg-blue-600"] *,
  button[class~="bg-blue-500"] *,
  button[class~="bg-sky-600"] *,
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
    caret-color: var(--color-blue-foreground);
  }
  select option, select optgroup {
    background-color: var(--wolf-surface);
    color: var(--wolf-ink);
  }
  input::placeholder, textarea::placeholder { color: var(--wolf-muted) !important; opacity: 1; }
  input:focus, select:focus, textarea:focus, button:focus-visible {
    outline: 2px solid var(--color-blue-foreground);
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
}
`.trim();

export function injectWolfFinanceTheme(html: string): string {
  if (html.includes(themeMarker)) return html;
  const style = `<style id="${themeMarker}">${wolfFinanceThemeCss}</style>`;
  if (html.includes("</head>")) return html.replace("</head>", `${style}</head>`);
  return `${style}${html}`;
}
