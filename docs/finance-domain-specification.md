# Wolf Finance domain specification

Phase 3B design record. It does not authorize schema changes, application code, data migration, or production cutover.

Authorities:

| Question | Authoritative document |
| --- | --- |
| Confirmed product decisions and this domain design | This file |
| The eight open owner decisions, copied exactly | [docs/phase-3-finance-hr-architecture.md](phase-3-finance-hr-architecture.md) |
| AMG source inventory, live-access blockers, and merger evidence | [docs/amg-finance-full-merger-plan.md](amg-finance-full-merger-plan.md) |
| Existing Wolf tenant tables and why row-level security is off | [docs/data-foundation.md](data-foundation.md) |
| Milestone order | [docs/multi-company-finance-roadmap.md](multi-company-finance-roadmap.md) |
| Schema readiness | [docs/finance-schema-readiness-review.md](finance-schema-readiness-review.md) |

Labels used below:

- **Verified in source.** Checked in this workspace, or in AMG commit `3c9a1e12ebcb3132875aca6f446c9b88b6eb3452`, during this phase.
- **Previously reported, not independently reverified.** Carried from the merger plan. Not treated as a new live observation.
- **Proposed design.** A recommendation awaiting approval.
- **Unresolved.** Needs an owner, an accountant, or production evidence.

Live Google Sheets, Firebase, and production JSON files were not opened. Their absence from this inspection is not evidence that they are empty.

## 1. Confirmed product decisions

These four decisions are confirmed. They do not approve the accounting model, a schema, row-level security, a data migration, or production cutover. They do not answer the eight open questions in section 2.

1. **Product scope:** Modular Finance platform with company-enabled workflows.
2. **Data isolation:** Shared PostgreSQL infrastructure with enforced tenant isolation.
3. **Company onboarding:** Private onboarding through authorized Wolf operators. Public company registration remains disabled.
4. **Migration strategy:** AMG Finance is the first company implementation and migration pilot.

**Verified in source.** Wolf already uses one PostgreSQL database, company and department tables, and server-side `authorize()`. Isolation today is that application path plus foreign keys. Row-level security is not enabled. Public company registration was not found.

## 2. Eight open owner decisions

Copied unchanged from the architecture note. They remain open. The four decisions above do not resolve them.

1. Approve `finance_records` and `hr_records` as label tables only, with no amounts and no compensation.
2. Confirm that Finance and HR business rows are always department-scoped, and that company-wide access stays on the membership.
3. Confirm soft delete, `ON DELETE RESTRICT` for user attribution, and the absence of a retention period.
4. Confirm that company-wide members may read HR labels, while compensation stays out of the schema until a separate grant exists.
5. Confirm that invoice, ledger, payroll, leave, performance, and recruitment work are out of the first implementation.
6. Confirm that Owner Private is not a store for Finance or HR fields.
7. Approve the audit rule that titles and amounts are not written to metadata.
8. Choose whether `0004` and `0005` ship together or one module first.

**Proposed design.** Do not create `finance_records` or `hr_records`. The first Finance schema, when separately approved, should follow the ledger in this specification. `0004` and `0005` should not be those label tables. Decision 8 stays open until an owner chooses the migration series. HR tables stay unapproved.

## 3. Wolf baseline

**Verified in source** in this workspace. There is no git commit yet. The tree is untracked local work.

- `/finance` and `/hr` render `AccessPanel`. The records API path used by those pages returns `persisted: false` and an empty application list. Invoice and employee copy in navigation and tests is illustrative.
- Sign-in is email and password. The server loads the user, memberships, and grants from the `wolf_session` cookie. `authorize()` does not accept a client user id, role, or grant as proof.
- Actions are `read`, `create`, `update`, `delete`, and `approve`. A membership covers read, create, update, and delete. `departmentId: null` covers every department in that company. Approval and Owner Private require explicit grants. An administrator or owner role does not imply either grant.
- The Finance module rule is department-scoped. The department id must be `finance` or end with `-finance`. Read, create, and update require a covering membership. Delete requires an administrator or owner membership. Approve requires an approve grant. HR uses the same shape with `hr`.
- `companies` and `departments` exist. A department primary key is `(company_id, id)`. Membership and grant department foreign keys are composite and `ON DELETE RESTRICT`. A null department id stays company-wide. `0003_tenant_foundation.sql` says row-level security stays disabled. The migration runner applies schema files inside `sql.begin`.
- `ensureTenant` inserts a company, and a department when one is provided, using the id as the name. `provisionAccount` can call it. The provision command is gated by `WOLF_ALLOW_ACCOUNT_PROVISION=1` and the local database target. It does not call `authorizeProvisioning` and it is not an interactive operator session. `authorizeProvisioning` exists and allows an administrator membership of that company. No public registration route was found.
- Audit metadata rejects keys matching credential, salary, and private patterns. There is no Finance business table.

