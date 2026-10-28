import type { Actor } from "@wolf/shared";
import { evaluateModuleAccess } from "../access/matrix";
import { visibleOperatorCompanyId } from "../companies/operator-list";
import { openHrCompany } from "../hr/companies";
import type { AuthDatabase } from "../db/types";
import {
  fetchCompanyHrBoard,
  fetchCompanyHrDepartments,
  hrIdentityFromPersonId,
  joinedInMonth,
  type HrBoardEmployee,
  type HrDepartmentChoice,
} from "./hr-board";
import { isHrCompany, type HrCompanyId, type HrDirectorySource } from "./hr-directory";
import { readOrganizationTree, type OrgCompany, type OrgTree } from "./service";

export type BoardPerson = {
  id: string;
  hrId: string | null;
  name: string;
  code: string;
  department: string;
  departmentId: string | null;
  companyId: string;
  companyName: string;
  status: string;
  hasPhoto: boolean;
  joinDate: string | null;
  joinedThisMonth: boolean;
};

export type BoardCompany = OrgCompany & { directory: "ready" | "unavailable" };

export type OrganizationBoard = {
  companies: BoardCompany[];
  people: BoardPerson[];
  departments: Array<HrDepartmentChoice & { companyId: string }>;
  addTargets: OrgCompany[];
  editableCompanyIds: string[];
};

export function openBoardPerson(
  actor: Actor,
  personId: string,
): { status: 404 | 403; error: string } | { status: 200; companyId: HrCompanyId; employeeCode: string; canEdit: boolean } {
  const identity = hrIdentityFromPersonId(personId);
  if (!identity) return { status: 404, error: "That person is not available." };
  if (evaluateModuleAccess(actor, "organization", "read", { companyId: identity.companyId }).outcome !== "allow") {
    return { status: 403, error: "That person is not available." };
  }
  const access = openHrCompany(actor, identity.companyId);
  return { status: 200, ...identity, canEdit: access.status === "unlinked" && access.access !== "employee" };
}

export function hrStaffCompanyIds(actor: Actor, companies: readonly OrgCompany[]): string[] {
  return companies
    .filter((company) => {
      const access = openHrCompany(actor, company.id);
      return access.status === "unlinked" && access.access !== "employee";
    })
    .map((company) => company.id);
}

export async function readOrganizationBoard(
  db: AuthDatabase,
  actor: Actor,
  now: Date,
  source: HrDirectorySource = { mode: "api" },
): Promise<{ status: number; body: OrganizationBoard | { error: string } }> {
  const tree = await readOrganizationTree(db, actor, null, "", source);
  if (tree.status !== 200 || !("tree" in tree.body)) {
    return { status: tree.status, body: "error" in tree.body ? tree.body : { error: "Organization is not available." } };
  }
  const directory = new Map(tree.body.tree.companies.map((company) => [company.id, company.directory]));
  const companies = [...tree.body.companies]
    .filter((company) => visibleOperatorCompanyId(company.id))
    .map((company) => ({ ...company, directory: directory.get(company.id) ?? "ready" }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const editableCompanyIds = hrStaffCompanyIds(actor, companies);
  const enrichment = new Map<string, HrBoardEmployee>();
  const departments: OrganizationBoard["departments"] = [];
  await Promise.all(
    companies.map(async (company) => {
      if (!isHrCompany(company.id) || company.directory === "unavailable") return;
      const [employees, choices] = await Promise.all([
        fetchCompanyHrBoard(company.id, actor.userId),
        fetchCompanyHrDepartments(company.id, actor.userId),
      ]);
      for (const employee of employees ?? []) enrichment.set(`${company.id}:${employee.employeeCode}`, employee);
      for (const choice of choices ?? []) departments.push({ ...choice, companyId: company.id });
    }),
  );
  return {
    status: 200,
    body: {
      companies,
      people: peopleFromTree(tree.body.tree, enrichment, now).filter((person) => visibleOperatorCompanyId(person.companyId)),
      departments: departments
        .filter((department) => visibleOperatorCompanyId(department.companyId))
        .sort((left, right) => left.name.localeCompare(right.name) || left.companyId.localeCompare(right.companyId)),
      addTargets: companies.filter((company) => editableCompanyIds.includes(company.id)),
      editableCompanyIds,
    },
  };
}

function peopleFromTree(tree: OrgTree, enrichment: Map<string, HrBoardEmployee>, now: Date): BoardPerson[] {
  const people: BoardPerson[] = [];
  for (const company of tree.companies) {
    const seen = new Set<string>();
    for (const department of company.departments) {
      for (const position of department.positions) {
        const person = position.person;
        if (!person?.employeeCode || person.isDemo || seen.has(person.id)) continue;
        seen.add(person.id);
        const extra = enrichment.get(`${company.id}:${person.employeeCode}`);
        people.push({
          id: person.id,
          hrId: extra?.hrId ?? null,
          name: person.displayName,
          code: person.employeeCode,
          department: department.name,
          departmentId: extra?.departmentId ?? null,
          companyId: company.id,
          companyName: company.name,
          status: person.employmentStatus,
          hasPhoto: extra?.hasPhoto === true,
          joinDate: extra?.joinDate ?? null,
          joinedThisMonth: joinedInMonth(extra?.joinDate ?? null, now),
        });
      }
    }
  }
  return people.sort((left, right) => left.name.localeCompare(right.name) || left.code.localeCompare(right.code));
}
