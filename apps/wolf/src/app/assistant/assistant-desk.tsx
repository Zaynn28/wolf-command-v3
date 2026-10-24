"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type TranscriptMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  toolName: string | null;
};

type LiveTool = { id: string; name: string; state: string; note: string };

export function AssistantDesk({
  companyId,
  conversationId,
  configured,
  messages,
}: {
  companyId: string;
  conversationId: string | null;
  configured: boolean;
  messages: TranscriptMessage[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [tools, setTools] = useState<LiveTool[]>([]);
  const [answer, setAnswer] = useState("");
  const [failure, setFailure] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || pending || !configured) return;
    setPending(true);
    setTools([]);
    setAnswer("");
    setFailure("");
    let nextConversation = conversationId;
    let saved = false;
    const applyEvent = (part: string) => {
      const dataLine = part.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) return;
      const payload = JSON.parse(dataLine.slice(6)) as {
        type?: string;
        conversationId?: string;
        name?: string;
        state?: string;
        note?: string;
        text?: string;
        message?: string;
      };
      if (payload.type === "meta" && payload.conversationId) {
        nextConversation = payload.conversationId;
        saved = true;
      }
      if (payload.type === "tool") {
        setTools((current) => [
          ...current,
          { id: `${current.length}-${payload.name ?? "tool"}`, name: payload.name ?? "tool", state: payload.state ?? "failed", note: payload.note ?? "" },
        ]);
      }
      if (payload.type === "text" && payload.text) setAnswer((current) => `${current}${payload.text}`);
      if (payload.type === "failure" && payload.message) setFailure(payload.message);
    };
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId, conversationId, message }),
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setFailure(body?.error ?? "The assistant is unavailable.");
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) applyEvent(part);
      }
    } catch {
      setFailure("The assistant is unavailable.");
    } finally {
      setPending(false);
      if (saved && nextConversation) {
        setDraft("");
        router.replace(`/assistant?companyId=${companyId}&conversation=${nextConversation}`);
        router.refresh();
      }
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {messages.map((message) => (
          <MessageBlock key={message.id} role={message.role} title={labelFor(message.role, message.toolName)} text={message.text} />
        ))}
        {tools.length > 0 ? (
          <div className="rounded-lg border border-dashed border-line bg-surface px-4 py-3">
            <h2 className="text-sm font-medium">Tool activity</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {tools.map((tool) => (
                <li key={tool.id} className="text-sm text-muted">
                  <span className="text-foreground">{tool.name}</span> {tool.state}. {tool.note}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {answer ? <MessageBlock role="assistant" title="Answer" text={answer} /> : null}
        {failure ? <MessageBlock role="failure" title="Failure" text={failure} /> : null}
      </div>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor="assistant-message">
          Message
        </label>
        <textarea
          id="assistant-message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={!configured || pending}
          rows={4}
          maxLength={4000}
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm disabled:opacity-60"
          placeholder={configured ? "Ask about this company's organization." : "The assistant is unavailable until it is configured."}
        />
        <button
          type="submit"
          disabled={!configured || pending || draft.trim().length === 0}
          className="w-fit rounded-md border border-accent bg-accent px-3 py-2 text-sm font-medium text-on-accent disabled:opacity-60"
        >
          {pending ? "Working" : "Send"}
        </button>
      </form>
    </section>
  );
}

function MessageBlock({ role, title, text }: { role: string; title: string; text: string }) {
  const failure = role === "failure";
  return (
    <article className={`rounded-lg border px-4 py-3 ${failure ? "border-accent bg-surface" : "border-line bg-surface"}`}>
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{text}</p>
    </article>
  );
}

function labelFor(role: TranscriptMessage["role"], toolName: string | null): string {
  if (role === "user") return "You";
  if (role === "tool") return toolName ? `Tool activity · ${toolName}` : "Tool activity";
  return "Answer";
}
