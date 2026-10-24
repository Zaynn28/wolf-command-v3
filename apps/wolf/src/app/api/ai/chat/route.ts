import { cookies } from "next/headers";
import { connection } from "next/server";
import { sessionCookieName } from "@/server/auth/constants";
import { readAuthConfig } from "@/server/auth/config";
import { serveAssistant, type AssistantEvent } from "@/server/ai/gateway";
import { openAssistantProvider } from "@/server/ai/setup";
import { getDb } from "@/server/db/runtime";

export async function POST(request: Request) {
  await connection();
  const config = readAuthConfig(process.env);
  if (!config) return Response.json({ error: "The assistant is unavailable." }, { status: 503 });
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 20_000) return Response.json({ error: "The message is too long." }, { status: 400 });
    body = JSON.parse(raw) as unknown;
  } catch {
    return Response.json({ error: "The assistant request is not valid." }, { status: 400 });
  }
  try {
    const token = (await cookies()).get(sessionCookieName)?.value ?? null;
    const db = getDb(config.databaseUrl);
    const result = await serveAssistant(db, token, new Date(), body, await openAssistantProvider(db, process.env));
    if (result.status !== 200) return Response.json(result.body, { status: result.status });
    return new Response(eventStream(result.events), {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "The assistant is unavailable." }, { status: 503 });
  }
}

function eventStream(events: AsyncGenerator<AssistantEvent>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        }
      } catch {
        controller.enqueue(
          encoder.encode(`event: failure\ndata: ${JSON.stringify({ type: "failure", message: "The assistant is unavailable." })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });
}
