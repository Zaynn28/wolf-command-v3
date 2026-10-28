import assert from "node:assert/strict";
import test from "node:test";
import type { Actor } from "@wolf/shared";
import { managedCompanyIds } from "../access/policy-model";
import { financeCompanyIds } from "../finance/companies";
import { hrCompanyIds } from "../hr/companies";
import { visibleOperatorCompanyIds } from "./operator-list";

const operator: Actor = {
  userId: "operator",
  memberships: [
    { companyId: "amg", departmentId: "finance", role: "administrator" },
    { companyId: "bzg", departmentId: "finance", role: "administrator" },
    { companyId: "ggv", departmentId: "finance", role: "administrator" },
    { companyId: "local-books", departmentId: "finance", role: "administrator" },
    { companyId: "amg", departmentId: "hr", role: "administrator" },
    { companyId: "bzg", departmentId: "hr", role: "administrator" },
    { companyId: "ggv", departmentId: "hr", role: "administrator" },
  ],
  grants: [],
};

test("operator company lists keep AMG, BZG, and GGV and omit local-books", () => {
  assert.deepEqual(visibleOperatorCompanyIds(["ggv", "local-books", "amg", "bzg"]), ["ggv", "amg", "bzg"]);
  assert.deepEqual(financeCompanyIds(operator), ["amg", "bzg", "ggv"]);
  assert.deepEqual(managedCompanyIds(operator), ["amg", "bzg", "ggv"]);
  assert.deepEqual(hrCompanyIds(operator), ["amg", "bzg", "ggv"]);
});
