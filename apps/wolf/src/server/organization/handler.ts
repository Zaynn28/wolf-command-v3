import type { AuthDatabase } from "../db/types";
import {
  createOrganizationTask,
  openOrganizationActor,
  readOrganizationPerson,
  readOrganizationTree,
  readStaffProgress,
  readTaskOverview,
  reassignOrganizationTask,
  transitionOrganizationTask,
} from "./service";
import { offlineHrDirectory, type HrDirectorySource } from "./hr-directory";

export type OrganizationRequest =
  | { kind: "tree"; companyId: string | null; query: string }
  | { kind: "person"; personId: string }
  | { kind: "tasks"; companyId: string | null; from: string; to: string; today: string; scope: "owner" | "company" | "assigned" }
  | { kind: "progress"; companyId: string | null; today: string; body?: Record<string, unknown> }
  | { kind: "create"; body: Record<string, unknown> }
  | { kind: "transition"; taskId: string; body: Record<string, unknown> }
  | { kind: "reassign"; taskId: string; body: Record<string, unknown> };

export async function serveOrganization(
  db: AuthDatabase,
  token: string | null,
  now: Date,
  request: OrganizationRequest,
  source: HrDirectorySource = offlineHrDirectory,
): Promise<{ status: number; body: unknown }> {
  const opened = await openOrganizationActor(db, token, now);
  if (opened.status !== 200) return { status: opened.status, body: { error: opened.error } };
  if (request.kind === "tree") return readOrganizationTree(db, opened.actor, request.companyId, request.query, source);
  if (request.kind === "person") return readOrganizationPerson(db, opened.actor, request.personId, source);
  if (request.kind === "tasks") return readTaskOverview(db, opened.actor, request, source);
  if (request.kind === "progress") {
    return readStaffProgress(db, opened.actor, { companyId: request.companyId, today: request.today }, source);
  }
  if (request.kind === "create") {
    return createOrganizationTask(db, opened.actor, opened.email, now, {
      companyId: text(request.body.companyId),
      departmentId: optionalText(request.body.departmentId),
      title: text(request.body.title),
      description: text(request.body.description),
      priority: text(request.body.priority),
      dueOn: text(request.body.dueOn),
      completionCriteria: text(request.body.completionCriteria),
      reviewRequired: request.body.reviewRequired === true,
      assigneePersonId: optionalText(request.body.assigneePersonId),
      teamDepartmentId: optionalText(request.body.teamDepartmentId),
    }, source);
  }
  if (request.kind === "transition") {
    return transitionOrganizationTask(
      db,
      opened.actor,
      opened.email,
      now,
      request.taskId,
      text(request.body.action),
      text(request.body.note),
      optionalText(request.body.evidenceUrl),
      source,
    );
  }
  return reassignOrganizationTask(
    db,
    opened.actor,
    opened.email,
    now,
    request.taskId,
    optionalText(request.body.assigneePersonId),
    optionalText(request.body.teamDepartmentId),
    text(request.body.note),
    source,
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
