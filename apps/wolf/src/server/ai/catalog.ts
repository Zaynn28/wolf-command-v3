import { authorize, type Action, type Actor } from "@wolf/shared";
import { evaluateModuleAccess, isModuleId, moduleIds } from "../access/matrix";
import { financeWorkspace } from "../finance/companies";
import { hrAccess } from "../hr/companies";
import { readOrganizationTree, readStaffProgress, readTaskOverview } from "../organization/service";
import type { AuthDatabase } from "../db/types";
import { describeCapabilities } from "./capabilities";
import type { ModelToolSpec } from "./provider";

const maxRows = 20;
const actions = ["read", "create", "update", "delete", "approve"] as const;
const safeReasons = new Set([
  "not_permitted",
  "missing_actor",
  "self",
  "wrong_company",
  "membership",
  "module_scope",
  "role_required",
  "owner_private_grant_required",
  "approval_grant_required",
  "explicit_grant",
  "unknown_action",
  "malformed_scope",
  "outside_department",
]);

type ArgSchema = ModelToolSpec["parameters"];

export type ToolState = "ok" | "denied" | "invalid" | "unavailable" | "rejected" | "failed";

export type CatalogTool = {
  name: string;
  description: string;
  permission: string;
  scope: "company";
  readOnly: boolean;
  confirmation: "none" | "unavailable";
  audit: true;
  status: "available" | "unavailable";
  unavailableNote?: string;
  parameters: ArgSchema;
};

export type ToolRun = { state: ToolState; note: string; data: unknown };

const querySchema: ArgSchema = {
  type: "object",
  additionalProperties: false,
  properties: { query: { type: "string", maxLength: 80 } },
};

const emptySchema: ArgSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

const denialSchema: ArgSchema = {
  type: "object",
  additionalProperties: false,
  required: ["module", "action"],
  properties: {
    module: { type: "string", enum: moduleIds },
    action: { type: "string", enum: actions },
  },
};

export const assistantToolCatalog: readonly CatalogTool[] = [
  {
    name: "organization.search_people",
    description: "Search HR employees in the conversation company. Results are limited to that company's HR directory.",
    permission: "ai.read.organization",
    scope: "company",
    readOnly: true,
    confirmation: "none",
    audit: true,
    status: "available",
    parameters: querySchema,
  },
  {
    name: "organization.read_tasks",
    description: "Read organization tasks and staff progress already visible to this account in the conversation company. Counts come only from those rows.",
    permission: "ai.read.organization",
    scope: "company",
    readOnly: true,
    confirmation: "none",
    audit: true,
    status: "available",
    parameters: emptySchema,
  },
  {
    name: "access.effective_modules",
    description: "List this account's module decisions for the conversation company. Unavailable assistant capabilities are not grants.",
    permission: "ai.chat",
    scope: "company",
    readOnly: true,
    confirmation: "none",
    audit: true,
    status: "available",
    parameters: emptySchema,
  },
  {
    name: "access.explain_denial",
    description: "Explain one module decision for the conversation company using the evaluator reason. Does not return records.",
    permission: "ai.chat",
    scope: "company",
    readOnly: true,
    confirmation: "none",
    audit: true,
    status: "available",
    parameters: denialSchema,
  },
  {
    name: "finance.read",
    description: "Finance records are not connected to the assistant.",
    permission: "ai.read.finance",
    scope: "company",
    readOnly: true,
    confirmation: "none",
    audit: true,
    status: "unavailable",
    unavailableNote: "Finance is not connected to the assistant.",
    parameters: emptySchema,
  },
  {
    name: "hr.read",
    description: "HR records are not connected to the assistant.",
    permission: "ai.read.hr",
    scope: "company",
    readOnly: true,
    confirmation: "none",
    audit: true,
    status: "unavailable",
    unavailableNote: "HR is not connected to the assistant.",
    parameters: emptySchema,
  },
  {
    name: "organization.create_task",
    description: "Create a task. Unavailable until a confirmation is bound to the exact change.",
    permission: "ai.execute.organization.create_task",
    scope: "company",
    readOnly: false,
    confirmation: "unavailable",
    audit: true,
    status: "unavailable",
    unavailableNote: "Task creation stays unavailable until confirmation is bound to the exact change.",
    parameters: emptySchema,
  },
  {
    name: "organization.assign_task",
    description: "Assign a task. Unavailable until a confirmation is bound to the exact change.",
    permission: "ai.execute.organization.assign_task",
    scope: "company",
    readOnly: false,
    confirmation: "unavailable",
    audit: true,
    status: "unavailable",
    unavailableNote: "Task assignment stays unavailable until confirmation is bound to the exact change.",
    parameters: emptySchema,
  },
];