**Previously reported, not independently reverified.** A local migration through `0003` was applied in an earlier phase. This phase did not reconnect to that database.

## 4. Shared foundation and company workflows

AMG is a hotel ledger. **Verified in source** at the commit above: journal status is `DRAFT`, `VALIDATED`, `APPROVED`, `POSTED`, or `REVERSED`. Inventory, service charge, owner pool, owner email, petty cash, and tax types exist. Service-charge and owner-pool statuses include calculated, approved, and posted states. One service-charge status is `POSTED_TO_PAYROLL`. That name is not a payroll product. Reconciliation types exist inside owner-pool and tax structures, and exception categories include reconciliation variance. A general bank-reconciliation module was not established.

### A. Shared Finance foundation

| Capability | Class | Notes |
| --- | --- | --- |
| Company accounting settings, including currency code and minor-unit scale | Required foundation | The scale is **unresolved**. AMG code defaults to IDR and zero display decimals. |
| Fiscal periods and period locks | Required foundation | AMG keeps a period-lock date in memory. The close procedure is **unresolved**. |
| Chart of accounts | Required foundation | Company-scoped. Not shared across companies. |
| Journals and journal lines | Required foundation | The posting model below is **proposed**. |
| Source documents that explain a journal | First-release capability for the AMG pilot | Revenue and spending are AMG source documents. Other companies may have different documents. |
| Posting, reversal, and correction | Required foundation | Rules are **proposed** until an accountant approves them. |
| Reconciliation | Requires further accounting requirements | AMG has module-specific checks, not one shared reconciler. |
| Financial reporting | First-release capability for the AMG pilot | USALI and hotel statements are company workflows. A trial balance over posted lines is the shared report. |
| Approval | Required foundation | Uses the existing approve grant. It does not create a second permission engine. |
| Attachments | Optional future module | File names appear in AMG tax and petty-cash types. Byte storage was not located. |
| Audit events | Required foundation | Wolf audit stays structural. Amounts stay on the journal, not in metadata, unless decision 7 is changed. |

### Accounting invariants

Each item is a **proposed design** until an owner and an accountant approve it.

| Invariant | Proposal |
| --- | --- |
| Balanced journals | A journal can post only when the sum of debits equals the sum of credits in the same currency. Drafts may be unbalanced. |
| Posted immutability | A `POSTED` journal’s lines, amounts, accounts, and date do not change. Corrections are new journals. |
| Controlled reversal | Reversal creates a new journal that references the original, swaps the sides, and sets the original to `REVERSED` only through that workflow. |
| Closed periods | A post or reversal into a locked period fails. Locking is company-scoped. |
| Duplicate prevention | Source journal ids and source document ids are unique per company. |
| Traceability | Each posted journal records the Wolf user who approved and posted it. Unmapped historical names stay in a source label, not as a Wolf user id. |
| Same-company links | A line cannot reference an account, period, operating department, or source document from another company. |
| No silent float | Import rejects values that are not exact decimal text. It does not use binary floating point as the stored amount. |

**Verified in source.** AMG loads sheet debits, credits, and amounts with `parseFloat`. That behavior is a migration risk, not the Wolf rule.

### B. Company-enabled workflows

A company that uses Finance always receives the shared foundation. Extra workflows are enabled explicitly for that company. They are not implied by a finance department membership.

**Proposed design.** A closed registry, not a plugin loader. The registry is data: company id, module key, enabled flag, and who enabled it. Allowed keys are the rows below. There is no dynamic code execution and no tenant-supplied program.

