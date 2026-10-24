export const assistantNotConfigured = "The assistant is unavailable until it is configured.";
export const assistantUnavailable = "The assistant is unavailable.";

export type ModelToolSpec = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    additionalProperties: false;
    required?: string[];
    properties: Record<string, { type: "string"; maxLength?: number; enum?: readonly string[] }>;
  };
};

export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: unknown }>;
};

export type ModelCompletion = {
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: unknown }>;
  failure?: string;
};

export type ModelProvider = {
  id: string;
  availability(): { state: "ready" } | { state: "unavailable"; message: typeof assistantNotConfigured };
  scrub(text: string): string;
  complete(input: { messages: ModelMessage[]; tools: ModelToolSpec[] }, signal: AbortSignal): Promise<ModelCompletion>;
};

export function scrubText(text: string, secret: string): string {
  if (secret.length < 8) return text;
  return text.split(secret).join("[redacted]");
}
