"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { watchEmbeddedHistory, type EmbeddedHistoryAvailability } from "./embedded-app-history";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ECB956]";

export function EmbeddedAppFrame({ title, src }: { title: string; src: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const historyRef = useRef<ReturnType<typeof watchEmbeddedHistory> | null>(null);
  const [availability, setAvailability] = useState<EmbeddedHistoryAvailability>({ canBack: false, canForward: false });

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let current: ReturnType<typeof watchEmbeddedHistory> | null = null;

    const attach = () => {
      current?.dispose();
      current = null;
      historyRef.current = null;
      setAvailability({ canBack: false, canForward: false });
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      if (!doc || !win) return;
      let href = "";
      try {
        href = win.location.href;
      } catch {
        return;
      }
      if (!href || href === "about:blank") return;
      current = watchEmbeddedHistory(doc, setAvailability);
      historyRef.current = current;
    };

    iframe.addEventListener("load", attach);
    attach();
    return () => {
      iframe.removeEventListener("load", attach);
      current?.dispose();
      historyRef.current = null;
    };
  }, [src]);

  return (
    <div className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-background" data-embedded-app-frame="">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-white/10 bg-[#182435] px-3">
        <Link
          href="/"
          aria-label="Wolf"
          className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-semibold text-white ${focusRing}`}
        >
          <span aria-hidden="true">←</span>
          Wolf
        </Link>
        <span className="mx-1 h-4 w-px shrink-0 bg-white/15" aria-hidden="true" />
        <button
          type="button"
          className={`inline-flex items-center rounded-md px-2.5 py-1.5 text-sm font-medium text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-white/35 disabled:hover:bg-transparent ${focusRing}`}
          disabled={!availability.canBack}
          onClick={() => historyRef.current?.back()}
        >
          Back
        </button>
        <button
          type="button"
          className={`inline-flex items-center rounded-md px-2.5 py-1.5 text-sm font-medium text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-white/35 disabled:hover:bg-transparent ${focusRing}`}
          disabled={!availability.canForward}
          onClick={() => historyRef.current?.forward()}
        >
          Forward
        </button>
      </header>
      <iframe ref={iframeRef} title={title} src={src} className="block h-full min-h-0 w-full flex-1 border-0 bg-background" />
    </div>
  );
}
