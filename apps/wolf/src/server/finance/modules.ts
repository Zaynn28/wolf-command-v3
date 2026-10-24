import { and, asc, eq } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { writeAudit } from "../auth/audit";
import { financeModules, financeSettings, platformOperators } from "../db/schema";
import type { AuthDatabase } from "../db/types";

export const financeModuleRegistry = [
  { id: "dashboard", label: "Dashboard", core: true, storage: "wolf" },
  { id: "accounting-core", label: "Accounting Core", core: true, storage: "wolf" },
  { id: "reports", label: "Reports", core: true, storage: "wolf" },
  { id: "settings", label: "Company settings", core: true, storage: "wolf" },
  { id: "atrium-workflows", label: "Atrium workflows", core: false, storage: "atrium-memory" },
  { id: "inventory", label: "Inventory", core: false, storage: "atrium-memory" },
  { id: "service-charges", label: "Service charges", core: false, storage: "atrium-memory" },
  { id: "owner-pool", label: "Owner pool", core: false, storage: "atrium-memory" },
  { id: "petty-cash", label: "Petty cash", core: false, storage: "atrium-memory" },
  { id: "tax", label: "Tax", core: false, storage: "atrium-memory" },
  { id: "hotel-operations", label: "Hotel operations", core: false, storage: "atrium-memory" },
  { id: "procurement", label: "Procurement", core: false, storage: "wolf" },
] as const;

export type FinanceModuleId = (typeof financeModuleRegistry)[number]["id"];

export type FinanceModuleState = {
  id: FinanceModuleId;
  label: string;
  core: boolean;
  storage: "wolf" | "atrium-memory";
  enabled: boolean;
};

const moduleIds = new Set<string>(financeModuleRegistry.map((module) => module.id));

export function isFinanceModuleId(value: string): value is FinanceModuleId {
  return moduleIds.has(value);
}

export function defaultFinanceModules(workspaceKind: string): { moduleId: FinanceModuleId; enabled: "Y" | "N" }[] {
  return financeModuleRegistry.map((module) => ({
    moduleId: module.id,
    enabled: module.core || workspaceKind === "amg" ? "Y" : "N",
  }));
}

export async function readFinanceModules(db: AuthDatabase, companyId: string): Promise<FinanceModuleState[]> {
  const rows = await db.select().from(financeModules).where(eq(financeModules.companyId, companyId));
  const enabledById = new Map(rows.map((row) => [row.moduleId, row.enabled === "Y"]));
  return financeModuleRegistry.map((module) => ({
    id: module.id,
    label: module.label,
    core: module.core,
    storage: module.storage,
    enabled: enabledById.get(module.id) === true,
  }));
}

export function moduleEnabled(modules: FinanceModuleState[], moduleId: FinanceModuleId): boolean {
  return modules.some((module) => module.id === moduleId && module.enabled);
}

export async function financeModuleIsEnabled(db: AuthDatabase, companyId: string, moduleId: FinanceModuleId): Promise<boolean> {
  const rows = await db
    .select()
    .from(financeModules)
    .where(and(eq(financeModules.companyId, companyId), eq(financeModules.moduleId, moduleId), eq(financeModules.enabled, "Y")))
    .limit(1);
  return Boolean(rows[0]);
}

export async function atriumWorkflowsEnabled(db: AuthDatabase): Promise<boolean> {
  return financeModuleIsEnabled(db, "amg", "atrium-workflows");
}

export async function setFinanceModule(
  db: AuthDatabase,
  actor: Actor,
  input: { companyId: string; moduleId: string; enabled: string },
  now: Date,
): Promise<{ status: "updated" } | { status: "denied" } | { status: "invalid"; reason: string }> {
  const operator = await db.select().from(platformOperators).where(eq(platformOperators.userId, actor.userId)).limit(1);
  if (!operator[0]) return { status: "denied" };
  const companyId = input.companyId.trim();
  const moduleId = input.moduleId.trim();
  const enabled = input.enabled === "Y" ? "Y" : input.enabled === "N" ? "N" : "";
  if (!isFinanceModuleId(moduleId)) return { status: "invalid", reason: "Unknown finance module." };
  const definition = financeModuleRegistry.find((module) => module.id === moduleId);
  if (!definition || definition.core) return { status: "invalid", reason: "Shared finance modules stay enabled." };
  if (!enabled) return { status: "invalid", reason: "Module state must be enabled or disabled." };
  const settings = await db.select().from(financeSettings).where(eq(financeSettings.companyId, companyId)).limit(1);
  if (!settings[0]) return { status: "invalid", reason: "That company has no finance settings." };
  const existing = await db
    .select()
    .from(financeModules)
    .where(and(eq(financeModules.companyId, companyId), eq(financeModules.moduleId, moduleId)))
    .limit(1);
  if (!existing[0]) return { status: "invalid", reason: "That module is not configured for this company." };
  await db
    .update(financeModules)
    .set({ enabled, updatedAt: now })
    .where(and(eq(financeModules.companyId, companyId), eq(financeModules.moduleId, moduleId)));
  await writeAudit(db, {
    eventType: "authorization_allowed",
    userId: actor.userId,
    companyId,
    resourceType: "finance_module",
    resourceId: moduleId,
    emailFingerprint: null,
    ip: null,
    metadata: { module: "admin", action: "finance_module_set", financeModule: moduleId, state: enabled },
    createdAt: now,
  });
  return { status: "updated" };
}

export async function listConfiguredCompanies(db: AuthDatabase): Promise<{ companyId: string; workspaceKind: string }[]> {
  return db
    .select({ companyId: financeSettings.companyId, workspaceKind: financeSettings.workspaceKind })
    .from(financeSettings)
    .orderBy(asc(financeSettings.companyId));
}
