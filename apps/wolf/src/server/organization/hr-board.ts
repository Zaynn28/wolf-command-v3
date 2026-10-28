import { randomBytes } from "node:crypto";
import { resolveHrAssertionSecret, signHrAssertion } from "../hr/assertion";
import { hrisApiOrigin } from "../hr/hris-proxy";
import { hrPersonId, isHrCompany, projectHrEmployee, type HrCompanyId } from "./hr-directory";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type HrBoardEmployee = {
  hrId: string;
  employeeCode: string;
  displayName: string;
  employmentStatus: "active" | "leave" | "inactive";
  departmentName: string | null;
  departmentId: string | null;
  hasPhoto: boolean;
  joinDate: string | null;
};

export type HrDepartmentChoice = { id: string; name: string };

export type HrContact = { email: string | null; phone: string | null };

export function monthKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function joinedInMonth(joinDate: string | null, now: Date): boolean {
  return joinDate !== null && joinDate.slice(0, 7) === monthKey(now);
}

export function hrIdentityFromPersonId(personId: string): { companyId: HrCompanyId; employeeCode: string } | null {
  const match = /^hr-(amg|bzg|ggv)-([a-z0-9][a-z0-9-]{0,40})$/.exec(personId);
  if (!match?.[1] || !match[2] || !isHrCompany(match[1])) return null;
  const employeeCode = match[2].toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{1,31}$/.test(employeeCode)) return null;
  if (hrPersonId(match[1], employeeCode) !== personId) return null;
  return { companyId: match[1], employeeCode };
}

function label(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length < 1 || text.length > 120) return null;
  return text;
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (!match?.[1]) return null;
  const [year, month, day] = match[1].split("-").map(Number);
  if (!year || !month || !day || month > 12 || day > 31) return null;
  return match[1];
}

/**
 * Directory fields for the organization board.
 * Contact, identity, and payroll columns stay off this object.
 */
export function projectHrBoardEmployee(row: unknown, companyId: string): HrBoardEmployee | null {
  const employee = projectHrEmployee(row, companyId);
  if (!employee || !row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  if (typeof record.id !== "string" || !uuidPattern.test(record.id)) return null;
  const departmentId = typeof record.department_id === "string" && uuidPattern.test(record.department_id) ? record.department_id : null;
  return {
    hrId: record.id,
    employeeCode: employee.employeeCode,
    displayName: employee.displayName,
    employmentStatus: employee.employmentStatus,
    departmentName: employee.departmentName,
    departmentId,
    hasPhoto: record.has_profile_photo === true,
    joinDate: dateOnly(record.join_date),
  };
}

export function projectHrDepartment(row: unknown, companyId: string): HrDepartmentChoice | null {
  if (!row || typeof row !== "object" || !isHrCompany(companyId)) return null;
  const record = row as Record<string, unknown>;
  if (record.company_id !== companyId) return null;
  if (typeof record.id !== "string" || !uuidPattern.test(record.id)) return null;
  const name = label(record.name);
  if (!name) return null;
  return { id: record.id, name };
}

export function projectHrContact(row: unknown): HrContact {
  if (!row || typeof row !== "object") return { email: null, phone: null };
  const record = row as Record<string, unknown>;
  return { email: contactEmail(record.email), phone: contactPhone(record.phone) };
}

function contactEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length < 3 || text.length > 254 || /\s/.test(text) || !text.includes("@")) return null;
  return text;
}

function contactPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length < 1 || text.length > 40 || /[\r\n]/.test(text) || !/\d/.test(text)) return null;
  return text;
}

