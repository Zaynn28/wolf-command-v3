import { companies, departments } from "./schema";
import type { AuthDatabase } from "./types";

export async function ensureTenant(
  db: AuthDatabase,
  companyId: string,
  departmentId: string | null,
): Promise<void> {
  const company = companyId.trim();
  const department = departmentId?.trim() || null;
  if (!company) return;
  await db.insert(companies).values({ id: company, name: company }).onConflictDoNothing();
  if (!department) return;
  await db.insert(departments).values({ companyId: company, id: department, name: department }).onConflictDoNothing();
}
