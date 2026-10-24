import { and, eq } from "drizzle-orm";
import type { Actor, Role } from "@wolf/shared";
import { writeAudit } from "../auth/audit";
import { defaultFinanceModules } from "../finance/modules";
import { companies, departments, financeModules, financeSettings, memberships, platformOperators, users } from "../db/schema";
import { ensureTenant } from "../db/tenant";
import type { AuthDatabase } from "../db/types";
import { normalizeEmail } from "../auth/crypto";

const companyIdPattern = /^[a-z0-9][a-z0-9-]{0,62}$/;
const roles = new Set<Role>(["staff", "administrator"]);

export async function isPlatformOperator(db: AuthDatabase, userId: string): Promise<boolean> {
  const rows = await db.select().from(platformOperators).where(eq(platformOperators.userId, userId)).limit(1);
  return Boolean(rows[0]);
}

export async function createCompany(
  db: AuthDatabase,
  actor: Actor,
  input: {
    companyId: string;
    name: string;
    currencyCode: string;
    minorScale: number;
    memberEmail?: string | null;
    memberRole?: string | null;
    companyWide?: boolean;
    workspaceKind?: string | null;
  },
  now: Date,
): Promise<{ status: "created"; companyId: string } | { status: "denied" } | { status: "invalid"; reason: string }> {
  if (!(await isPlatformOperator(db, actor.userId))) return { status: "denied" };
  const companyId = input.companyId.trim();
  const name = input.name.trim();
  const currencyCode = input.currencyCode.trim().toUpperCase();
  if (!companyIdPattern.test(companyId) || companyId === "amg-runtime") {
    return { status: "invalid", reason: "Company id must be lowercase letters, numbers, and hyphens." };
  }
  const workspaceKind = (input.workspaceKind?.trim() || "shared").toLowerCase();
  if (workspaceKind !== "shared" && workspaceKind !== "amg") {
    return { status: "invalid", reason: "Workspace must be shared or amg." };
  }
  if (workspaceKind === "amg" && companyId !== "amg") {
    return { status: "invalid", reason: "The AMG operating system can only be enabled for company id amg." };
  }
  if (name.length < 1 || name.length > 120) return { status: "invalid", reason: "Company name is required." };
  if (!/^[A-Z]{3}$/.test(currencyCode)) return { status: "invalid", reason: "Currency code must be three letters." };
  if (!Number.isInteger(input.minorScale) || input.minorScale < 0 || input.minorScale > 4) {
    return { status: "invalid", reason: "Minor-unit scale must be a whole number from 0 to 4." };
  }
  const memberEmail = input.memberEmail?.trim() ? normalizeEmail(input.memberEmail) : null;
  const memberRole = input.memberRole?.trim() || null;
  if ((memberEmail && !memberRole) || (!memberEmail && memberRole)) {
    return { status: "invalid", reason: "Membership needs both an existing account email and a role." };
  }
  if (memberRole && !roles.has(memberRole as Role)) return { status: "invalid", reason: "Role must be staff or administrator." };
  let memberId: string | null = null;
  if (memberEmail) {
    const member = await db.select().from(users).where(eq(users.emailNormalized, memberEmail)).limit(1);
    if (!member[0] || member[0].status !== "active") return { status: "invalid", reason: "The membership email is not an active Wolf account." };
    memberId = member[0].id;
  }

  try {
    await db.transaction(async (tx) => {
      const database = tx as unknown as AuthDatabase;
      await ensureTenant(database, companyId, "finance");
      await database.update(companies).set({ name }).where(eq(companies.id, companyId));
      await database
        .update(departments)
        .set({ name: "Finance" })
        .where(and(eq(departments.companyId, companyId), eq(departments.id, "finance")));
      await database.insert(financeSettings).values({
        companyId,
        currencyCode,
        minorScale: input.minorScale,
        workspaceKind,
        createdAt: now,
      });
      await database.insert(financeModules).values(
        defaultFinanceModules(workspaceKind).map((module) => ({
          companyId,
          moduleId: module.moduleId,
          enabled: module.enabled,
          updatedAt: now,
        })),
      );
      if (memberId && memberRole) {
        await database.insert(memberships).values({
          userId: memberId,
          companyId,
          departmentId: input.companyWide ? null : "finance",
          role: memberRole,
          status: "active",
        });
      }
      await writeAudit(database, {
        eventType: "authorization_allowed",
        userId: actor.userId,
        companyId,
        resourceType: "company",
        resourceId: companyId,
        emailFingerprint: null,
        ip: null,
        metadata: { module: "admin", action: "company_created", name, workspace: workspaceKind },
        createdAt: now,
      });
    });
  } catch {
    return { status: "invalid", reason: "The company could not be created. The id may already exist." };
  }
  return { status: "created", companyId };
}
