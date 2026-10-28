import { inArray } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { filterCompaniesByOperatingGrant } from "../access/operating-grants";
import { evaluateModuleAccess } from "../access/matrix";
import { loadTrustedActor } from "../access/actor";
import { readSession } from "../auth/session";
import { companies } from "../db/schema";
import type { AuthDatabase } from "../db/types";
import {
  offlineHrDirectory,
  readSyncedHrLinks,
  resolveHrDirectories,
  syncHrLinks,
  type HrDirectorySource,
  type HrEmployeeLink,
} from "../organization/hr-directory";

const learnerFields = ["id", "displayName", "employeeCode", "employmentStatus", "departmentName", "positionTitle"] as const;
const statuses = new Set(["active", "leave", "inactive"]);

export type AcademyLearner = {
  id: string;
  displayName: string;
  employeeCode: string;
  employmentStatus: "active" | "leave" | "inactive";
  departmentName: string | null;
  positionTitle: string | null;
};

export type AcademySection = {
  companyId: string;
  companyName: string;
  directory: "ready" | "unavailable";
  recorded: number;
  learners: AcademyLearner[];
};

export type AcademyDirectory = {
  companies: Array<{ id: string; name: string }>;
  sections: AcademySection[];
};

export type AcademyResult = { status: number; body: AcademyDirectory | { error: string } };

/**
 * Academy learners are that company's HR employees.
 * The same company + employee code link is updated in place. No Wolf login is created.
 */
export async function readAcademyDirectory(
  db: AuthDatabase,
  actor: Actor,
  companyId: string | null,
  query: string,
  source: HrDirectorySource = { mode: "api" },
): Promise<AcademyResult> {
  const allowed = await filterCompaniesByOperatingGrant(db, actor, academyCompanyIds(actor), "academy.directory");
  if (companyId && !allowed.includes(companyId)) {
    return { status: 403, body: { error: "Academy is not available for this company." } };
  }
  if (allowed.length === 0) {
    return { status: 403, body: { error: "Academy is not available for this account." } };
  }
  const selected = companyId ? [companyId] : allowed;
  const { directories, unavailable } = await resolveHrDirectories(actor.userId, selected, source);
  for (const [id, employees] of directories) {
    if (unavailable.has(id)) continue;
    await syncHrLinks(db, id, employees);
  }
  const companyRows = allowed.length
    ? await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, allowed))
    : [];
  const names = new Map(companyRows.map((company) => [company.id, company.name]));
  const needle = query.trim().toLowerCase();
  const sections: AcademySection[] = [];
  for (const id of selected) {
    const employees = directories.get(id) ?? [];
    const roster = unavailable.has(id) ? [] : await learnersForCompany(db, id, employees);
    const learners = needle ? roster.filter((learner) => matches(learner, needle)) : roster;
    sections.push({
      companyId: id,
      companyName: names.get(id) ?? id,
      directory: unavailable.has(id) ? "unavailable" : "ready",
      recorded: roster.length,
      learners,
    });
  }
  sections.sort((left, right) => left.companyName.localeCompare(right.companyName) || left.companyId.localeCompare(right.companyId));
  return {
    status: 200,
    body: {
      companies: companyRows
        .map((company) => ({ id: company.id, name: company.name }))
        .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
      sections,
    },
  };
}

export async function serveAcademy(
  db: AuthDatabase,
  token: string | null,
  now: Date,
  request: { companyId: string | null; query: string },
  source: HrDirectorySource = offlineHrDirectory,
): Promise<AcademyResult> {
  const session = await readSession(db, token, now);
  if (!session) return { status: 401, body: { error: "Sign in is required." } };
  if (session.mustChangePassword) return { status: 403, body: { error: "Change the Wolf password before opening Academy." } };
  const actor = await loadTrustedActor(db, session.userId);
  if (!actor) return { status: 401, body: { error: "Sign in is required." } };
  return readAcademyDirectory(db, actor, request.companyId, request.query, source);
}

export function academyCompanyIds(actor: Actor): string[] {
  return [...new Set(actor.memberships.map((membership) => membership.companyId))]
    .filter((id) => evaluateModuleAccess(actor, "academy", "read", { companyId: id }).outcome === "allow")
    .sort();
}

async function learnersForCompany(
  db: AuthDatabase,
  companyId: string,
  employees: readonly HrEmployeeLink[],
): Promise<AcademyLearner[]> {
  const rows = await readSyncedHrLinks(db, companyId, employees);
  const byCode = new Map(rows.map((row) => [row.employeeCode, row]));
  const seen = new Set<string>();
  const learners: AcademyLearner[] = [];
  for (const employee of employees) {
    if (seen.has(employee.employeeCode)) continue;
    seen.add(employee.employeeCode);
    const row = byCode.get(employee.employeeCode);
    if (!row || row.companyId !== companyId || row.isDemo || row.source !== "hr" || !row.employeeCode) continue;
    if (!statuses.has(row.employmentStatus)) continue;
    const learner: AcademyLearner = {
      id: row.id,
      displayName: row.displayName,
      employeeCode: row.employeeCode,
      employmentStatus: row.employmentStatus as AcademyLearner["employmentStatus"],
      departmentName: row.departmentName,
      positionTitle: row.positionTitle,
    };
    assertLearnerShape(learner);
    learners.push(learner);
  }
  return learners.sort((left, right) => left.displayName.localeCompare(right.displayName) || left.employeeCode.localeCompare(right.employeeCode));
}

function matches(learner: AcademyLearner, needle: string): boolean {
  if (!needle) return true;
  return [learner.displayName, learner.employeeCode, learner.departmentName ?? "", learner.positionTitle ?? ""].some((value) =>
    value.toLowerCase().includes(needle),
  );
}

function assertLearnerShape(learner: AcademyLearner): void {
  const keys = Object.keys(learner).sort();
  if (keys.join() !== [...learnerFields].sort().join()) {
    throw new Error("Academy learner response included an unexpected field.");
  }
}
