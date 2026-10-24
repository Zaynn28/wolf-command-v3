import assert from "node:assert/strict";
import test from "node:test";
import { toActor } from "./actor";
import { openHrCompany } from "../hr/companies";

test("a disabled HR membership does not authorize the company", () => {
  const actor = toActor(
    "user-1",
    [{ status: "disabled", role: "administrator", companyId: "amg", departmentId: "hr" }],
    [],
  );
  assert.equal(actor.memberships.length, 0);
  assert.equal(openHrCompany(actor, "amg").status, "denied");
});
