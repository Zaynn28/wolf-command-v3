import { and, eq, sql } from "drizzle-orm";
import { companies, departments, orgAssignments, orgPeople, orgPositions, orgTaskEvents, orgTasks } from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { demoAssignments, demoDepartments, demoPeople, demoPositions, demoTasks } from "./catalog";

export type OrganizationSeedResult = {
  companies: string[];
  skippedCompanies: string[];
  people: number;
  tasks: number;
};

export async function seedOrganizationDemo(db: AuthDatabase, now = new Date("2026-10-22T00:00:00.000Z")): Promise<OrganizationSeedResult> {
  const existing = await db.select({ id: companies.id }).from(companies);
  const present = new Set(existing.map((company) => company.id));
  const wanted = [...new Set(demoDepartments.map((department) => department.companyId))];
  const selected = wanted.filter((companyId) => present.has(companyId));
  const skippedCompanies = wanted.filter((companyId) => !present.has(companyId));

  for (const department of demoDepartments.filter((item) => selected.includes(item.companyId))) {
    await db
      .insert(departments)
      .values({ companyId: department.companyId, id: department.id, name: department.name, status: "active", isDemo: true })
      .onConflictDoUpdate({
        target: [departments.companyId, departments.id],
        set: { name: department.name, updatedAt: now },
        setWhere: eq(departments.isDemo, true),
      });
  }

  for (const person of demoPeople) {
    const used = demoAssignments.some((assignment) => assignment.personId === person.id && selected.includes(assignment.companyId));
    if (!used) continue;
    await db
      .insert(orgPeople)
      .values({ id: person.id, displayName: person.displayName, employmentStatus: person.employmentStatus, isDemo: true, linkedUserId: null })
      .onConflictDoUpdate({
        target: orgPeople.id,
        set: { displayName: person.displayName, employmentStatus: person.employmentStatus, updatedAt: now },
        setWhere: eq(orgPeople.isDemo, true),
      });
  }

  for (const position of demoPositions.filter((item) => selected.includes(item.companyId))) {
    await db
      .insert(orgPositions)
      .values({ ...position, isDemo: true })
      .onConflictDoUpdate({
        target: orgPositions.id,
        set: { title: position.title },
        setWhere: eq(orgPositions.isDemo, true),
      });
  }

  for (const assignment of demoAssignments.filter((item) => selected.includes(item.companyId))) {
    await db
      .insert(orgAssignments)
      .values({ ...assignment, isDemo: true })
      .onConflictDoUpdate({
        target: orgAssignments.id,
        set: { positionId: assignment.positionId, managerPersonId: assignment.managerPersonId },
        setWhere: eq(orgAssignments.isDemo, true),
      });
  }

  for (const task of demoTasks.filter((item) => selected.includes(item.companyId))) {
    await db
      .insert(orgTasks)
      .values({
        id: task.id,
        companyId: task.companyId,
        departmentId: task.departmentId,
        title: task.title,
        description: task.description,
        priority: task.priority,
        dueOn: task.dueOn,
        completionCriteria: task.completionCriteria,
        reviewRequired: task.reviewRequired,
        status: task.status,
        assigneePersonId: task.assigneePersonId,
        teamDepartmentId: task.teamDepartmentId,
        isDemo: true,
        completedAt: task.completedAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: orgTasks.id,
        set: { title: task.title, description: task.description, completionCriteria: task.completionCriteria, updatedAt: now },
        setWhere: eq(orgTasks.isDemo, true),
      });
    await db
      .insert(orgTaskEvents)
      .values({
        id: `demo-evt-${task.id}`,
        taskId: task.id,
        actorUserId: null,
        actorSource: "demo-seed",
        previousStatus: null,
        nextStatus: task.status,
        reason: "Demo seed.",
        createdAt: now,
      })
      .onConflictDoNothing();
  }

  const people = await db.select({ count: sql<number>`count(*)::int` }).from(orgPeople).where(eq(orgPeople.isDemo, true));
  const tasks = await db.select({ count: sql<number>`count(*)::int` }).from(orgTasks).where(and(eq(orgTasks.isDemo, true)));
  return {
    companies: selected,
    skippedCompanies,
    people: Number(people[0]?.count ?? 0),
    tasks: Number(tasks[0]?.count ?? 0),
  };
}
