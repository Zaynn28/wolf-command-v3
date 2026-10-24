import assert from "node:assert/strict";
import test from "node:test";
import type { Actor } from "@wolf/shared";
import { hrAccess, hrCompanyIds, openHrCompany } from "./companies";

function actor(memberships: Actor["memberships"], grants: Actor["grants"] = []): Actor {
  return { userId: "user-1", memberships, grants };
}

test("a BZG-only HR membership cannot open AMG", () => {
  const current = actor([{ companyId: "bzg", departmentId: "hr", role: "staff" }]);
  assert.deepEqual(hrCompanyIds(current), ["bzg"]);
  assert.equal(openHrCompany(current, "amg").status, "denied");
  assert.equal(openHrCompany(current, "bzg").status, "unlinked");
});

test("two memberships stay separate until that company is selected", () => {
  const current = actor([
    { companyId: "amg", departmentId: "hr", role: "staff" },
    { companyId: "ggv", departmentId: "hr", role: "staff" },
  ]);
  assert.deepEqual(hrCompanyIds(current), ["amg", "ggv"]);
  const amg = openHrCompany(current, "amg");
  const ggv = openHrCompany(current, "ggv");
  const bzg = openHrCompany(current, "bzg");
  assert.equal(amg.status, "unlinked");
  assert.equal(ggv.status, "unlinked");
  assert.equal(bzg.status, "denied");
  if (amg.status === "unlinked") assert.equal(amg.orgId, "AMG");
  if (ggv.status === "unlinked") assert.equal(ggv.orgId, "GGV");
});

test("a Wolf owner is not an HRIS payroll grant", () => {
  const current = actor([{ companyId: "amg", departmentId: null, role: "owner" }]);
  const opened = openHrCompany(current, "amg");
  assert.equal(opened.status, "unlinked");
  assert.equal("personId" in opened, false);
});

test("an empty membership list does not open AMG", () => {
  const current = actor([]);
  assert.deepEqual(hrCompanyIds(current), []);
  assert.equal(openHrCompany(current, "amg").status, "denied");
});

test("a company employee opens only that company's employee screen", () => {
  const current = actor([{ companyId: "amg", departmentId: "procurement", role: "staff" }]);
  assert.equal(hrAccess(current, "amg"), "employee");
  assert.equal(hrAccess(current, "bzg"), null);
  const opened = openHrCompany(current, "amg");
  assert.equal(opened.status, "unlinked");
  if (opened.status === "unlinked") assert.equal(opened.access, "employee");
  assert.equal(openHrCompany(current, "bzg").status, "denied");
});

test("an HR department membership stays on the staff workspace", () => {
  const current = actor([{ companyId: "amg", departmentId: "hr", role: "administrator" }]);
  const opened = openHrCompany(current, "amg");
  assert.equal(opened.status, "unlinked");
  if (opened.status === "unlinked") assert.equal(opened.access, "administrator");
});

test("finance membership does not open HR", () => {
  const current = actor([
    { companyId: "amg", departmentId: "finance", role: "administrator" },
    { companyId: "bzg", departmentId: "finance", role: "administrator" },
    { companyId: "ggv", departmentId: "finance", role: "administrator" },
    { companyId: "local-books", departmentId: "finance", role: "administrator" },
  ]);
  assert.deepEqual(hrCompanyIds(current), []);
  assert.equal(openHrCompany(current, "amg").status, "denied");
  assert.equal(openHrCompany(current, "local-books").status, "denied");
});

test("GGV membership does not open AMG or BZG", () => {
  const current = actor([{ companyId: "ggv", departmentId: "hr", role: "administrator" }]);
  assert.deepEqual(hrCompanyIds(current), ["ggv"]);
  assert.equal(openHrCompany(current, "amg").status, "denied");
  assert.equal(openHrCompany(current, "bzg").status, "denied");
  assert.equal(openHrCompany(current, "ggv").status, "unlinked");
});

test("local-books is not an HRIS company", () => {
  const current = actor([{ companyId: "local-books", departmentId: null, role: "owner" }]);
  assert.deepEqual(hrCompanyIds(current), []);
  assert.equal(openHrCompany(current, "local-books").status, "denied");
});

test("a posted uppercase org id is not a Wolf company", () => {
  const current = actor([{ companyId: "amg", departmentId: "hr", role: "administrator" }]);
  assert.equal(openHrCompany(current, "AMG").status, "denied");
  assert.equal(openHrCompany(current, "GGV").status, "denied");
});