| Workflow | Evidence | Storage today | Placement | Scope | Sensitive fields | Proposed model |
| --- | --- | --- | --- | --- | --- | --- |
| Operating departments | **Verified in source.** AMG `departments` tab and journal `department_code`. | Sheet or memory | Company-specific dimension inside Finance | Company. Not a Wolf `departments` row. | Names only | `finance_operating_departments` per company |
| Revenue and spending | **Previously reported.** Sheet tabs and in-memory maps. | Sheet or memory | Company-specific source documents | Company, attributed to an operating department | Descriptions, vendor or employee text | Optional document types that must produce a balanced journal |
| Inventory | **Verified in source** as types and `data/inventory.json` in git. Live use **unresolved**. | JSON file | Company module | Company, with operating-department attribution | Costs, supplier names | Enabled per company. Posts journals through the foundation. |
| Service charge | **Verified in source** as types and git JSON. | JSON file | Company module | Company | Staff names, bank fields, payout amounts | Enabled per company. Not HR. |
| Owner pool | **Verified in source** as types and git JSON. | JSON file | Company module | Company | Owner identity, bank fields, contract amounts | Stays in Finance. Not Owner Private. |
| Owner email | **Verified in source** as a JSON store and Nodemailer path. | JSON file plus SMTP env | Company module | Company | Recipient addresses | Dispatch history only. SMTP secrets stay out of PostgreSQL. |
| Petty cash | **Verified in source** as types and git JSON. | JSON file | Company module | Company | Payee names, amounts | Enabled per company. |
| Tax | **Verified in source** as code defaults plus optional `tax_module.json`. | File when present | Company module | Company | Rates, filing notes, attachment names | Do not treat code defaults as production tax. |
| Hotel profile | **Verified in source.** `systemSettings` in memory, including `base_currency: 'IDR'`. | Memory only | Company module | Company | Property and controller display names | Not a platform-wide setting. |

**Unresolved.** Whether any of these modules are enabled in production. Whether service-charge staff ever become HR. Whether a non-hotel company needs any of them. They must be disableable without removing the ledger.

### C. Out of scope

**Proposed design**, consistent with open decision 5 until that decision is answered.

Payroll, employee master records, compensation, leave, performance, recruitment, and a general HR product are out of scope. The service-charge status `POSTED_TO_PAYROLL` does not create those workflows. `hr_records` is not approved. Owner Private is not a store for Finance or HR records.

## 5. Conceptual entity model

These are **proposed design** entities. Column types and migration names are intentionally omitted where the accounting rules are unresolved. Wolf `companies`, `departments`, `users`, `memberships`, `grants`, `sessions`, and `audit_events` already exist and are not duplicated.

| Entity | Purpose | Ownership | Sensitive | Invariants and keys | Delete and audit | Authorization |
| --- | --- | --- | --- | --- | --- | --- |
| Company | Tenant. Already exists. | Platform row. A user is not owned by one company. | Display name | Id stable. Status active or disabled. | `ON DELETE RESTRICT` while children exist. | Private onboarding. No public insert. |
| Wolf department | Access boundary. Already exists. | Company. Key `(company_id, id)`. | Low | Finance gate is `finance` or `*-finance`. | Restrict while memberships or grants point at it. | Membership. Null department means company-wide access. |
| Finance settings | Currency, scale, and lock policy for one company. | Company only. No department. | Low | One row per company. | Restrict. Audit the change, not the amount stream. | Finance administrator membership. |
| Accounting period | A company month or other approved period, with lock state. | Company only. | Low | Unique `(company_id, period_key)`. | Do not delete a period that has journals. | Lock and unlock require an approve grant. **Unresolved** whether unlock is allowed. |
| Account | Chart line. | Company only. | Low | Unique `(company_id, account_code)`. | Deactivate. Do not delete if lines exist. | Finance membership to read. Administrator to change. |
| Operating department | Accounting dimension, AMG department code. | Company only. | Low | Unique `(company_id, code)`. | Deactivate if lines exist. | Same as accounts. Not a Wolf department. |
| Journal | Header of a double entry. | Company. Optional Wolf finance department for the access gate, not for the hotel code. | Source labels may name people. | Unique `(company_id, source_journal_id)`. Status follows the approved lifecycle. | Draft removal is **unresolved** with decision 3. Posted rows are not deleted. | Membership to draft. Approve grant to approve, post, and reverse. |
| Journal line | One side of an entry. | Company, inherited from the journal and checked by constraint. Operating department optional only if the company’s policy allows it. | Description text | Composite foreign keys to the journal, account, and operating department in the same company. | Deleted only with a draft journal. | Same as the journal. |
| Source document | Revenue, spending, or a later company document that explains lines. | Company. | May name a guest, vendor, or employee. | Unique `(company_id, document_id)`. | Follows the journal it posted. | Finance membership, plus the company module flag. |
| Module configuration | Which optional workflows a company has enabled. | Company. | Low | Unique `(company_id, module_key)` from the closed list. | Disabling hides writes. It does not delete history. | Operator or company administrator. **Unresolved** which role may enable a module. |
| Approval action | Record of an approve, post, or reverse decision. | Company. | Actor id | References the journal or document in the same company. | Retain with the journal. | Written only after `authorize()` allows `approve`. |
| Attachment metadata | Pointer to a file, not the bytes. | Company. | File names can identify people. | Storage key is unguessable. Bytes live outside PostgreSQL. | **Unresolved** with decision 3. | Same read rule as the parent record. Download checks the session again. |
| Reconciliation | Match between two sets of amounts. | Company. | Amounts | Not specified until an accountant defines the pairs. | Retain. | **Unresolved.** |
| Audit event | Already exists. | Optional company. Resource type and id together. | Must not hold amounts, salaries, or private bodies. | Existing checks. | Wolf retention is **unresolved**. | Writers are server-side only. |

