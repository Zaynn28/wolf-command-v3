"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingLabel,
  tone = "neutral",
}: {
  children: string;
  pendingLabel: string;
  tone?: "neutral" | "primary";
}) {
  const { pending } = useFormStatus();
  const toneClass =
    tone === "primary"
      ? "border border-accent bg-accent text-on-accent"
      : "border border-line bg-raised text-foreground";

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`rounded-md px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 ${toneClass}`}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
