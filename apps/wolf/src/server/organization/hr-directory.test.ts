import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { orgPeople, users } from "../db/schema";
import { ensureTenant } from "../db/tenant";
import { withDb } from "../test/harness";
import { fetchCompanyHrDirectory, projectHrEmployee, syncHrLinks } from "./hr-directory";

const secret = "wolf-hr-directory-test-secret-value";

test("employee projection keeps the directory fields and drops other companies", () => {
  const projected = projectHrEmployee(
    {
      company_id: "amg",
      employee_code: "AMG-01",
      full_name: "Apriadi",
      employment_status: "ACTIVE",
      department_name: "Housekeeping",
      position_title: " ",
      nik: "0000000000000000",
      email: "person@example.test",
      phone: "0800000000",
      salary: 1,
    },
    "amg",
  );
  assert.deepEqual(projected, {
    employeeCode: "AMG-01",
    displayName: "Apriadi",
    employmentStatus: "active",
    departmentName: "Housekeeping",
    positionTitle: null,
  });
  assert.equal(projectHrEmployee({ company_id: "bzg", employee_code: "AMG-01", full_name: "Apriadi", employment_status: "ACTIVE" }, "amg"), null);
  assert.equal(projectHrEmployee({ company_id: "amg", employee_code: "AMG-01", full_name: "Apriadi", employment_status: "ACTIVE", nik: "1" }, "bzg"), null);
});

test("the directory read calls only the employee list for that company", async () => {
  const calls: string[] = [];
  const employees = await fetchCompanyHrDirectory("bzg", "user-1", {
    NODE_ENV: "development",
    WOLF_HR_ASSERTION_SECRET: secret,
  }, async (input, init) => {
    calls.push(`${init?.method ?? "GET"} ${String(input)}`);
    return new Response(JSON.stringify([
      { company_id: "amg", employee_code: "AMG-01", full_name: "Apriadi", employment_status: "ACTIVE", department_name: "Housekeeping" },
      { company_id: "bzg", employee_code: "BZG-01", full_name: "Bzg Person", employment_status: "ACTIVE", email: "hidden@example.test" },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.deepEqual(calls, ["GET http://127.0.0.1:3012/api/employees"]);
  assert.deepEqual(employees, [{
    employeeCode: "BZG-01",
    displayName: "Bzg Person",
    employmentStatus: "active",
    departmentName: null,
    positionTitle: null,
  }]);
  assert.equal(JSON.stringify(employees).includes("hidden@"), false);
  assert.equal(JSON.stringify(employees).includes("Apriadi"), false);
});

test("linking the same HR employee twice does not duplicate the row or create a login", async () => {
  await withDb(async (db) => {
    await ensureTenant(db, "amg", null);
    await ensureTenant(db, "bzg", null);
    const employee = {
      employeeCode: "AMG-02",
      displayName: "Lyly",
      employmentStatus: "active" as const,
      departmentName: "Executive",
      positionTitle: null,
    };
    await syncHrLinks(db, "amg", [employee]);
    await syncHrLinks(db, "amg", [{ ...employee, displayName: "Lyly" }]);
    await syncHrLinks(db, "bzg", []);
    const rows = await db.select().from(orgPeople).where(eq(orgPeople.source, "hr"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, "hr-amg-amg-02");
    assert.equal(rows[0]?.companyId, "amg");
    assert.equal(rows[0]?.employeeCode, "AMG-02");
    assert.equal(rows[0]?.linkedUserId, null);
    assert.equal((await db.select().from(users)).length, 0);
  });
});