Company-scoped: settings, periods, accounts, operating departments, journals, lines, source documents, module flags, approval actions, attachments.

Department-scoped for access: the Wolf finance department on the request. That is the membership gate. It is not a foreign key on every accounting row.

Department-attributed inside the books: journal lines and source documents may carry an operating-department code. A null operating department is a business rule, not the company-wide membership flag.

Shared reference data: none for accounts or tax rates. Two companies do not share a chart.

Global platform configuration: the closed module-key list and the authorization matrix. Not per-company charts.

### Tenant integrity

**Proposed design.**

- Every finance row stores `company_id`.
- Related rows use composite foreign keys that include `company_id`, so a line cannot point at another company’s journal, account, or operating department.
- The application also sets `company_id` from the session’s allowed company, not from an unchecked client field. The constraint is the backstop.
- Queries and exports include the company predicate even when the constraint exists.
- A company owner membership does not grant another company or Owner Private.

**Unresolved.** Whether the Wolf finance department id is stored on each journal for audit, or only checked at request time. Decision 2 asked for every business row to be department-scoped. This specification proposes company scope for the chart and settings, and operating-department attribution for lines. That is a deliberate difference and needs an owner answer. It does not silently close decision 2.

## 6. Money

**Verified in source.** AMG defaults `base_currency` to `IDR` and report formatting to symbol `Rp` with `decimal_places` 0. Those defaults are in memory and are not a verified production configuration. Amounts loaded from sheets use `parseFloat`.

**Unresolved.** Production currency, whether more than one currency exists, tax rounding, and the minor-unit scale.

**Proposed design**, awaiting approval. Do not assume two decimal places.

| Approach | What it preserves | Trade-off |
| --- | --- | --- |
| PostgreSQL `numeric` with a per-currency scale stored on finance settings | Exact decimal text. Scale can be 0 for IDR or another approved scale. | Application code must use decimal arithmetic, not JavaScript `number`. |
| Integer minor units | Fast and exact when the scale is fixed. | A scale change, or a currency with a different scale, needs a conversion record. Easy to misuse if one company mixes scales. |

Recommendation: store money as `numeric` and store the currency code and scale on the company finance settings. Arithmetic uses decimal operations at the approved scale. Rounding happens once, at the stage the accountant names, and the rounded result is what is posted. Display precision may differ from storage scale only when the report says so.

Journal balance compares exact stored values in one currency. Cross-currency lines in one journal are rejected until a conversion design is approved. Exchange rates and historical conversion are an optional future module, not part of the AMG pilot unless production evidence shows more than one currency.

Import stores the source decimal text and the parsed `numeric` value. Reconciliation of posted balances requires exact equality with the approved legacy total. No tolerance is set here. A tolerance would be an accounting decision.

