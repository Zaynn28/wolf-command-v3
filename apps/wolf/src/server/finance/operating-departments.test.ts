import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { withDb } from "../test/harness";
import { financeModules, financeOperatingDepartments, platformOperators, users } from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { createCompany } from "../admin/companies";
import { readOperatingDepartments, saveOperatingDepartment } from "./operating-departments";

const now = new Date("2026-10-23T00:00:00.000Z");

async function user(db: AuthDatabase, email: string) {
  const row = (await db.insert(users).values({ emailNormalized: email, status: "active" }).returning())[0];
  if (!row) throw new Error("missing user");
  return row;
}

function actor(userId: string, companyId: string): Actor {
  return { userId, memberships: [{ companyId, departmentId: "finance", role: "staff" }], grants: [] };
}

test("operating departments stay inside the authorized company and survive a later read", async () => {
  await withDb(async (db) => {
    const operatorUser = await user(db, "operator@wolf-command.test");
    await db.insert(platformOperators).values({ userId: operatorUser.id, createdAt: now });
    const operator = actor(operatorUser.id, "unused");
    assert.equal((await createCompany(db, operator, { companyId: "amg", name: "AMG", currencyCode: "IDR", minorScale: 0, workspaceKind: "amg" }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "bzg", name: "BZG", currencyCode: "USD", minorScale: 2 }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "ggv", name: "GGV", currencyCode: "USD", minorScale: 2 }, now)).status, "created");

    const amg = actor((await user(db, "amg@wolf-command.test")).id, "amg");
    const bzg = actor((await user(db, "bzg@wolf-command.test")).id, "bzg");
    const ggv = actor((await user(db, "ggv@wolf-command.test")).id, "ggv");

    const saved = await saveOperatingDepartment(db, bzg, "bzg", { department_code: "ROOMS", department_name: "Rooms", active: "Y" }, now);
    assert.equal(saved.status, "saved");
    const updated = await saveOperatingDepartment(db, bzg, "bzg", { department_code: "ROOMS", department_name: "Rooms updated", active: "N" }, now);
    assert.equal(updated.status, "saved");
    if (updated.status !== "saved") return;
    assert.equal(updated.department.department_name, "Rooms updated");
    assert.equal(updated.department.active, "N");

    const bzgRows = await readOperatingDepartments(db, bzg, "bzg");
    assert.equal(bzgRows.status, "ready");
    if (bzgRows.status !== "ready") return;
    assert.equal(bzgRows.departments.length, 1);
    assert.equal((await readOperatingDepartments(db, bzg, "ggv")).status, "denied");
    assert.equal((await readOperatingDepartments(db, bzg, "amg")).status, "denied");
    assert.equal((await saveOperatingDepartment(db, ggv, "amg", { department_code: "FOOD", department_name: "Food", active: "Y" }, now)).status, "denied");
    assert.equal((await readOperatingDepartments(db, amg, "amg")).status, "ready");
    const amgRows = await readOperatingDepartments(db, amg, "amg");
    if (amgRows.status !== "ready") return;
    assert.equal(amgRows.departments.length, 0);
    const stored = await db.select().from(financeOperatingDepartments).where(eq(financeOperatingDepartments.companyId, "ggv"));
    assert.equal(stored.length, 0);
    const bzgStored = await db.select().from(financeOperatingDepartments).where(eq(financeOperatingDepartments.companyId, "bzg"));
    assert.equal(bzgStored.length, 1);

    await db.update(financeModules).set({ enabled: "N" }).where(eq(financeModules.moduleId, "accounting-core"));
    assert.equal((await readOperatingDepartments(db, bzg, "bzg")).status, "denied");
    assert.equal((await saveOperatingDepartment(db, bzg, "bzg", { department_code: "SPA", department_name: "Spa", active: "Y" }, now)).status, "denied");
  });
});
