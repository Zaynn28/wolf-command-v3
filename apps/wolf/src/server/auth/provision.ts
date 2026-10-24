import { eq } from "drizzle-orm";
import { grants, memberships, users } from "../db/schema";
import { ensureTenant } from "../db/tenant";
import type { AuthDatabase } from "../db/types";
import { writeAudit } from "./audit";
import { normalizeEmail } from "./crypto";
import { acceptsNewPassword, hashPassword } from "./password";
import { revokeUserSessions } from "./session";

const roles = new Set(["staff", "administrator", "owner"]);

export type ProvisionResult =
  | { status: "created"; userId: string }
  | { status: "exists" }
  | { status: "validation" };

export type ResetResult = { status: "updated"; userId: string } | { status: "missing" } | { status: "validation" };

export async function provisionAccount(
  db: AuthDatabase,
  input: {
    email: string;
    temporaryPassword: string;
    now: Date;
    mustChangePassword?: boolean;
    companyId?: string | null;
    departmentId?: string | null;
    role?: string | null;
    ownerPrivate?: boolean;
  },
): Promise<ProvisionResult> {
  const email = normalizeEmail(input.email);
  const companyId = input.companyId?.trim() || null;
  const departmentId = input.departmentId?.trim() || null;
  const role = input.role?.trim() || null;
  if (!email || !acceptsNewPassword(input.temporaryPassword)) return { status: "validation" };
  if ((role && !companyId) || (companyId && !role) || (role && !roles.has(role))) return { status: "validation" };
  if (input.ownerPrivate && !companyId) return { status: "validation" };

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.emailNormalized, email)).limit(1);
  if (existing[0]) return { status: "exists" };

  const passwordHash = await hashPassword(input.temporaryPassword);
  const inserted = await db
    .insert(users)
    .values({
      emailNormalized: email,
      status: "active",
      passwordHash,
      mustChangePassword: input.mustChangePassword ?? true,
    })
    .returning({ id: users.id });
  const userId = inserted[0]?.id;
  if (!userId) return { status: "validation" };

  if (companyId && role) {
    await ensureTenant(db, companyId, departmentId);
    await db.insert(memberships).values({
      userId,
      companyId,
      departmentId,
      role,
      status: "active",
    });
  }
  if (input.ownerPrivate && companyId) {
    await ensureTenant(db, companyId, null);
    await db.insert(grants).values({
      userId,
      grantType: "owner_private",
      companyId,
      scope: null,
      departmentId: null,
    });
  }
  await writeAudit(db, {
    eventType: "account_provisioned",
    userId,
    companyId,
    resourceType: "user",
    resourceId: userId,
    emailFingerprint: null,
    ip: null,
    metadata: { mustChange: input.mustChangePassword ?? true },
    createdAt: input.now,
  });
  return { status: "created", userId };
}

export async function setTemporaryPassword(
  db: AuthDatabase,
  input: { email: string; temporaryPassword: string; now: Date },
): Promise<ResetResult> {
  const email = normalizeEmail(input.email);
  if (!email || !acceptsNewPassword(input.temporaryPassword)) return { status: "validation" };
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.emailNormalized, email)).limit(1);
  const userId = existing[0]?.id;
  if (!userId) return { status: "missing" };

  const passwordHash = await hashPassword(input.temporaryPassword);
  await db
    .update(users)
    .set({ passwordHash, mustChangePassword: true, updatedAt: input.now })
    .where(eq(users.id, userId));
  await revokeUserSessions(db, userId, input.now);
  await writeAudit(db, {
    eventType: "password_reset_by_admin",
    userId,
    emailFingerprint: null,
    ip: null,
    metadata: { mustChange: true },
    createdAt: input.now,
  });
  return { status: "updated", userId };
}