Refunds, negative source documents, and adjustments are represented as their own journals or as reversals. A single journal line remains one-sided: one side zero, the other signed only if the accountant allows negative amounts. That sign rule is **unresolved**. AMG’s current types use JavaScript numbers and were not re-audited line by line for sign conventions.

## 7. Authorization and tenant isolation

**Verified in source.** Preserve the current semantics.

- The session is verified on the server.
- Company membership is loaded from the database.
- Department scope is the membership’s department, or the whole company when the department is null.
- Owner Private and approve are explicit grants.
- Finance and HR pages, APIs, exports, and mutations must call the server guard. Client company ids, roles, user ids, and grants are not proof.
- Attachments, when they exist, use the same guard on download.
- Background work, when it exists, runs as a server identity with an explicit company id. It does not trust a queued client payload for authority.
- Audit records the Wolf user id from the session.
- Tests must deny a user in company A from reading or writing company B, including exports and attachment URLs.

**Proposed design.** A finance membership does not enable inventory, service charge, owner pool, or tax. Those checks read the company module flag after the membership check. Service-charge staff and owner-pool statements need a narrower grant than ordinary finance read. That grant does not exist today. Adding it is an authorization change and is **unresolved**. Until it exists, those modules stay disabled rather than opening them to every finance member.

Company-wide membership can already open Finance and HR. **Verified in source.** That must not be treated as access to compensation or to owner-pool bank fields. Decision 4 remains open for HR labels. This specification does not extend company-wide membership to those sensitive modules.

### Row-level security

**Verified in source.** Row-level security is disabled. The application connects as the table owner. PostgreSQL does not apply policies to the table owner unless `FORCE ROW LEVEL SECURITY` is set. The pool does not set a per-request tenant. `authorize()` remains the decision.

**Proposed design.** RLS is a later defense-in-depth layer, not the first Finance migration. Fail closed: a query with no tenant context returns no finance rows and inserts nothing. Policies must match `authorize()`, not replace it. Design questions that must be answered before any policy is written:

- A non-owner application role, separate from the migration role.
- `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` on finance tables.
- A transaction-local company id, set after the session is verified and cleared before the connection returns to the pool.
- Policies for select, insert, update, and delete.
- A job role that can set only the company it was assigned.
- No `BYPASSRLS` on the application role. Table owners and superusers bypass policies unless forced, and even then superusers can bypass.
- Malformed or missing tenant context denies the statement.
- Tests that compare policy results with `authorize()` for allow and deny, including company-wide membership and Owner Private.

This phase does not create roles or policies.

## 8. Private company onboarding

**Proposed design.** Public registration stays disabled. No platform-superadmin role exists today. The operator mechanism is **unresolved**. The current provision command can create a company as a side effect of creating a user, without an administrator session. That command is not the onboarding workflow below.

1. An authorized Wolf operator verifies the request. The operator check must be a server-side rule. It is not implemented.
2. A protected server workflow creates the company.
3. The workflow writes the minimum finance settings once currency and scale are known. It does not enable hotel modules unless the request names them.
4. It creates a Wolf finance department for access. Hotel operating departments are data, created only for companies that use them.
5. It assigns explicit memberships. It does not grant every existing Wolf user.
6. It verifies department ids and grants. Owner Private is not added unless a separate grant was requested for that company.
7. It writes audit events for the company, the memberships, and the grants. Metadata stays free of amounts and secrets.
8. The company remains disabled until settings, membership, and an isolation check pass. The check denies a second company’s user from reading the new company.

A company owner does not gain other companies or Owner Private.

## 9. AMG source mapping

Live verification is **unresolved** for every row. Read and write behavior is **verified in source** unless the cell says it was only previously reported. Do not load git JSON or the display spreadsheet id as production input. Do not migrate plaintext passwords. Future cutover provisions Wolf users, sets a password change, and delivers the temporary password outside the repository. Duplicate emails are resolved manually. Display names are not a match key.