export function modelToolSpecs(): ModelToolSpec[] {
  return assistantToolCatalog
    .filter((tool) => tool.status === "available")
    .map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
}

export async function runCatalogTool(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
  now: Date,
  call: { name: string; arguments: unknown },
): Promise<ToolRun> {
  const tool = assistantToolCatalog.find((item) => item.name === call.name);
  if (!tool) return { state: "rejected", note: "That tool is not registered.", data: null };
  if (tool.status !== "available") {
    return { state: "unavailable", note: tool.unavailableNote ?? "That tool is unavailable.", data: { connected: false } };
  }
  const parsed = parseArgs(tool.parameters, call.arguments);
  if (!parsed.ok) return { state: "invalid", note: parsed.error, data: null };
  if (evaluateModuleAccess(actor, "organization", "read", { companyId }).outcome !== "allow") {
    return { state: "denied", note: "Organization is not available for this company.", data: null };
  }
  try {
    if (tool.name === "organization.search_people") return searchPeople(db, actor, companyId, textArg(parsed.value.query));
    if (tool.name === "organization.read_tasks") return readTasks(db, actor, companyId, now);
    if (tool.name === "access.effective_modules") return effectiveModules(actor, companyId);
    return explainDenial(actor, companyId, textArg(parsed.value.module), textArg(parsed.value.action));
  } catch {
    return { state: "failed", note: "The tool failed.", data: null };
  }
}

async function searchPeople(db: AuthDatabase, actor: Actor, companyId: string, query: string): Promise<ToolRun> {
  const result = await readOrganizationTree(db, actor, companyId, query);
  if (result.status !== 200 || !("tree" in result.body)) {
    return { state: "denied", note: "Organization is not available for this company.", data: null };
  }
  const people = result.body.tree.companies
    .filter((company) => company.id === companyId)
    .flatMap((company) =>
      company.departments.flatMap((department) =>
        department.positions
          .filter((position) => position.person)
          .map((position) => ({
            id: position.person?.id,
            displayName: position.person?.displayName,
            employeeCode: position.person?.employeeCode ?? null,
            employmentStatus: position.person?.employmentStatus,
            isDemo: false as const,
            companyId,
            departmentName: department.name,
            positionTitle: position.title,
          })),
      ),
    );
  const rows = people.slice(0, maxRows);
  return {
    state: "ok",
    note: `${rows.length} organization people in this company.`,
    data: { companyId, truncated: people.length > rows.length, people: rows },
  };
}

async function readTasks(db: AuthDatabase, actor: Actor, companyId: string, now: Date): Promise<ToolRun> {
  const admin = evaluateModuleAccess(actor, "organization", "create", { companyId }).outcome === "allow";
  const owner =
    authorize({ actor, action: "read", resource: { kind: "owner_private", companyId } }).outcome === "allow";
  const scope = admin ? "company" : owner ? "owner" : "assigned";
  const today = now.toISOString().slice(0, 10);
  const overview = await readTaskOverview(db, actor, { companyId, from: "2000-01-01", to: "2100-01-01", today, scope });
  if (overview.status !== 200 || !("tasks" in overview.body)) {
    return { state: "denied", note: "Organization is not available for this company.", data: null };
  }
  const tasks = overview.body.tasks
    .filter((task) => task.companyId === companyId)
    .slice(0, maxRows)
    .map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      companyId: task.companyId,
      dueOn: task.dueOn,
      assigneeName: task.assigneeName,
      isDemo: true as const,
    }));
  let staffProgress: unknown = null;
  if (admin || owner) {
    const progress = await readStaffProgress(db, actor, { companyId, today });
    if (progress.status === 200 && "people" in progress.body) {
      const people = progress.body.people.slice(0, maxRows).map((person) => {
        const personTasks = person.tasks.filter((task) => task.companyId === companyId).slice(0, maxRows);
        return {
          id: person.id,
          displayName: person.displayName,
          isDemo: person.isDemo,
          companyId,
          counts: countTasks(personTasks.map((task) => ({ status: task.status, overdue: task.overdue }))),
        };
      });
      staffProgress = { demo: true, companyId, people };
    }
  }
  return {
    state: "ok",
    note: staffProgress
      ? `${tasks.length} organization tasks in this company.`
      : `${tasks.length} assigned organization tasks. Staff progress is not available for this account.`,
    data: { demo: true, companyId, scope, tasks, staffProgress },
  };
}

