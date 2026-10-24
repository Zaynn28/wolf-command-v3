import {
  assistantNotConfigured,
  assistantUnavailable,
  scrubText,
  type ModelCompletion,
  type ModelMessage,
  type ModelProvider,
  type ModelToolSpec,
} from "./provider";

const endpoint = "https://api.x.ai/v1/chat/completions";
const defaultModel = "grok-4";

export type GrokConfig = { apiKey?: string; model?: string };

type GrokResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
};

export function createGrokProvider(config: GrokConfig, fetchImpl: typeof fetch = fetch): ModelProvider {
  const key = config.apiKey?.trim() ?? "";
  const model = cleanModel(config.model) ?? defaultModel;
  const scrub = (text: string) => scrubText(text, key);
  return {
    id: "grok",
    availability() {
      return key ? { state: "ready" } : { state: "unavailable", message: assistantNotConfigured };
    },
    scrub,
    async complete(input, signal) {
      if (!key) return { text: "", toolCalls: [], failure: assistantNotConfigured };
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          signal,
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            messages: input.messages.map((message) => toGrokMessage(message)),
            tools: input.tools.map(toGrokTool),
          }),
        });
        if (!response.ok) return { text: "", toolCalls: [], failure: assistantUnavailable };
        const payload = (await response.json()) as GrokResponse;
        return scrubCompletion(readCompletion(payload), scrub);
      } catch {
        return { text: "", toolCalls: [], failure: assistantUnavailable };
      }
    },
  };
}

function cleanModel(value: string | undefined): string | null {
  const model = value?.trim() ?? "";
  return /^grok-[a-z0-9][a-z0-9.-]{0,40}$/.test(model) ? model : null;
}

function toGrokMessage(message: ModelMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId ?? "tool", content: message.content };
  }
  if (message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

function toGrokTool(tool: ModelToolSpec): Record<string, unknown> {
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}

function readCompletion(payload: GrokResponse): ModelCompletion {
  const message = payload.choices?.[0]?.message;
  const toolCalls = (message?.tool_calls ?? []).map((call, index) => ({
    id: typeof call.id === "string" && call.id.trim() ? call.id.slice(0, 80) : `tool-${index + 1}`,
    name: typeof call.function?.name === "string" ? call.function.name.slice(0, 80) : "",
    arguments: parseArguments(call.function?.arguments),
  }));
  return { text: typeof message?.content === "string" ? message.content : "", toolCalls };
}

function parseArguments(value: string | undefined): unknown {
  if (!value) return {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function scrubCompletion(completion: ModelCompletion, scrub: (text: string) => string): ModelCompletion {
  return {
    text: scrub(completion.text),
    failure: completion.failure ? scrub(completion.failure) : undefined,
    toolCalls: completion.toolCalls.map((call) => ({
      id: scrub(call.id),
      name: scrub(call.name),
      arguments: scrubUnknown(call.arguments, scrub),
    })),
  };
}

function scrubUnknown(value: unknown, scrub: (text: string) => string): unknown {
  if (typeof value === "string") return scrub(value);
  if (Array.isArray(value)) return value.map((item) => scrubUnknown(item, scrub));
  if (!value || typeof value !== "object") return value;
  const record: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) record[scrub(key)] = scrubUnknown(item, scrub);
  return record;
}
