/**
 * Finance and HR keep a single iframe URL and swap pillars or pages in memory.
 * The bar records those views and replays their controls. It does not call
 * history.back(), which would leave the embedded app for the Wolf portal.
 */

export type EmbeddedHistoryView = {
  key: string;
  finance?: { pillarId: string; subId?: string; subLabel?: string };
  hr?: { navId: string; childLabel?: string };
  url?: string;
};

export type VisitState = {
  entries: EmbeddedHistoryView[];
  index: number;
};

export type EmbeddedHistoryAvailability = {
  canBack: boolean;
  canForward: boolean;
};

export function emptyVisits(): VisitState {
  return { entries: [], index: -1 };
}

export function canGoBack(state: VisitState): boolean {
  return state.index > 0;
}

export function canGoForward(state: VisitState): boolean {
  return state.index >= 0 && state.index < state.entries.length - 1;
}

export function recordVisit(state: VisitState, view: EmbeddedHistoryView, source: "user" | "settle"): VisitState {
  if (!view.key) return state;
  if (state.entries.length === 0 || state.index < 0) return { entries: [view], index: 0 };
  if (state.entries[state.index]?.key === view.key) return state;
  if (source === "settle" && state.index === 0 && state.entries.length === 1) return { entries: [view], index: 0 };
  if (source !== "user") return state;
  const entries = state.entries.slice(0, state.index + 1);
  entries.push(view);
  return { entries, index: entries.length - 1 };
}

export function replaceLatestVisit(state: VisitState, view: EmbeddedHistoryView): VisitState {
  if (!view.key || state.index < 0 || state.index !== state.entries.length - 1) return state;
  if (state.entries[state.index]?.key === view.key) return state;
  const entries = state.entries.slice();
  entries[state.index] = view;
  return { entries, index: state.index };
}

export function moveBack(state: VisitState): VisitState {
  if (!canGoBack(state)) return state;
  return { entries: state.entries, index: state.index - 1 };
}

export function moveForward(state: VisitState): VisitState {
  if (!canGoForward(state)) return state;
  return { entries: state.entries, index: state.index + 1 };
}

export function isInAppUrl(frameHref: string, targetHref: string): boolean {
  try {
    const frame = new URL(frameHref);
    const target = new URL(targetHref);
    if (frame.origin !== target.origin) return false;
    const marker = "/runtime";
    const at = frame.pathname.indexOf(marker);
    if (at < 0) return false;
    const prefix = frame.pathname.slice(0, at + marker.length);
    return target.pathname === prefix || target.pathname.startsWith(`${prefix}/`);
  } catch {
    return false;
  }
}

const pillarIdPattern = /^nav-pillar-[a-z0-9-]+$/;
const navIdPattern = /^[a-z0-9-]+$/;

function textOf(node: Element): string {
  return (node.textContent ?? "").replace(/\s+/g, " ").trim();
}

function controlLabel(button: HTMLElement): string {
  const spans = [...button.querySelectorAll(":scope > span")]
    .map((span) => textOf(span))
    .filter((label) => label.length > 0 && !/^\d+$/.test(label));
  if (spans.length > 0) return spans.join(" ");
  return textOf(button);
}

function isShown(node: HTMLElement): boolean {
  const view = node.ownerDocument.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return node.getClientRects().length > 0;
}

function outsideMain(doc: Document, node: Element): boolean {
  const main = doc.querySelector("main");
  return main ? !main.contains(node) : true;
}

function shownButtons(doc: Document): HTMLElement[] {
  return [...doc.querySelectorAll("button")].filter((node): node is HTMLElement => node instanceof HTMLElement && isShown(node));
}

function readFinance(doc: Document): EmbeddedHistoryView | null {
  const pillars = shownButtons(doc).filter((button) => pillarIdPattern.test(button.id));
  if (pillars.length === 0) return null;
  const active = pillars.find((button) => button.classList.contains("bg-slate-900"));
  if (!active) return null;
  const sub = shownButtons(doc).find((button) => {
    if (button === active || pillarIdPattern.test(button.id)) return false;
    if (!outsideMain(doc, button) || !button.classList.contains("bg-slate-900")) return false;
    const label = controlLabel(button);
    return label.length > 0 && label.length <= 90;
  });
  const subLabel = sub ? controlLabel(sub) : "";
  const subId = sub && /^nav-[a-z0-9-]+$/.test(sub.id) && !pillarIdPattern.test(sub.id) ? sub.id : undefined;
  const key = `finance:${active.id}:${subId ?? subLabel}`;
  return { key, finance: { pillarId: active.id, subId, subLabel: subLabel || undefined } };
}

function hasFinanceChrome(doc: Document): boolean {
  return doc.querySelector("[id^='nav-pillar-']") !== null;
}

