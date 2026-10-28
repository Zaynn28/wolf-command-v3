import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import type { Actor } from "@wolf/shared";
import { withDb } from "../test/harness";
import { auditEvents, financeModules, grants, memberships, platformOperators, users } from "../db/schema";
import type { AuthDatabase } from "../db/types";
import { createCompany } from "../admin/companies";
import { readFinanceWorkspace, saveDraftJournal } from "./drafts";
import { moduleEnabled, readFinanceModules, setFinanceModule } from "./modules";

const now = new Date("2026-10-23T00:00:00.000Z");

async function user(db: AuthDatabase, email: string) {
  const row = (await db.insert(users).values({ emailNormalized: email, status: "active" }).returning())[0];
  if (!row) throw new Error("missing user");
  return row;
}

function actor(userId: string, companyId: string, role: "staff" | "administrator" = "staff"): Actor {
  return { userId, memberships: [{ companyId, departmentId: "finance", role }], grants: [] };
}

test("company modules stay isolated and a finance user cannot change them", async () => {
  await withDb(async (db) => {
    const operatorUser = await user(db, "operator@wolf-command.test");
    await db.insert(platformOperators).values({ userId: operatorUser.id, createdAt: now });
    const operator = actor(operatorUser.id, "unused", "administrator");
    assert.equal((await createCompany(db, operator, { companyId: "amg", name: "AMG", currencyCode: "IDR", minorScale: 0, workspaceKind: "amg" }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "bzg", name: "BZG", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "ggv", name: "GGV", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");

    const amg = await readFinanceModules(db, "amg");
    const bzg = await readFinanceModules(db, "bzg");
    const ggv = await readFinanceModules(db, "ggv");
    assert.equal(moduleEnabled(amg, "accounting-core"), true);
    assert.equal(moduleEnabled(amg, "atrium-workflows"), true);
    assert.equal(moduleEnabled(bzg, "dashboard"), true);
    assert.equal(moduleEnabled(bzg, "atrium-workflows"), false);
    assert.equal(moduleEnabled(ggv, "inventory"), false);

    const ggvStaff = actor((await user(db, "ggv@wolf-command.test")).id, "ggv");
    assert.equal((await readFinanceWorkspace(db, ggvStaff, "amg")).status, "denied");
    assert.equal((await saveDraftJournal(db, ggvStaff, {
      companyId: "amg",
      periodKey: "2026-10",
      memo: "cross",
      lines: [
        { accountCode: "1000", side: "debit", amount: "1.00" },
        { accountCode: "4000", side: "credit", amount: "1.00" },
      ],
    }, now)).status, "denied");

    const disabled = await setFinanceModule(db, operator, { companyId: "bzg", moduleId: "inventory", enabled: "N" }, now);
    assert.equal(disabled.status, "updated");
    assert.equal(moduleEnabled(await readFinanceModules(db, "bzg"), "inventory"), false);
    assert.equal((await setFinanceModule(db, ggvStaff, { companyId: "ggv", moduleId: "tax", enabled: "Y" }, now)).status, "denied");
    assert.equal(moduleEnabled(await readFinanceModules(db, "ggv"), "tax"), false);
    assert.equal((await setFinanceModule(db, operator, { companyId: "bzg", moduleId: "accounting-core", enabled: "N" }, now)).status, "invalid");
    assert.equal(moduleEnabled(await readFinanceModules(db, "bzg"), "accounting-core"), true);

    const enabled = await setFinanceModule(db, operator, { companyId: "ggv", moduleId: "tax", enabled: "Y" }, now);
    assert.equal(enabled.status, "updated");
    const membership = await db.select().from(memberships).where(and(eq(memberships.userId, operatorUser.id), eq(memberships.companyId, "ggv")));
    assert.equal(membership.length, 0);
    const approval = await db.select().from(grants).where(eq(grants.companyId, "ggv"));
    assert.equal(approval.length, 0);
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.resourceId, "tax"));
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.eventType, "authorization_allowed");
  });
});

test("a disabled Accounting Core cannot be written through the draft service", async () => {
  await withDb(async (db) => {
    const operatorUser = await user(db, "operator@wolf-command.test");
    await db.insert(platformOperators).values({ userId: operatorUser.id, createdAt: now });
    const operator = actor(operatorUser.id, "unused", "administrator");
    assert.equal((await createCompany(db, operator, { companyId: "bzg", name: "BZG", currencyCode: "IDR", minorScale: 0 }, now)).status, "created");
    await db.update(financeModules).set({ enabled: "N" }).where(and(eq(financeModules.companyId, "bzg"), eq(financeModules.moduleId, "accounting-core")));
    const staff = actor(operatorUser.id, "bzg", "administrator");
    const saved = await saveDraftJournal(db, staff, {
      companyId: "bzg",
      periodKey: "2026-10",
      memo: "blocked",
      lines: [
        { accountCode: "1000", side: "debit", amount: "1.00" },
        { accountCode: "4000", side: "credit", amount: "1.00" },
      ],
    }, now);
    assert.equal(saved.status, "invalid");
  });
});
