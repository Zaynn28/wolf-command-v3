# Phase 3A — Finance and HR architecture

Revised after inspection of Wolf Command and the AMG Finance application. This file keeps the eight open owner decisions. The domain design is [docs/finance-domain-specification.md](finance-domain-specification.md). The AMG evidence and migration gates are in [docs/amg-finance-full-merger-plan.md](amg-finance-full-merger-plan.md). The milestone order is [docs/multi-company-finance-roadmap.md](multi-company-finance-roadmap.md).

No schema, application code, or data was changed in this revision. Phase 3A.4 evidence procedures, the data-authority matrix, and the migration gates are in the merger plan, sections 15 and 16.

## Product frame

These four decisions are confirmed. They stay as written. They are not the eight open questions in section 6, and they do not approve a schema, row-level security, data migration, or production cutover.

1. **Product scope:** Modular Finance platform with company-enabled workflows.
2. **Data isolation:** Shared PostgreSQL infrastructure with enforced tenant isolation.
3. **Company onboarding:** Private onboarding through authorized Wolf operators. Public company registration remains disabled.
4. **Migration strategy:** AMG Finance is the first company implementation and migration pilot.

Current isolation is the application authorization path in section 1. This frame does not turn on row-level security and does not make company onboarding public.

Labels:

- **Verified Wolf.** Checked in this workspace.
- **Verified AMG.** Checked in `Zaynn28/ATRIUM-FINANCE` at commit `3c9a1e12ebcb3132875aca6f446c9b88b6eb3452`.
- **Proposed.** A target design, not built.
- **Assumption.** Needs owner approval.
- **Unknown.** Not established by the inspected source.

## 1. Verified Wolf functionality

Re-checked against the current tree:

- `/finance` checks access, then stores draft journals for that company when finance settings exist. Posting is not enabled (`apps/wolf/src/app/finance/page.tsx`).
- `/hr` renders `AccessPanel` for module `hr` and tells the user that no people records are stored (`apps/wolf/src/app/hr/page.tsx`).
- `openModule` and `handleRecordsRequest` set `persisted: false`. The application calls them without a record source, so the list is empty. Fixture titles such as “Company A invoice” exist only in tests.
- Navigation and `demo-data.ts` describe invoices, ledgers, employees, and onboarding as illustrative. They are not implemented workflows.
- Sign-in is Wolf email and password. The server loads the session from the `wolf_session` cookie, then loads the user, active memberships, and grants. Client `userId`, `role`, and `grant` values are not authorization evidence.
- `authorize()` in `packages/shared` allows read, create, update, and delete from membership. Owner Private and approval require explicit grants. An owner or administrator role does not imply those grants.
- The module matrix limits Finance to a department id of `finance` or ending in `-finance`, and HR to `hr` or ending in `-hr`. Company-wide membership is `department_id` null and covers every department module in that company.
- Companies, departments, memberships, grants, sessions, and audit events are the tenant and identity tables. `pnpm db:migrate` applies `schema.sql`, `0002`, `0003`, and `0004` in one transaction. `0004` adds draft finance tables. HR still has no business table. Row-level security is not enabled.
- Audit metadata rejects keys matching `salary` or `private`. Authorization events store a requested company id in metadata when the company row must not be required.

`docs/data-foundation.md` still says the migration statements are not in one transaction. The runner wraps them. That sentence is stale.

## 2. Verified AMG Finance functionality

AMG Finance is a Vite and React client with an Express API. It is a double-entry hotel accounting system described as USALI-oriented, with operations, journals, ledgers, reports, tax, inventory, service charge, owner-pool distribution, and administration.

It is not a Wolf module, and it does not use Wolf sessions. Authentication, authorization, and storage are summarized in the merger plan. The findings that change this proposal:

- Finance data is real: chart of accounts, hotel departments, journals, revenue, spending, inventory, tax, petty cash, service charge, and owner-pool distribution.
- Google Sheets is an optional read and full-tab rewrite for six accounting tabs when a service account is configured. Other modules persist JSON files under `data/`. A Phase 3A.2 read-only inventory could not open the live spreadsheet, the Firebase project, or a runtime `system_state.json`. The source file is a mock-data flag, not an access-control snapshot. Details are in the merger plan, section 14.
- Amounts are JavaScript numbers, not exact decimal types.
- Passwords are compared as plaintext. A client-supplied Google flag skips that check. API routes trust `x-user-id` and `x-user-name` headers.
- There is no separate HR application in the inspected repository. Service-charge staff records live inside Finance.

## 3. Finance schema direction

`finance_records`, a label table with a title and no amounts, is not a sufficient Finance schema and is not proposed as the merger target. It was an assumption made before this source inspection. The business model to preserve is the AMG ledger and its related modules, mapped in the merger plan.

Wolf’s `/finance` access check remains the gate. Behind an allowed finance membership, the merged module must serve the real workflows, not a placeholder list.

Hotel operating departments in AMG (`department_code` on a journal line) are accounting dimensions. They are not the same thing as a Wolf department membership. Putting USALI department codes into Wolf’s `departments` table would make them fail the finance module rule unless every code ended in `-finance`.

## 4. HR scope

Verified Wolf HR is the access panel and the matrix above. There is no HR product in Wolf and no separate HR product in AMG.

`hr_records` remains an unapproved label-table assumption. It is not justified by an HR workflow in either repository. The first data that looks like HR is the service-charge staff register inside AMG Finance. Whether that register stays in Finance or becomes the first HR workflow is an owner decision. Until then, no HR table should be created.

Company-wide membership can open the HR module today. That must not be treated as permission to read confidential employee files, compensation, or payroll. Those fields are not in Wolf. Service-charge allocations and owner-pool statements in AMG are sensitive and need a narrower rule than “anyone who can open Finance.”

## 5. Shared rules that still hold

- No generic module-records table.
- No second user, session, company, membership, or grant table.
- No row-level security in this phase.
- Server-side identity comes from the Wolf session.
- Approval stays an explicit grant. Owner Private stays an explicit grant.
- Business rows that belong to a Wolf tenant carry `company_id`. A Wolf department foreign key is used for the module gate, not for every hotel cost center.
- Audit metadata rejects keys matching credential, salary, and private patterns. It does not by itself reject amount or title keys. Whether amounts and titles stay out of metadata is still open decision 7.

## 6. Original owner decisions

These eight questions are unchanged from the previous proposal. Recommendations after the AMG inspection are in the merger plan. They are not answered here.

1. Approve `finance_records` and `hr_records` as label tables only, with no amounts and no compensation.
2. Confirm that Finance and HR business rows are always department-scoped, and that company-wide access stays on the membership.
3. Confirm soft delete, `ON DELETE RESTRICT` for user attribution, and the absence of a retention period.
4. Confirm that company-wide members may read HR labels, while compensation stays out of the schema until a separate grant exists.
5. Confirm that invoice, ledger, payroll, leave, performance, and recruitment work are out of the first implementation.
6. Confirm that Owner Private is not a store for Finance or HR fields.
7. Approve the audit rule that titles and amounts are not written to metadata.
8. Choose whether `0004` and `0005` ship together or one module first.

The domain specification records a proposed model. It does not answer these eight questions, and it does not approve schema implementation. The live Sheets, Firebase, and runtime-file inventory remains blocked. The operator checklists and the nine readiness gates are in merger-plan sections 15 and 16. Completing a checklist is not approval to implement a schema.
