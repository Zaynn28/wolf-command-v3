import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { Actor, Grant, Membership, Role } from "@wolf/shared";
import { grants, memberships, users } from "../db/schema";
import type { AuthDatabase } from "../db/types";

const roles = new Set<Role>(["staff", "administrator", "owner"]);

export type MembershipRecord = {
  status: string;
  role: string;
  companyId: string;
  departmentId: string | null;
  expiresAt?: Date | null;
};

export type GrantRecord = {
  grantType: string;
  companyId: string;
  scope: string | null;
  departmentId: string | null;
  status?: string;
  expiresAt?: Date | null;
};

export function toActor(userId: string, membershipRows: MembershipRecord[], grantRows: GrantRecord[]): Actor {
  const actorMemberships: Membership[] = [];
  for (const row of membershipRows) {
    if (row.status !== "active" || !roles.has(row.role as Role) || row.companyId.trim() === "") continue;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) continue;
    actorMemberships.push({
      companyId: row.companyId,
      departmentId: row.departmentId,
      role: row.role as Role,
    });
  }

  const actorGrants: Grant[] = [];
  for (const row of grantRows) {
    if (row.companyId.trim() === "") continue;
    if (row.status && row.status !== "active") continue;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) continue;
    if (row.grantType === "owner_private" && !row.scope && !row.departmentId) {
      actorGrants.push({ type: "owner_private", companyId: row.companyId });
      continue;
    }
    if (row.grantType !== "approve") continue;
    if ((row.scope === "company" || row.scope === "owner_private") && !row.departmentId) {
      actorGrants.push({
        type: "approve",
        companyId: row.companyId,
        scope: row.scope,
        departmentId: null,
      });
      continue;
    }
    if (row.scope === "department" && row.departmentId) {
      actorGrants.push({
        type: "approve",
        companyId: row.companyId,
        scope: "department",
        departmentId: row.departmentId,
      });
    }
  }

  return { userId, memberships: actorMemberships, grants: actorGrants };
}

export async function loadTrustedActor(db: AuthDatabase, userId: string): Promise<Actor | null> {
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user || user.status !== "active") return null;
  const now = new Date();
  const membershipRows = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, "active"),
        or(isNull(memberships.expiresAt), gt(memberships.expiresAt, now)),
      ),
    );
  const grantRows = await db
    .select()
    .from(grants)
    .where(
      and(
        eq(grants.userId, userId),
        eq(grants.status, "active"),
        or(isNull(grants.expiresAt), gt(grants.expiresAt, now)),
      ),
    );
  return toActor(user.id, membershipRows, grantRows);
}