| Source | Behavior | Sensitive | Proposed target | Validation and rollback | Open question |
| --- | --- | --- | --- | --- | --- |
| Six sheet tabs: accounts, departments, journal header, journal line, revenue, spending | When configured, startup replaces memory from the sheet. Later sync clears and rewrites the tab. Otherwise memory only. | Amounts and names | Foundation accounts, operating departments, journals, lines, and source documents | Decimal parse must be exact. Leave the sheet in place. | Production spreadsheet id and whether it is connected. |
| `inventory.json` | Process `data/` file. Git copy is not production. | Costs, names | Inventory module | Reconcile quantities and valuation. | Which host directory is live. |
| `service_charge.json` | Same. | Staff and bank fields | Service-charge module | Do not put staff into HR unless approved. | Same. |
| `owner_pool.json` | Same. | Owners, bank fields, contracts | Owner-pool module inside Finance | Statement totals must match exactly after approval. | Same. |
| `owner_email_store.json` | Same. SMTP secrets are env vars. | Recipients | Dispatch history | Do not copy secrets. | Same. |
| `petty_cash.json` | Same. | Payees, amounts | Petty-cash module | Voucher totals. | Same. |
| Tax defaults and optional `tax_module.json` | Defaults in code. File overlays them if present. | Rates and notes | Tax module | Do not import defaults as production. | Whether the host file exists. |
| In-memory users and roles | Seeded in source. Not stored in `system_state.json`. | Plaintext passwords | Wolf users and memberships | Passwords discarded. | The running user list. |
| Hotel profile, currency, period lock | Memory. Admin POST does not persist. | Display names | Finance settings | Capture out of band. Do not call status routes that echo credential identifiers. | The running values. |
| `system_state.json` | Mock-data flag only, if this commit is what the host runs. | Low if the shape matches | No user import | Stop if extra keys appear. | Host presence. |
| Firebase Authentication | Google popup, then a client flag. No server token check. | Account ids if any | No automatic copy | Re-enroll in Wolf. | Whether the project is live. |
| Firestore `/users` and `/roles` | Rules and blueprint only. No application call in this commit. | Profiles if documents exist | No copy | Confirm with a count, not an export. | Deployed revision and documents. |

The connected-sheet behavior is source-code behavior. It is not verified live authority. Details and the operator checklists remain in merger-plan sections 14 through 16.

## 10. Migration and reconciliation

**Proposed design.** Schema approval and cutover approval stay separate. The legacy system stays recoverable until cutover is approved and the rollback period ends.

1. Close the source-of-truth questions in section 9, or accept each blocker in writing.
2. Obtain a redacted structural sample through the approved read-only process. No row contents in git.
3. Freeze this domain model with the accounting decisions in section 12 answered.
4. Obtain explicit schema approval.
5. In a later phase, build an importer that can be run twice against an empty isolated database without duplicating source ids.
6. Rehearse there. Do not use the local Wolf database as the rehearsal target until a separate approval names it.
7. Reconcile counts, source ids, posted debit and credit totals, date ranges, currency codes, tax control totals, and approved reports.
8. Run cross-company deny tests, including exports and attachments.
9. Obtain a separate production cutover approval.
10. Keep AMG, the sheet, and the host `data/` directory. Rollback stops Wolf finance writes and does not delete those sources or Wolf tenant tables.

Acceptance, still **unresolved** as numbers. Posted financial balances require exact equality once the scale is approved. Counts of journals, lines, and source documents require exact equality. No percentage tolerance is proposed. Display rounding differences must be explained as display, not as a second stored total.

## 11. Decisions this specification adds

None of these are approved.

1. Which foundation capabilities ship before any company module.
2. Which currencies and minor-unit scales are allowed, starting with whether the pilot is IDR with scale 0.
3. `numeric` versus integer minor units, and the rounding stage.
4. Whether posted journals are immutable and whether reversal is the only correction.
5. Who may lock a period, and whether unlock exists.
6. Company scope for the chart and settings, versus department scope on every row. This interacts with open decision 2.
7. Who may enable a company module, and which modules the AMG pilot turns on.
8. Retention and draft deletion. This interacts with open decision 3.
9. Whether RLS is in the first finance migration or a later one.
10. The exact reconciliation comparisons and the rollback period.

## 12. What remains blocked

Implementation is blocked until schema approval exists, and cutover is blocked until a second approval exists. Production inventory gaps in the merger plan are still open. The local Wolf database was not contacted for this specification.