function readHr(doc: Document): EmbeddedHistoryView | null {
  const parents = shownButtons(doc).filter((button) => {
    const navId = button.getAttribute("data-nav-id") ?? "";
    return navIdPattern.test(navId) && outsideMain(doc, button);
  });
  if (parents.length === 0) return null;
  const child = shownButtons(doc).find((button) => {
    if (button.hasAttribute("data-nav-id") || !outsideMain(doc, button)) return false;
    if (!button.classList.contains("text-indigo-300") || !button.classList.contains("font-medium")) return false;
    const label = textOf(button);
    return label.length > 0 && label.length <= 80 && Boolean(groupNavId(button));
  });
  if (child) {
    const navId = groupNavId(child) ?? "";
    const childLabel = textOf(child);
    if (!navIdPattern.test(navId)) return null;
    return { key: `hr:${navId}:${childLabel}`, hr: { navId, childLabel } };
  }
  const active = parents.find((button) => button.classList.contains("bg-indigo-600"));
  const navId = active?.getAttribute("data-nav-id") ?? "";
  if (!active || !navIdPattern.test(navId)) return null;
  return { key: `hr:${navId}:`, hr: { navId } };
}

function groupNavId(button: HTMLElement): string | null {
  const group = button.parentElement?.parentElement;
  const navId = group?.querySelector("button[data-nav-id]")?.getAttribute("data-nav-id") ?? "";
  return navIdPattern.test(navId) ? navId : null;
}

function isNavigationControl(button: HTMLElement): boolean {
  if (pillarIdPattern.test(button.id)) return true;
  const navId = button.getAttribute("data-nav-id") ?? "";
  if (navIdPattern.test(navId)) return true;
  if (groupNavId(button)) return true;
  const doc = button.ownerDocument;
  if (!outsideMain(doc, button)) return false;
  const label = controlLabel(button);
  return label.length > 0 && label.length <= 90;
}

function hasHrChrome(doc: Document): boolean {
  return doc.querySelector("button[data-nav-id]") !== null;
}

function readUrl(doc: Document): EmbeddedHistoryView | null {
  const win = doc.defaultView;
  if (!win) return null;
  let href = "";
  try {
    href = win.location.href;
  } catch {
    return null;
  }
  if (!href || href === "about:blank" || !isInAppUrl(href, href)) return null;
  return { key: `url:${href}`, url: href };
}

export function readEmbeddedView(doc: Document): EmbeddedHistoryView | null {
  if (hasFinanceChrome(doc)) return readFinance(doc);
  if (hasHrChrome(doc)) return readHr(doc);
  const root = doc.getElementById("root");
  if (root && root.childElementCount === 0) return null;
  return readUrl(doc);
}

function clickIfNeeded(button: HTMLElement, activeClass: string): void {
  if (!button.classList.contains(activeClass)) button.click();
}

export function restoreEmbeddedView(doc: Document, view: EmbeddedHistoryView): void {
  if (view.finance && pillarIdPattern.test(view.finance.pillarId)) {
    const pillar = doc.getElementById(view.finance.pillarId);
    if (!(pillar instanceof HTMLElement) || !isShown(pillar)) return;
    const pillarReady = pillar.classList.contains("bg-slate-900");
    if (!pillarReady) {
      pillar.click();
      return;
    }
    const sub = financeSubButton(doc, view.finance.subId, view.finance.subLabel);
    if (sub) clickIfNeeded(sub, "bg-slate-900");
    return;
  }
  if (view.hr && navIdPattern.test(view.hr.navId)) {
    if (view.hr.childLabel) {
      const child = hrChildButton(doc, view.hr.navId, view.hr.childLabel);
      if (child) {
        if (!child.classList.contains("text-indigo-300")) child.click();
        return;
      }
    }
    const parent = shownButtons(doc).find((button) => button.getAttribute("data-nav-id") === view.hr?.navId && outsideMain(doc, button));
    if (parent) clickIfNeeded(parent, "bg-indigo-600");
    return;
  }
  if (!view.url) return;
  const win = doc.defaultView;
  if (!win) return;
  let current = "";
  try {
    current = win.location.href;
  } catch {
    return;
  }
  if (current === view.url || !isInAppUrl(current, view.url)) return;
  win.location.assign(view.url);
}

function financeSubButton(doc: Document, subId: string | undefined, subLabel: string | undefined): HTMLElement | null {
  if (subId && /^nav-[a-z0-9-]+$/.test(subId)) {
    const byId = doc.getElementById(subId);
    if (byId instanceof HTMLElement && isShown(byId) && outsideMain(doc, byId)) return byId;
  }
  if (!subLabel) return null;
  return shownButtons(doc).find((button) => !pillarIdPattern.test(button.id) && outsideMain(doc, button) && controlLabel(button) === subLabel) ?? null;
}

