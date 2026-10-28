import assert from "node:assert/strict";
import { test } from "node:test";
import {
  changeHrDepartment,
  fetchCompanyHrBoard,
  joinedInMonth,
  projectHrBoardEmployee,
  projectHrContact,
  projectHrDepartment,
} from "./hr-board";

const secret = "wolf-hr-directory-test-secret-value";
const employeeId = "11111111-1111-4111-8111-111111111111";
const housekeepingId = "22222222-2222-4222-8222-222222222222";
const financeId = "33333333-3333-4333-8333-333333333333";

const amgRow = {
  id: employeeId,
  company_id: "amg",
  employee_code: "AMG-15",
  full_name: "Akhmad Zenith Alfathan",
  employment_status: "ACTIVE",
  department_id: financeId,
  department_name: "Accounting and Finance",
  has_profile_photo: false,
  join_date: "2026-08-01",
  email: "person@example.test",
  phone: "0800000000",
  nik: "0000000000000000",
  salary: 1,
  bank_account_number: "999",
};

test("the board projection keeps HR structure and drops contact and payroll fields", () => {
  const projected = projectHrBoardEmployee(amgRow, "amg");
  assert.equal(projected?.employeeCode, "AMG-15");
  assert.equal(projected?.departmentName, "Accounting and Finance");
  assert.equal(projected?.joinDate, "2026-08-01");
  assert.equal(projected?.hasPhoto, false);
  const encoded = JSON.stringify(projected);
  assert.equal(encoded.includes("person@"), false);
  assert.equal(encoded.includes("0800"), false);
  assert.equal(encoded.includes("nik"), false);
  assert.equal(encoded.includes("salary"), false);
  assert.equal(encoded.includes("999"), false);
  assert.equal(projectHrBoardEmployee({ ...amgRow, company_id: "bzg" }, "amg"), null);
});

test("contact projection returns only an email and phone that HR stored", () => {
  assert.deepEqual(projectHrContact(amgRow), { email: "person@example.test", phone: "0800000000" });
  assert.deepEqual(projectHrContact({ email: " ", phone: null, nik: "1", salary: 9 }), { email: null, phone: null });
  assert.equal(Object.keys(projectHrContact(amgRow)).join(), "email,phone");
});

test("department choices stay inside the company", () => {
  assert.deepEqual(projectHrDepartment({ id: housekeepingId, company_id: "amg", name: "Housekeeping" }, "amg"), {
    id: housekeepingId,
    name: "Housekeeping",
  });
  assert.equal(projectHrDepartment({ id: housekeepingId, company_id: "bzg", name: "Housekeeping" }, "amg"), null);
  assert.equal(projectHrDepartment({ id: "not-a-uuid", company_id: "amg", name: "Housekeeping" }, "amg"), null);
});

test("this month is counted from the join date, not a fixed delta", () => {
  assert.equal(joinedInMonth("2026-10-03", new Date(2026, 9, 26)), true);
  assert.equal(joinedInMonth("2026-09-30", new Date(2026, 9, 26)), false);
  assert.equal(joinedInMonth(null, new Date(2026, 9, 26)), false);
});

test("a department change patches only an existing department id", async () => {
  const calls: Array<{ url: string; method: string; body: string; workspace: string | null }> = [];
  const result = await changeHrDepartment("amg", "user-1", "AMG-15", housekeepingId, {
    NODE_ENV: "development",
    WOLF_HR_ASSERTION_SECRET: secret,
  }, async (input, init) => {
    const assertion = new Headers(init?.headers).get("x-wolf-hr-assertion") ?? "";
    const payload = JSON.parse(Buffer.from(assertion.split(".")[0] ?? "", "base64url").toString("utf8")) as { workspace?: string };
    calls.push({ url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : "", workspace: payload.workspace ?? null });
    if (String(input).endsWith("/api/departments")) {
      return Response.json([
        { id: housekeepingId, company_id: "amg", name: "Housekeeping" },
        { id: financeId, company_id: "bzg", name: "Finance" },
      ]);
    }
    if (String(input).endsWith("/api/employees")) {
      return Response.json([amgRow]);
    }
    return Response.json({ id: employeeId, department_id: housekeepingId });
  });
  assert.deepEqual(result, { ok: true, departmentName: "Housekeeping" });
  assert.equal(calls.some((call) => call.url.endsWith("/api/departments") && call.workspace === null), true);
  const patch = calls.find((call) => call.method === "PATCH");
  assert.equal(patch?.workspace, "hr");
  assert.equal(patch?.body, JSON.stringify({ department_id: housekeepingId }));
  assert.equal(patch?.body.includes("salary"), false);
  const refused = await changeHrDepartment("amg", "user-1", "AMG-15", "44444444-4444-4444-8444-444444444444", {
    NODE_ENV: "development",
    WOLF_HR_ASSERTION_SECRET: secret,
  }, async (input) => {
    if (String(input).endsWith("/api/departments")) return Response.json([{ id: housekeepingId, company_id: "amg", name: "Housekeeping" }]);
    return Response.json([]);
  });
  assert.equal(refused.ok, false);
});

test("the board read drops another company's rows", async () => {
  const employees = await fetchCompanyHrBoard("amg", "user-1", {
    NODE_ENV: "development",
    WOLF_HR_ASSERTION_SECRET: secret,
  }, async () => Response.json([amgRow, { ...amgRow, company_id: "bzg", employee_code: "BZG-01", id: "55555555-5555-4555-8555-555555555555" }]));
  assert.deepEqual(employees?.map((employee) => employee.employeeCode), ["AMG-15"]);
});
