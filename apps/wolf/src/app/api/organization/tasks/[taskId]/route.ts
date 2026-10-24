import { organizationResponse } from "../../respond";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await context.params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "The task fields are not valid." }, { status: 400 });
  }
  if (body.action === "reassign") return organizationResponse({ kind: "reassign", taskId, body });
  return organizationResponse({ kind: "transition", taskId, body });
}