function hrChildButton(doc: Document, navId: string, childLabel: string): HTMLElement | null {
  return shownButtons(doc).find((button) => {
    if (button.hasAttribute("data-nav-id") || !outsideMain(doc, button)) return false;
    return groupNavId(button) === navId && textOf(button) === childLabel;
  }) ?? null;
}

export function watchEmbeddedHistory(
  doc: Document,
  onAvailability: (availability: EmbeddedHistoryAvailability) => void,
): { back: () => void; forward: () => void; dispose: () => void } {
  let state = emptyVisits();
  let disposed = false;
  let quiet = false;
  let restoreGen = 0;
  let phaseGen = 0;
  let phase: "idle" | "await-change" | "follow-up" = "idle";
  let reported: EmbeddedHistoryAvailability = { canBack: false, canForward: false };
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const later = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!disposed) fn();
    }, ms);
    timers.add(id);
  };

  const publish = () => {
    const next = { canBack: canGoBack(state), canForward: canGoForward(state) };
    if (next.canBack === reported.canBack && next.canForward === reported.canForward) return;
    reported = next;
    onAvailability(next);
  };

  const remember = (view: EmbeddedHistoryView, source: "user" | "settle") => {
    const next = recordVisit(state, view, source);
    if (next === state) return;
    state = next;
    publish();
  };

  const settleStart = () => {
    if (quiet || phase !== "idle") return;
    if (state.index > 0 || state.entries.length > 1) return;
    const view = readEmbeddedView(doc);
    if (!view) return;
    remember(view, "settle");
  };

  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleSettle = () => {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      timers.delete(settleTimer as ReturnType<typeof setTimeout>);
      settleStart();
    }, 180);
    timers.add(settleTimer);
  };

  const onClick = (event: Event) => {
    if (disposed || quiet) return;
    const mouse = event as MouseEvent;
    if (mouse.button !== 0 || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    const navControl = target?.closest("button, a");
    const inAppControl = navControl instanceof HTMLElement && isNavigationControl(navControl);
    // Trusted clicks are real pointer and keyboard activation. Untrusted clicks are
    // limited to the app's own navigation controls so scripted hotel-screen redirects
    // during the follow-up window do not become extra history steps.
    if (!mouse.isTrusted && (!inAppControl || phase === "follow-up")) return;
    const current = readEmbeddedView(doc);
    if (current) {
      if (state.entries.length === 0) remember(current, "settle");
      else if (state.index === 0 && state.entries.length === 1 && state.entries[0]?.key !== current.key) remember(current, "settle");
    }
    phase = "await-change";
    const generation = ++phaseGen;
    later(() => {
      if (generation === phaseGen && phase === "await-change") onMutate();
    }, 40);
    later(() => {
      if (generation === phaseGen && phase === "await-change") onMutate();
    }, 160);
    later(() => {
      if (generation === phaseGen) phase = "idle";
    }, 700);
  };

  const onMutate = () => {
    if (disposed || quiet) return;
    const view = readEmbeddedView(doc);
    if (!view) {
      if (phase === "idle") scheduleSettle();
      return;
    }
    const topKey = state.entries[state.index]?.key;
    if (phase === "await-change") {
      if (view.key === topKey) return;
      remember(view, "user");
      phase = "follow-up";
      return;
    }
    if (phase === "follow-up") {
      if (view.key === topKey) return;
      const next = replaceLatestVisit(state, view);
      if (next !== state) state = next;
      return;
    }
    scheduleSettle();
  };

  const restoreNow = (view: EmbeddedHistoryView, gen: number) => {
    if (disposed || gen !== restoreGen) return;
    restoreEmbeddedView(doc, view);
  };

  const go = (direction: "back" | "forward") => {
    if (disposed) return;
    const next = direction === "back" ? moveBack(state) : moveForward(state);
    if (next === state) return;
    state = next;
    phase = "idle";
    const gen = ++restoreGen;
    quiet = true;
    publish();
    const view = state.entries[state.index];
    if (!view) {
      quiet = false;
      return;
    }
    restoreNow(view, gen);
    later(() => restoreNow(view, gen), 70);
    later(() => restoreNow(view, gen), 180);
    later(() => restoreNow(view, gen), 320);
    later(() => {
      if (gen === restoreGen) quiet = false;
    }, 460);
  };

  doc.addEventListener("click", onClick, true);
  const observer = new MutationObserver(onMutate);
  if (doc.documentElement) {
    observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  }
  scheduleSettle();

  return {
    back: () => go("back"),
    forward: () => go("forward"),
    dispose: () => {
      disposed = true;
      restoreGen += 1;
      quiet = true;
      phase = "idle";
      observer.disconnect();
      doc.removeEventListener("click", onClick, true);
      for (const id of timers) clearTimeout(id);
      timers.clear();
      if (settleTimer) clearTimeout(settleTimer);
    },
  };
}
