import assert from "node:assert/strict";
import { test } from "node:test";
import type { Actor } from "@wolf/shared";
import { bootstrapAllowed } from "../db/bootstrap-operator";
import { platformOperators, users } from "../db/schema";
import { withDb } from "../test/harness";
import { createCompany } from "./companies";
import { listFinanceCompanies } from "../finance/companies";

test("operator bootstrap refuses production and missing opt-in", () => {
  assert.equal(bootstrapAllowed({ NODE_ENV: "production", WOLF_ALLOW_DEV_BOOTSTRAP: "1" }).ok, false);
  assert.equal(bootstrapAllowed({ NODE_ENV: "development" }).ok, false);
  assert.equal(bootstrapAllowed({ NODE_ENV: "development", WOLF_ALLOW_DEV_BOOTSTRAP: "1" }).ok, true);
});

test("the AMG operating system cannot be attached to another company, and finance lists only authorized companies", async () => {
  await withDb(async (db) => {
    const now = new Date("2026-10-23T00:00:00.000Z");
    const operatorUser = (await db.insert(users).values({ emailNormalized: "operator@wolf-command.test", status: "active" }).returning())[0];
    const staffUser = (await db.insert(users).values({ emailNormalized: "staff@wolf-command.test", status: "active" }).returning())[0];
    if (!operatorUser || !staffUser) throw new Error("missing user");
    await db.insert(platformOperators).values({ userId: operatorUser.id, createdAt: now });
    const operator: Actor = { userId: operatorUser.id, memberships: [], grants: [] };
    assert.equal((await createCompany(db, operator, { companyId: "bzg", name: "BZG", currencyCode: "USD", minorScale: 2, workspaceKind: "amg" }, now)).status, "invalid");
    assert.equal((await createCompany(db, operator, { companyId: "amg", name: "AMG", currencyCode: "IDR", minorScale: 0, workspaceKind: "amg", memberEmail: "staff@wolf-command.test", memberRole: "staff" }, now)).status, "created");
    assert.equal((await createCompany(db, operator, { companyId: "ggv", name: "GGV", currencyCode: "USD", minorScale: 2, workspaceKind: "shared" }, now)).status, "created");
    const staff: Actor = { userId: staffUser.id, memberships: [{ companyId: "amg", departmentId: "finance", role: "staff" }], grants: [] };
    const visible = await listFinanceCompanies(db, staff);
    assert.deepEqual(visible.map((company) => company.companyId), ["amg"]);
    assert.equal(visible[0]?.workspaceKind, "amg");
  });
});
