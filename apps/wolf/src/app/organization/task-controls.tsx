"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TaskAction } from "@/server/organization/transitions";

const labels: Record<TaskAction, string> = {
  accept: "Accept",
  start: "Start",
  block: "Mark blocked",
  resume: "Resume",
  submit: "Submit for review",
  complete: "Complete",
  approve: "Approve",
  return: "Return",
};

export function TaskControls({ taskId, actions }: { taskId: string; actions: TaskAction[] }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<TaskAction | null>(null);

  async function run(action: TaskAction) {
    setPending(action);
    setError("");
    const response = await fetch(`/api/organization/tasks/${taskId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, note, evidenceUrl: evidenceUrl || null }),
    });
    setPending(null);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "The task was not updated.");
      return;
    }
    setNote("");
    router.refresh();
  }

  if (actions.length === 0) return null;
  return (
    <div className="mt-4 flex flex-col gap-3">
      <label className="text-sm text-muted">
        Note
        <textarea value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 w-full rounded-md border border-line bg-background px-3 py-2 text-sm text-foreground" rows={2} />
      </label>
      <label className="text-sm text-muted">
        Evidence link
        <input value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="https://" className="mt-1 w-full rounded-md border border-line bg-background px-3 py-2 text-sm text-foreground" />
      </label>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <button key={action} type="button" disabled={pending !== null} onClick={() => void run(action)} className="rounded-md border border-line bg-raised px-3 py-2 text-sm font-medium text-foreground disabled:opacity-50">
            {pending === action ? "Saving…" : labels[action]}
          </button>
        ))}
      </div>
      {error ? <p className="text-sm text-muted">{error}</p> : null}
    </div>
  );
}
