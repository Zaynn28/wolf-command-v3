import { organizationResponse } from "../../respond";

export async function GET(_request: Request, context: { params: Promise<{ personId: string }> }) {
  const { personId } = await context.params;
  return organizationResponse({ kind: "person", personId });
}
