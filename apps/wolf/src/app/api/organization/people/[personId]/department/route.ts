import { loadActorContext } from "@/server/access/session-actor";
import { openBoardPerson } from "@/server/organization/board";
import { changeHrDepartment } from "@/server/organization/hr-board";

export async function POST(request: Request, context: { params: Promise<{ personId: string }> }) {
  const actor = await loadActorContext();
  if (actor.status !== "ready") return Response.json({ error: "Sign in is required." }, { status: actor.status === "signed_out" ? 401 : 403 });
  const { personId } = await context.params;
  const opened = openBoardPerson(actor.actor, personId);
  if (opened.status !== 200) return Response.json({ error: opened.error }, { status: opened.status });
  if (!opened.canEdit) return Response.json({ error: "HR staff access is required to change a department." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { departmentId?: unknown } | null;
  const departmentId = typeof body?.departmentId === "string" ? body.departmentId : "";
  const saved = await changeHrDepartment(opened.companyId, actor.actor.userId, opened.employeeCode, departmentId);
  if (!saved.ok) return Response.json({ error: saved.error }, { status: 400 });
  return Response.json({ department: saved.departmentName });
}
