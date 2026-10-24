import { and, asc, eq } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { writeAudit } from "../auth/audit";
import { evaluateModuleAccess } from "../access/matrix";
import { financeModules, financeOperatingDepartments, financeSettings } from "../db/schema";
import type { AuthDatabase } from "../db/types";

export type OperatingDepartment = {
  department_code: string;
  department_name: string;
  active: "Y" | "N";
};

const codePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

function financeAllowed(actor: Actor, companyId: string, action: "read" | "create" | "update"): boolean {
  return evaluateModuleAccess(actor, "finance", action, { companyId, departmentId: null }).outcome === "allow";
}

async function accountingCoreEnabled(db: AuthDatabase, companyId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(financeModules)
    .where(and(eq(financeModules.companyId, companyId), eq(financeModules.moduleId, "accounting-core"), eq(financeModules.enabled, "Y")))
    .limit(1);
  return Boolean(rows[0]);
}

export async function readOperatingDepartments(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
): Promise<{ status: "ready"; departments: OperatingDepartment[] } | { status: "denied" }> {
  if (!financeAllowed(actor, companyId, "read") || !(await accountingCoreEnabled(db, companyId))) return { status: "denied" };
  const rows = await db
    .select()
    .from(financeOperatingDepartments)
    .where(eq(financeOperatingDepartments.companyId, companyId))
    .orderBy(asc(financeOperatingDepartments.departmentCode));
  return {
    status: "ready",
    departments: rows.map((row) => ({
      department_code: row.departmentCode,
      department_name: row.departmentName,
      active: row.active === "N" ? "N" : "Y",
    })),
  };
}

export async function saveOperatingDepartment(
  db: AuthDatabase,
  actor: Actor,
  companyId: string,
  input: { department_code?: unknown; department_name?: unknown; active?: unknown },
  now: Date,
): Promise<{ status: "saved"; department: OperatingDepartment } | { status: "denied" } | { status: "invalid"; reason: string }> {
  const code = String(input.department_code ?? "").trim();
  const name = String(input.department_name ?? "").trim();
  const active = input.active === "N" ? "N" : "Y";
  if (!codePattern.test(code) || name.length < 1 || name.length > 120) {
    return { status: "invalid", reason: "A department needs a code and a name." };
  }
  const existing = await db
    .select()
    .from(financeOperatingDepartments)
    .where(and(eq(financeOperatingDepartments.companyId, companyId), eq(financeOperatingDepartments.departmentCode, code)))
    .limit(1);
  const action = existing[0] ? "update" : "create";
  if (!financeAllowed(actor, companyId, action) || !(await accountingCoreEnabled(db, companyId))) return { status: "denied" };
  const settings = await db.select().from(financeSettings).where(eq(financeSettings.companyId, companyId)).limit(1);
  if (!settings[0]) return { status: "invalid", reason: "Finance settings are not configured for this company." };
  if (existing[0]) {
    await db
      .update(financeOperatingDepartments)
      .set({ departmentName: name, active, updatedAt: now })
      .where(and(eq(financeOperatingDepartments.companyId, companyId), eq(financeOperatingDepartments.departmentCode, code)));
  } else {
    await db.insert(financeOperatingDepartments).values({
      companyId,
      departmentCode: code,
      departmentName: name,
      active,
      updatedAt: now,
    });
  }
  await writeAudit(db, {
    eventType: "authorization_allowed",
    userId: actor.userId,
    companyId,
    resourceType: "finance_operating_department",
    resourceId: code,
    emailFingerprint: null,
    ip: null,
    metadata: { module: "finance", action: existing[0] ? "operating_department_updated" : "operating_department_created" },
    createdAt: now,
  });
  return { status: "saved", department: { department_code: code, department_name: name, active } };
}