async function hrFetch(
  companyId: HrCompanyId,
  userId: string,
  path: string,
  workspace: "hr" | null,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
  init?: { method?: string; accept?: string; body?: string },
): Promise<Response | null> {
  const origin = hrisApiOrigin(env);
  const secret = resolveHrAssertionSecret(env);
  if (!origin || !secret || userId.trim() === "") return null;
  const assertion = signHrAssertion(secret, {
    sub: userId,
    companyId,
    iat: Math.floor(Date.now() / 1000),
    jti: randomBytes(16).toString("hex"),
    ...(workspace ? { workspace } : {}),
  });
  const headers = new Headers();
  headers.set("accept", init?.accept ?? "application/json");
  headers.set("x-wolf-hr-assertion", assertion);
  if (init?.body) headers.set("content-type", "application/json");
  try {
    return await fetchImpl(`${origin}${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body,
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return null;
  }
}

async function hrJson(
  companyId: HrCompanyId,
  userId: string,
  path: string,
  workspace: "hr" | null,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
): Promise<unknown | null> {
  const response = await hrFetch(companyId, userId, path, workspace, env, fetchImpl);
  if (!response?.ok) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function fetchCompanyHrBoard(
  companyId: string,
  userId: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<HrBoardEmployee[] | null> {
  if (!isHrCompany(companyId)) return [];
  const body = await hrJson(companyId, userId, "/api/employees", null, env, fetchImpl);
  if (!Array.isArray(body)) return null;
  const byCode = new Map<string, HrBoardEmployee>();
  for (const row of body) {
    const employee = projectHrBoardEmployee(row, companyId);
    if (employee) byCode.set(employee.employeeCode, employee);
  }
  return [...byCode.values()];
}

export async function fetchCompanyHrDepartments(
  companyId: string,
  userId: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<HrDepartmentChoice[] | null> {
  if (!isHrCompany(companyId)) return [];
  const body = await hrJson(companyId, userId, "/api/departments", null, env, fetchImpl);
  if (!Array.isArray(body)) return null;
  const byId = new Map<string, HrDepartmentChoice>();
  for (const row of body) {
    const department = projectHrDepartment(row, companyId);
    if (department) byId.set(department.id, department);
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function fetchHrContact(
  companyId: HrCompanyId,
  userId: string,
  employeeCode: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<HrContact | null> {
  const employees = await hrJson(companyId, userId, "/api/employees", null, env, fetchImpl);
  if (!Array.isArray(employees)) return null;
  const row = employees.find((item) => item && typeof item === "object" && (item as { employee_code?: unknown }).employee_code === employeeCode && (item as { company_id?: unknown }).company_id === companyId);
  if (!row) return null;
  return projectHrContact(row);
}

export async function fetchHrPhoto(
  companyId: HrCompanyId,
  userId: string,
  employeeCode: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const employees = await fetchCompanyHrBoard(companyId, userId, env, fetchImpl);
  const employee = employees?.find((item) => item.employeeCode === employeeCode);
  if (!employee?.hasPhoto) return null;
  const response = await hrFetch(companyId, userId, `/api/employees/${employee.hrId}/photo`, "hr", env, fetchImpl, {
    accept: "image/jpeg,image/png,image/webp",
  });
  if (!response?.ok) return null;
  const mime = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 256 * 1024) return null;
  return { bytes, mime };
}

export async function changeHrDepartment(
  companyId: HrCompanyId,
  userId: string,
  employeeCode: string,
  departmentId: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; departmentName: string } | { ok: false; error: string }> {
  if (!uuidPattern.test(departmentId)) return { ok: false, error: "That department is not on file for this company." };
  const departments = await fetchCompanyHrDepartments(companyId, userId, env, fetchImpl);
  const department = departments?.find((item) => item.id === departmentId);
  if (!department) return { ok: false, error: "That department is not on file for this company." };
  const employees = await hrJson(companyId, userId, "/api/employees", null, env, fetchImpl);
  if (!Array.isArray(employees)) return { ok: false, error: "HR employees could not be read for this company." };
  const row = employees.find((item) => item && typeof item === "object" && (item as { employee_code?: unknown }).employee_code === employeeCode);
  if (!row || typeof row !== "object") return { ok: false, error: "That employee is not on file for this company." };
  const record = row as { id?: unknown; department_id?: unknown };
  if (typeof record.id !== "string" || !uuidPattern.test(record.id)) return { ok: false, error: "That employee is not on file for this company." };
  if (record.department_id === departmentId) return { ok: true, departmentName: department.name };
  const response = await hrFetch(companyId, userId, `/api/employees/${record.id}`, "hr", env, fetchImpl, {
    method: "PATCH",
    body: JSON.stringify({ department_id: departmentId }),
  });
  if (!response?.ok) return { ok: false, error: "The department was not changed." };
  return { ok: true, departmentName: department.name };
}