function effectiveModules(actor: Actor, companyId: string): ToolRun {
  const organizationRead = evaluateModuleAccess(actor, "organization", "read", { companyId }).outcome === "allow";
  const modules = moduleIds.map((module) => {
    const decision = evaluateModuleAccess(actor, module, "read", { companyId });
    return { module, action: "read" as const, outcome: decision.outcome, reason: publicReason(decision.reason) };
  });
  return {
    state: "ok",
    note: "Module decisions for this company.",
    data: {
      companyId,
      wolfModules: modules,
      financeWorkspace: financeWorkspace(actor, companyId),
      hrAccess: hrAccess(actor, companyId),
      capabilities: describeCapabilities(organizationRead),
    },
  };
}

function explainDenial(actor: Actor, companyId: string, moduleName: string, actionName: string): ToolRun {
  if (!isModuleId(moduleName) || !isAction(actionName)) {
    return { state: "invalid", note: "That module decision cannot be explained.", data: null };
  }
  const decision = evaluateModuleAccess(actor, moduleName, actionName, { companyId });
  return {
    state: "ok",
    note: `${moduleName} ${actionName} is ${decision.outcome}.`,
    data: {
      companyId,
      module: moduleName,
      action: actionName,
      outcome: decision.outcome,
      reason: publicReason(decision.reason),
    },
  };
}

function countTasks(tasks: Array<{ status: string; overdue: boolean }>): Record<string, number> {
  const counts: Record<string, number> = {
    ASSIGNED: 0,
    ACCEPTED: 0,
    IN_PROGRESS: 0,
    BLOCKED: 0,
    IN_REVIEW: 0,
    COMPLETED: 0,
    overdue: 0,
  };
  for (const task of tasks) {
    if (task.status in counts) counts[task.status] += 1;
    if (task.overdue) counts.overdue += 1;
  }
  return counts;
}

function publicReason(reason: string): string {
  return safeReasons.has(reason) ? reason : "denied";
}

function isAction(value: string): value is Action {
  return (actions as readonly string[]).includes(value);
}

function textArg(value: string | undefined): string {
  return value ?? "";
}

function parseArgs(
  schema: ArgSchema,
  value: unknown,
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  let record = value;
  if (typeof record === "string") {
    try {
      record = JSON.parse(record) as unknown;
    } catch {
      return { ok: false, error: "Tool arguments are not valid." };
    }
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { ok: false, error: "Tool arguments must be an object." };
  }
  let encoded = "";
  try {
    encoded = JSON.stringify(record);
  } catch {
    return { ok: false, error: "Tool arguments are not valid." };
  }
  if (encoded.length > 2000) return { ok: false, error: "Tool arguments are too long." };
  const entries = Object.entries(record);
  for (const [key] of entries) {
    if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) {
      return { ok: false, error: "Tool arguments include an unsupported field." };
    }
  }
  for (const key of schema.required ?? []) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      return { ok: false, error: "Tool arguments are missing a required field." };
    }
  }
  const parsed: Record<string, string> = {};
  for (const [key, spec] of Object.entries(schema.properties)) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const raw = (record as Record<string, unknown>)[key];
    if (typeof raw !== "string") return { ok: false, error: "A tool argument has the wrong type." };
    if (spec.maxLength && raw.length > spec.maxLength) return { ok: false, error: "A tool argument is too long." };
    if (spec.enum && !spec.enum.includes(raw)) return { ok: false, error: "A tool argument is not an allowed value." };
    parsed[key] = raw;
  }
  return { ok: true, value: parsed };
}
