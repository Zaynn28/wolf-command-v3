export const taskStatuses = ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "COMPLETED"] as const;

export type TaskStatus = (typeof taskStatuses)[number];

export const taskActions = ["accept", "start", "block", "resume", "submit", "complete", "approve", "return"] as const;

export type TaskAction = (typeof taskActions)[number];

export type TransitionTask = {
  status: TaskStatus;
  reviewRequired: boolean;
  submittedByUserId: string | null;
};

export function transitionTask(
  task: TransitionTask,
  action: TaskAction,
  actorUserId: string,
): { ok: true; status: TaskStatus; submits: boolean } | { ok: false; reason: string } {
  if (action === "approve" && task.submittedByUserId === actorUserId) {
    return { ok: false, reason: "self_approval" };
  }
  const next = nextStatus(task, action);
  if (!next) return { ok: false, reason: "invalid_transition" };
  return { ok: true, status: next, submits: action === "submit" };
}

function nextStatus(task: TransitionTask, action: TaskAction): TaskStatus | null {
  if (action === "accept" && task.status === "ASSIGNED") return "ACCEPTED";
  if (action === "start" && task.status === "ACCEPTED") return "IN_PROGRESS";
  if (action === "block" && task.status === "IN_PROGRESS") return "BLOCKED";
  if (action === "resume" && task.status === "BLOCKED") return "IN_PROGRESS";
  if (action === "submit" && task.status === "IN_PROGRESS" && task.reviewRequired) return "IN_REVIEW";
  if (action === "complete" && task.status === "IN_PROGRESS" && !task.reviewRequired) return "COMPLETED";
  if (action === "approve" && task.status === "IN_REVIEW" && task.reviewRequired) return "COMPLETED";
  if (action === "return" && task.status === "IN_REVIEW") return "IN_PROGRESS";
  return null;
}

export function reasonRequired(action: TaskAction): boolean {
  return action === "block" || action === "return";
}
