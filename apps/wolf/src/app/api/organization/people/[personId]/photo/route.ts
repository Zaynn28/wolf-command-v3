import { loadActorContext } from "@/server/access/session-actor";
import { openBoardPerson } from "@/server/organization/board";
import { fetchHrPhoto } from "@/server/organization/hr-board";

export async function GET(_request: Request, context: { params: Promise<{ personId: string }> }) {
  const actor = await loadActorContext();
  if (actor.status !== "ready") return Response.json({ error: "Sign in is required." }, { status: actor.status === "signed_out" ? 401 : 403 });
  const { personId } = await context.params;
  const opened = openBoardPerson(actor.actor, personId);
  if (opened.status !== 200) return Response.json({ error: opened.error }, { status: opened.status });
  if (!opened.canEdit) return Response.json({ error: "No profile photo is stored." }, { status: 404 });
  const photo = await fetchHrPhoto(opened.companyId, actor.actor.userId, opened.employeeCode);
  if (!photo) return Response.json({ error: "No profile photo is stored." }, { status: 404 });
  return new Response(Buffer.from(photo.bytes), {
    headers: {
      "content-type": photo.mime,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
