import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { orgPeople } from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { resolveHrAssertionSecret, signHrAssertion } from "../hr/assertion";
import { hrisApiOrigin } from "../hr/hris-proxy";

const hrCompanies = ["amg", "bzg", "ggv"] as const;

export type HrCompanyId = (typeof hrCompanies)[number];

export type HrEmployeeLink = {
  employeeCode: string;
  displayName: string;
  employmentStatus: "active" | "leave" | "inactive";
  departmentName: string | null;
  positionTitle: string | null;
};

export type HrDirectorySource =
  | { mode: "api" }
  | { mode: "provided"; byCompany: Readonly<Record<string, readonly HrEmployeeLink[]>> };

export const offlineHrDirectory: HrDirectorySource = { mode: "provided", byCompany: {} };

export function isHrCompany(companyId: string): companyId is HrCompanyId {
  return companyId === "amg" || companyId === "bzg" || companyId === "ggv";
}

export function hrPersonId(companyId: HrCompanyId, employeeCode: string): string {
  return `hr-${companyId}-${employeeCode.toLowerCase()}`;
}

function cleanLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length < 1 || text.length > 120) return null;
  return text;
}

function mapStatus(value: unknown): HrEmployeeLink["employmentStatus"] | null {
  if (typeof value !== "string") return null;
  const status = value.trim().toLowerCase().replaceAll("-", "_");
  if (status === "active") return "active";
  if (status === "leave" || status === "on_leave") return "leave";
  if (status === "inactive" || status === "terminated") return "inactive";
  return null;
}

/**
 * Keeps the directory fields Organization is allowed to show.
 * Payroll, contact, and identity columns on the HR row are ignored.
 */
export function projectHrEmployee(row: unknown, companyId: string): HrEmployeeLink | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  if (record.company_id !== companyId || !isHrCompany(companyId)) return null;
  if (typeof record.employee_code !== "string" || !/^[A-Z0-9][A-Z0-9-]{1,31}$/.test(record.employee_code)) return null;
  const displayName = cleanLabel(record.full_name);
  const employmentStatus = mapStatus(record.employment_status);
  if (!displayName || !employmentStatus) return null;
  const id = hrPersonId(companyId, record.employee_code);
  if (!/^hr-[a-z0-9-]{1,64}$/.test(id)) return null;
  return {
    employeeCode: record.employee_code,
    displayName,
    employmentStatus,
    departmentName: cleanLabel(record.department_name),
    positionTitle: cleanLabel(record.position_title),
  };
}

export async function fetchCompanyHrDirectory(
  companyId: string,
  userId: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<HrEmployeeLink[] | null> {
  if (!isHrCompany(companyId)) return [];
  const origin = hrisApiOrigin(env);
  const secret = resolveHrAssertionSecret(env);
  if (!origin || !secret || userId.trim() === "") return null;
  const assertion = signHrAssertion(secret, {
    sub: userId,
    companyId,
    iat: Math.floor(Date.now() / 1000),
    jti: randomBytes(16).toString("hex"),
  });
  try {
    const response = await fetchImpl(`${origin}/api/employees`, {
      method: "GET",
      headers: { accept: "application/json", "x-wolf-hr-assertion": assertion },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!Array.isArray(body)) return null;
    const byCode = new Map<string, HrEmployeeLink>();
    for (const row of body) {
      const employee = projectHrEmployee(row, companyId);
      if (employee) byCode.set(employee.employeeCode, employee);
    }
    return [...byCode.values()];
  } catch {
    return null;
  }
}

export async function resolveHrDirectories(
  userId: string,
  companyIds: readonly string[],
  source: HrDirectorySource,
): Promise<{ directories: Map<string, HrEmployeeLink[]>; unavailable: Set<string> }> {
  const directories = new Map<string, HrEmployeeLink[]>();
  const unavailable = new Set<string>();
  for (const companyId of companyIds) {
    if (!isHrCompany(companyId)) {
      directories.set(companyId, []);
      continue;
    }
    if (source.mode === "provided") {
      directories.set(companyId, [...(source.byCompany[companyId] ?? [])]);
      continue;
    }
    const employees = await fetchCompanyHrDirectory(companyId, userId);
    if (!employees) {
      directories.set(companyId, []);
      unavailable.add(companyId);
      continue;
    }
    directories.set(companyId, employees);
  }
  return { directories, unavailable };
}

export async function syncHrLinks(db: AuthDatabase, companyId: string, employees: readonly HrEmployeeLink[]): Promise<void> {
  if (!isHrCompany(companyId)) return;
  const seen = new Set<string>();
  for (const employee of employees) {
    if (seen.has(employee.employeeCode)) continue;
    seen.add(employee.employeeCode);
    const id = hrPersonId(companyId, employee.employeeCode);
    await db
      .insert(orgPeople)
      .values({
        id,
        displayName: employee.displayName,
        employmentStatus: employee.employmentStatus,
        isDemo: false,
        source: "hr",
        companyId,
        employeeCode: employee.employeeCode,
        departmentName: employee.departmentName,
        positionTitle: employee.positionTitle,
        linkedUserId: null,
      })
      .onConflictDoUpdate({
        target: orgPeople.id,
        set: {
          displayName: employee.displayName,
          employmentStatus: employee.employmentStatus,
          departmentName: employee.departmentName,
          positionTitle: employee.positionTitle,
          updatedAt: new Date(),
        },
        setWhere: and(eq(orgPeople.source, "hr"), eq(orgPeople.companyId, companyId)),
      });
  }
}

export async function readSyncedHrLinks(db: AuthDatabase, companyId: string, employees: readonly HrEmployeeLink[]) {
  if (!isHrCompany(companyId) || employees.length === 0) return [];
  const codes = [...new Set(employees.map((employee) => employee.employeeCode))];
  return db
    .select()
    .from(orgPeople)
    .where(and(eq(orgPeople.source, "hr"), eq(orgPeople.companyId, companyId), eq(orgPeople.isDemo, false), inArray(orgPeople.employeeCode, codes)));
}
