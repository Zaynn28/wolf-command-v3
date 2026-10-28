import { loadActorContext } from "@/server/access/session-actor";
import { openBoardPerson } from "@/server/organization/board";
import { fetchHrContact } from "@/server/organization/hr-board";

export async function GET(_request: Request, context: { params: Promise<{ personId: string }> }) {
  const actor = await loadActorContext();
  if (actor.status !== "ready") return Response.json({ error: "Sign in is required." }, { status: actor.status === "signed_out" ? 401 : 403 });
  const { personId } = await context.params;
  const opened = openBoardPerson(actor.actor, personId);
  if (opened.status !== 200) return Response.json({ error: opened.error }, { status: opened.status });
  const contact = await fetchHrContact(opened.companyId, actor.actor.userId, opened.employeeCode);
  if (!contact) return Response.json({ error: "That person is not available." }, { status: 404 });
  return Response.json({ email: contact.email, phone: contact.phone });
}
