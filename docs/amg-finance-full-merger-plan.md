# AMG Finance full merger plan

Companion to [docs/phase-3-finance-hr-architecture.md](phase-3-finance-hr-architecture.md). This file is the AMG evidence and migration record. The Finance domain design is [docs/finance-domain-specification.md](finance-domain-specification.md). Milestones are [docs/multi-company-finance-roadmap.md](multi-company-finance-roadmap.md). This plan does not authorize schema changes, data migration, or cutover.

## 1. Repositories inspected

| Repository | Revision | What was read |
| --- | --- | --- |
| Wolf Command, this workspace | No commits. The tree is untracked local work, including the current architecture proposal. | Finance and HR pages, `AccessPanel`, `open-module.ts`, `records-request.ts`, `api/records/route.ts`, `matrix.ts`, `packages/shared` `authorize()`, `audit.ts`, `schema.ts`, `migrate.ts`, `docs/data-foundation.md`, `docs/ACCESS.md`. |
| [Zaynn28/ATRIUM-FINANCE](https://github.com/Zaynn28/ATRIUM-FINANCE) | `3c9a1e12ebcb3132875aca6f446c9b88b6eb3452` (2026-10-22, “refactor(ui): complete light professional enterprise aesthetic”). Cloned read-only under `/tmp` for inspection. | `package.json`, `server.ts`, `server/sheets.ts`, `server/store.ts`, store classes, `src/types.ts`, `src/App.tsx`, `src/services/firebase.ts`, `src/services/api.ts`, `src/components/auth/LoginScreen.tsx`, `firestore.rules`, `.env.example` key names, `metadata.json`, `data/` file names and sizes, `src/utils/reportExport.test.ts`. |

The AMG clone was not modified. Phase 3A.2 tried a read-only live inventory and could not open the spreadsheet, the Firebase project, or a runtime `system_state.json`. The blocker and the corrected source map are in section 14. Environment values, service-account keys, passwords, and personal data are omitted. The only spreadsheet id recorded there is a display fallback committed in the client, and it was not opened.

## 2. Evidence classes

**Verified Wolf.** Finance and HR pages are access checks. The records API returns `persisted: false` and an empty list in the application. Authentication, memberships, grants, companies, departments, and the transactional migration runner are as described in the architecture note.

**Verified AMG.** Single package `react-example`. React 19, Vite 6, Express 4, TypeScript. UI navigation is in-memory pillars, not a URL router. Express serves `/api/*` and the Vite or static client. Dependencies used by the product include `googleapis`, `firebase`, `nodemailer`, `jspdf`, `xlsx`, and `motion`. `@google/genai` is declared. The inspected server path that sends owner-pool mail uses Nodemailer, not the GenAI client. One test file covers report CSV, Excel, and PDF export. There is no Dockerfile and no GitHub Actions workflow in the repository. `metadata.json` describes a hotel accounting system and requests a camera frame permission.

**Proposed.** Wolf-hosted Finance module, Wolf sessions, PostgreSQL tables shaped like the AMG entities, and a dry-run reconciliation. None of this is built.

**Assumptions requiring approval.** Which Wolf company receives the hotel books, how AMG roles map onto Wolf memberships, and whether service-charge employees become HR.

**Unknowns.** Whether any deployment has `GOOGLE_SPREADSHEET_ID` set, and whether that sheet matches the six tabs in source. Whether the Firebase project named in the committed client config is the deployed login, and whether its Auth or Firestore stores have records. Whether a running process has `data/tax_module.json` or `data/system_state.json`. The committed JSON files are a git snapshot, not proven production data. No production database was available to inspect because the application does not use PostgreSQL.

## 3. How AMG stores data

There is no ORM and no SQL migration directory.

When Google Sheets credentials are present, `GoogleSheetsClient` initializes and `store.ts` loads and writes these tabs:

| Tab | Columns verified in `REQUIRED_TABS` |
| --- | --- |
| `chart_of_accounts` | account code and name, account type, normal balance, statutory line, USALI line, active |
| `departments` | department code, department name, active |
| `journal_header` | journal id, date, period `YYYY-MM`, status, source type, source reference, created by, approved by, posted at, reversal of |
| `journal_line` | journal id, line number, account code, department code, debit, credit, description |
| `revenue_transactions` | transaction id, date, source, department, account, amount, description, journal id |
| `spending_transactions` | transaction id, date, type, vendor or employee, department, account, amount, description, journal id |

If Sheets is not connected, those collections stay in the Express process memory and are seeded there. Users and roles stay in that memory. `data/system_state.json` is not an access-control snapshot. `store.init` reads only `mock_data_cleared`. `resetMockData` writes `{ mock_data_cleared: true, cleared_at }`. `seedDemoData` deletes the file.

Separate JSON files, present in the repository except where noted:

| File | Store | Present in the inspected tree |
| --- | --- | --- |
| `data/inventory.json` | `inventoryStore.ts` | Yes |
| `data/service_charge.json` | `serviceChargeStore.ts` | Yes |
| `data/owner_pool.json` | `ownerPoolStore.ts` | Yes, about 350 KB |
| `data/owner_email_store.json` | `ownerEmailStore.ts` | Yes |
| `data/petty_cash.json` | `pettyCashStore.ts` | Yes |
| `data/tax_module.json` | `taxStore.ts` | Not in the tree. The path is created when the process writes it. |
| `data/system_state.json` | Mock-data flag only (`mock_data_cleared`, `cleared_at`) | Not in the tree. Runtime copy unverified. |

`arapStore.ts` is in-memory aging derived from the ledger path. It has no JSON file of its own.

Firebase Auth is initialized. The login screen can open a Google popup and then calls `POST /api/auth/verify-user`. Email and password login posts the password to that same route. `signInWithEmailAndPassword` is imported and not the path that checks the password. Firestore rules allow any signed-in Firebase user to read and write `/users` and `/roles`. The inspected application code does not call Firestore `collection`, `setDoc`, or `getDoc`. The running registry is the Express store.

Journal status values are `DRAFT`, `VALIDATED`, `APPROVED`, `POSTED`, and `REVERSED`. Source types include revenue, spending, manual, reversal, AR settlement, and AP payment. Debit and credit fields are TypeScript `number`.

## 4. Feature and route matrix

The client has no route table. The target Wolf location is under the existing `/finance` module after the access check. Sub-areas can be paths such as `/finance/journals`. Names below are targets, not implemented routes.

| Feature | AMG source | Data source | Auth today | Wolf target | Code change | Schema | Regression |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Login and RBAC registry | `LoginScreen.tsx`, `POST /api/auth/verify-user`, access-control routes in `server.ts`, `SystemUser` in `types.ts` | In-memory users seeded in `server/store.ts`. Not `system_state.json`. | Plaintext password or client `isGoogleOAuth` flag. Firebase Google popup optional. | Remove. Wolf `/login` and memberships. | Do not move this login. | Map people to `users`. Do not copy the password column. | Wolf login tests stay green. AMG password check is not reachable. |
| Command centre | `DashboardView.tsx`, `GET /api/dashboard` | Derived from the ledger | Header identity, defaulting if absent | `/finance` home | Rehost the view inside `AppShell` after `loadGuardedModule`. | None beyond the ledger | Dashboard totals match the source trial balance for a fixture period. |
| Chart of accounts | `ChartOfAccountsView.tsx`, `/api/accounts` | Sheets tab or memory | Unauthenticated API | `/finance/accounts` | Move view and posting rules. Authorize on the server. | `finance_accounts` | USALI seed is idempotent. Deactivated codes cannot be posted. |
| Hotel departments | department routes, `Department` type | Sheets `departments` | Unauthenticated API | `/finance/operating-departments` | Keep codes as finance dimensions. | `finance_operating_departments` | A rooms code does not become a Wolf `departments` id. |
| Revenue and spending capture | `RevenueCycleView.tsx`, `SpendingCycleView.tsx` | Sheets transaction tabs | Header user name | `/finance/revenue`, `/finance/spending` | Preserve journal generation. | `finance_revenue_transactions`, `finance_spending_transactions` | Each posted batch balances and links to one journal. |
| Journal workbench | `JournalWorkbenchView.tsx`, `ManualJournalModal.tsx`, `/api/journals/:id/validate|approve|post|reverse` | Sheets header and lines | Approve uses a display name from the body or header | `/finance/journals` | Server checks Wolf membership for edit and an approve grant for approve, post, and reverse. | `finance_journal_headers`, `finance_journal_lines` | Unbalanced journals fail validation. Reverse creates a linked journal. Approve without a grant is denied. |
| General ledger, trial balance, drilldown | `GeneralLedgerView.tsx`, `TrialBalanceView.tsx`, `/api/ledger`, `/api/trial-balance`, `/api/reports/drilldown` | Derived | Read APIs are open | `/finance/ledger`, `/finance/trial-balance` | Move report math. | Read models over the journal tables | Report export test vectors still match. |
| USALI and financial statements | `src/components/reports`, `/api/reports/usali`, `/api/reports/financial-statements`, `reportExport.ts` | Report config in memory, lines from the ledger | Export is a UI permission only | `/finance/reports` | Move formatter, CSV, XLSX, and PDF helpers into a server-side exporter. | `finance_report_structures` for the saved layout | Exported numbers match on-screen statements. CSV injection cases in the existing test stay covered. |
| Controls and exceptions | `ControlsAuditView.tsx`, `/api/controls/exceptions` | Derived | Open read | `/finance/controls` | Move exception rules. | None if derived | Known imbalance fixtures raise exceptions. |
| Integrations and PMS audit | `IntegrationsView.tsx`, `POST /api/integrations/pms-audit`, `POST /api/sheets/init` | Sheets | Open | Keep Sheets as a migration source, not the Wolf system of record. | No ongoing write-back until cutover is approved. | Staging tables only during dry run | Init does not run against the production spreadsheet in tests. |
| Inventory, requisitions, purchase orders, receipts, counts | `src/components/inventory`, `/api/inventory/*` | `data/inventory.json` | Several routes default `x-user-id` to a controller id | `/finance/inventory` | Move store logic into server actions. Approval routes require an approve grant. | Inventory tables listed in section 6 | Requisition approval uses the real `PENDING` status. PO receipt posts a balanced journal. |
| Accounts receivable and payable | `src/components/ar`, `src/components/ap`, `/api/ar/settlements`, `/api/ap/payments` | `arapStore.ts` plus journals | Display name header | `/finance/ar`, `/finance/ap` | Preserve settlement journals. | `finance_ar_items`, `finance_ap_items` if the store holds durable rows; otherwise derive them | Settlement cannot exceed the open item. |
| Service charge | `src/components/operations/service-charge`, `/api/service-charge/*` | `data/service_charge.json` | Approve route takes an approver name | `/finance/service-charge` | Treat staff rows as sensitive. | Service-charge tables | Calculate, approve, and the resulting journal match the source cycle. |
| Owner pool and owner email | `src/components/operations/owner-pool`, `/api/owner-pool/*` | `owner_pool.json`, `owner_email_store.json`, SMTP | Post, reverse, and send trust headers or body names | `/finance/owner-pool` | Keep inside Finance. Do not import SMTP secrets. Sending mail stays disabled until a separate approval. | Owner-pool tables | Statement totals match the source batch. Send is refused without the later mail approval. |
| Tax | `TaxModule.tsx`, `/api/tax/*` | `taxStore.ts` JSON | Mutating routes trust a user name | `/finance/tax` | Move rules, obligations, filing, and period close. | Tax tables | Period close blocks when reconciliation fails. Reopen is an administrator action plus an audit event. |
| Petty cash | `PettyCashView.tsx`, `/api/petty-cash/*` | `data/petty_cash.json` | Replenish uses an approver header | `/finance/petty-cash` | Move the float and voucher flow. | `finance_petty_cash_transactions` | Replenishment journal balances. Delete is limited to drafts. |
| Administration, settings, mock reset | `AdministrationView.tsx`, `/api/admin/*` | Users, roles, mock flags | Reset and user create are unauthenticated | Wolf settings and the existing provision command | Do not move mock reset or user CRUD. | None | Those routes are absent from Wolf. |
| Report export | `src/utils/reportExport.ts` and its test | Generated files | UI `canExport` | Server export on the report routes | Port the test with the exporter. | None | The seven existing tests pass inside Wolf. |

Code placement:

- Move UI and calculation modules into `apps/wolf` only after the auth wrapper exists. Adapt them to the Wolf layout and server actions.
- Put pure report formatting and USALI calculation helpers in a package only if a second app needs them. One Wolf app does not require that split on day one.
- Replace AMG login, Firebase session use, header identity, and role checks with Wolf session, `authorize()`, and the module matrix.
- Retain Google Sheets, Firebase Auth, and SMTP as external systems during migration. They are not Wolf dependencies after cutover. Sheets stays readable for reconciliation until the owner retires it.

## 5. Authentication and authorization migration

Target:

- One Wolf login. No Finance password table and no second session cookie.
- The actor is loaded with `loadTrustedActor`. Pages, journal mutations, exports, and report routes call the same server guard.
- A Wolf user receives Finance only through a membership whose department serves `finance`, or a company-wide membership in that company. No bulk grant to every Wolf user.
- Approval of journals, requisitions, counts, service-charge cycles, owner-pool batches, tax close, and petty-cash replenishment requires an `approve` grant covering that finance department, or a company approve grant. Administrator and owner roles do not approve by themselves.
- Owner-pool data stays in Finance. It is not Wolf Owner Private. Owner Private remains a separate grant and stays read-only in Wolf.
- Client user ids, role names, `x-user-id`, `x-user-name`, and `isGoogleOAuth` are ignored.

Password and identity cutover:

- AMG stores plaintext passwords and ships seed passwords in source. Those values are compromised. They must not be hashed into Wolf and must not be copied into docs or logs.
- Firebase email/password hashes were not found in this application, so there is nothing to convert. Google sign-in does not yield a Wolf password.
- Recovery path: provision the person with the existing Wolf command, set `must_change_password`, and deliver the temporary password outside the repository. The person signs in to Wolf and replaces it. AMG login is left intact until cutover and then disabled.
- Before linking, produce a private email inventory from the running AMG user list. The git seed is not that list, and `system_state.json` does not store users. Match on Wolf’s normalized email. Duplicate AMG emails need a manual survivor. Do not link on display name. Do not print the inventory in git.
- On cutover, revoke Wolf sessions for mapped users once, then require the password change. AMG’s `currentUserId` switcher has no Wolf equivalent and is not ported.

Role mapping is not one-to-one. AMG permissions are per navigation pillar (`view`, `create`, `edit`, `approve`, `delete`, `export`). Wolf Finance is one module. Mapping every AMG role to finance `staff` would let a cashier edit the ledger and a read-only auditor post journals. That weakens AMG. Mapping the hotel “owner” role to Wolf `owner` would add delete and would still not grant Owner Private, but it would over-grant Finance writes.

Recommended first cutover, if approved:

| AMG role | Wolf membership | Extra grant | Deferred because |
| --- | --- | --- | --- |
| Financial Controller | Administrator on the finance department | Department or company `approve` | None for the core ledger. Provisioning other Wolf accounts stays the existing administrator rule and should be confirmed. |
| General Accountant | Staff on the finance department | None | Matches “cannot approve.” Still wider than AMG if the accountant can open owner pool and service charge. |
| Front office, AP and purchasing, general manager, auditor | No Wolf Finance membership yet | None | Wolf cannot express view-only or pillar-limited access without a new permission. |

Export follows the same read decision until an export grant exists. Read-only roles stay out of the first cutover rather than gaining write.

Service charge and owner pool should not be visible to every finance staff membership. The proposed gate is an explicit grant beyond the module membership. That grant type does not exist today. Implementing it is an authorization change and waits for approval. Until it exists, those screens stay dark for everyone except a specifically approved operator list stored as grants, not as a role name shortcut.

Session cutover: Wolf remains the only writer after the approved switch. AMG stays deployed and recoverable. Its Sheets and JSON files are not deleted.

## 6. Proposed PostgreSQL model

All new tables are finance-specific. They include `company_id` referencing `companies` on delete restrict. They do not duplicate Wolf identity tables.

`finance_operating_departments` holds AMG department codes. Primary key `(company_id, department_code)`. This is not `departments`, the Wolf membership department.

`finance_accounts` holds the chart. Primary key `(company_id, account_code)`.

`finance_journal_headers` and `finance_journal_lines` hold the books. Header id is the source journal id, unique per company. Lines reference the header, an account, and an operating department in the same company. `debit` and `credit` are `numeric(20, 2)`, not `float`. A check requires one side to be zero and the other non-negative, matching a single-sided line. Status is the AMG enum. `approved_by` and `posted_by` are Wolf user ids, nullable on drafts, with `ON DELETE RESTRICT`. Source display names are kept in `source_actor_name` for history that cannot be mapped. `period` is a `date` of the first of the month or a `text` `YYYY-MM` check. Dates are `date` types, not strings.

`finance_revenue_transactions` and `finance_spending_transactions` keep the source ids and amounts as `numeric(20, 2)`, and point at the journal when one exists. Spending’s vendor-or-employee column stays text. It is sensitive when it names a person.

Inventory, service charge, owner pool, tax, and petty cash follow the TypeScript interfaces in `src/types.ts` with the same company scope, numeric money, and source ids. Service-charge staff and owner-pool units are sensitive. Owner email configuration stores host and sender labels only. SMTP secrets stay in Wolf’s secret store, not in a table row that the app selects into the client.

Report structure can be a `jsonb` document per company if the source config is the tree in `MasterReportConfig`. Calculated statements are not stored as the source of truth. They are recomputed from posted lines. A snapshot table can store a frozen export after close, and that is optional.

Indexes: company plus period, journal status, account, and operating department. Unique source ids per company so a dry run can be repeated without duplicating history.

Do not create `finance_records`. Do not create `module_records`.

Row-level security stays off. The finance department membership is the Wolf gate. Operating department codes filter data inside that gate. They do not replace it.

## 7. Source-to-target mapping

| Source | Target | Notes |
| --- | --- | --- |
| Sheets `chart_of_accounts` or in-memory accounts | `finance_accounts` | Natural key is the account code. |
| Sheets `departments` | `finance_operating_departments` | Not Wolf departments. |
| Sheets journal header and lines | Journal tables | Preserve ids, status, reversal links, and period. |
| Sheets revenue and spending | Transaction tables | Amounts converted through a decimal parser, not `parseFloat` as the stored value. |
| `inventory.json` | Inventory tables | Include requisitions, purchase orders, receipts, counts, movements. |
| `service_charge.json` | Service-charge tables | Staff rows are sensitive. |
| `owner_pool.json` | Owner-pool tables | Historical batches and statements. |
| `owner_email_store.json` | Draft and dispatch tables | Drop SMTP passwords. Keep dispatch outcome and time. |
| `petty_cash.json` | Petty-cash tables | |
| `tax_module.json` if a runtime file exists | Tax tables | Absent from the git tree. |
| `system_state.json` if a runtime file exists | No user import | Source writes only the mock-data flag. Do not treat it as an identity store. |
| Firebase `/users` and `/roles` | No automatic copy | Rules exist. Application reads were not found. Confirm the live project before ignoring it. |
| Attachments | Object storage later | Tax and owner-pool types include file names and attachment kinds. Binary bodies were not found as a committed store. Unknown where bytes live. |
| GenAI capability flag | Not migrated | Declared in metadata. No call site was found in the mail path. |

Duplicates and gaps to reconcile in the dry run, not by guessing now:

- Memory, Sheets, and JSON can disagree if a write succeeded in only one of them.
- Users in git are seed records in memory. A running server can change them without writing a user file. `system_state.json` does not save that list.
- Actor fields are names, not stable ids.
- JavaScript numbers can already have rounding differences. The dry run should compare source text, the numeric cast, and report totals.
- Missing tabs or a disconnected spreadsheet mean the JSON and memory seeds are the only copy available from git.

No source system is deleted or switched to read-only in this phase.

## 8. External systems

Google Sheets is a verified optional store for the six accounting tabs when three environment variables are set. The client is `googleapis` with a service account and the full spreadsheets scope, which can create tabs and clear ranges. The live spreadsheet was not opened in Phase 3A.2. See section 14.

Firebase is a verified Google sign-in client and an unused-looking Firestore ruleset. It is not the ledger.

SMTP is a verified owner-pool mail transport. Secrets stay out of git and out of PostgreSQL.

PMS audit is a single POST endpoint. The external PMS contract was not established beyond that route. Treat it as an integration to re-specify, not as a migrated feed.

No scheduler was found.

## 9. HR assessment

Wolf HR is an access-controlled empty page. AMG has no HR app. Service-charge `StaffEmployee` records, with grade and employment status, are the only employee register found. They exist to distribute a trust fund, which is a finance workflow.

`hr_records` does not become justified by that register. The first HR schema that would be real is an employee register, and only if the owner moves those staff rows out of Finance. Payroll, leave, reviews, and recruitment were not found.

Company-wide Wolf membership can open HR. If HR later holds the service-charge register or compensation, that membership must not automatically read those rows. That would be a stricter rule than today’s HR matrix and needs approval. Until such rows exist, there is nothing confidential in the Wolf HR page.

## 10. The eight original decisions

The questions are copied from the architecture proposal. Recommendations are new. Approval is still required for each.

### 1. Approve `finance_records` and `hr_records` as label tables only, with no amounts and no compensation.

The proposal assumed empty modules. AMG establishes a ledger, subledgers, and reports. `finance_records` would discard that model.

Unknown: none about the source shape. Live data quality is still unknown.

Options: approve the label tables, reject both, or reject `finance_records` and postpone `hr_records`.

Recommendation: reject `finance_records`. Postpone `hr_records` until an HR workflow is approved. Security consequence of keeping the label table is a second, competing finance store. Blocking: any migration file for those label tables.

### 2. Confirm that Finance and HR business rows are always department-scoped, and that company-wide access stays on the membership.

Wolf module access is department-scoped, and company-wide access is a null membership department. AMG department codes are hotel cost centers on journal lines.

Options: force every journal line’s department through `departmentServesModule`, or keep Wolf’s finance department as the gate and store hotel departments beside it.

Recommendation: the second option. Using Wolf departments for USALI codes would hide the books from the finance module or explode the membership model. Company-wide membership would then see every hotel department’s finance data. That matches today’s Wolf rule and is wider than some AMG roles. Blocking: the table design’s foreign keys.

### 3. Confirm soft delete, `ON DELETE RESTRICT` for user attribution, and the absence of a retention period.

AMG journals are reversed, not deleted, once posted. Users are hard-deleted from the in-memory registry. Wolf has no retention schedule.

Options: soft-delete everything, follow AMG and forbid delete after post, or hard-delete drafts only.

Recommendation: drafts may be deleted by an administrator membership. Posted journals are reversed, never deleted. Attribution uses `ON DELETE RESTRICT`. Retention stays unresolved and nothing is purged. Blocking: journal delete behavior and user foreign keys.

### 4. Confirm that company-wide members may read HR labels, while compensation stays out of the schema until a separate grant exists.

Wolf company-wide membership can open HR. There are no HR labels stored. AMG service-charge math is compensation-adjacent and currently sits in Finance.

Options: allow company-wide read of future HR labels, or require a department membership for any person-related row.

Recommendation: do not add HR labels. Do not let company-wide membership, or ordinary finance staff, read service-charge staff amounts or owner-pool owner statements without an explicit extra grant. That extra grant is an authorization change. Blocking: service-charge and owner-pool exposure, and any future HR table.

### 5. Confirm that invoice, ledger, payroll, leave, performance, and recruitment work are out of the first implementation.

The ledger, spending invoices, and purchase orders are the AMG product. Payroll, leave, performance, and recruitment were not found.

Options: keep the original exclusion, or merge the ledger now and leave the absent HR products out.

Recommendation: the ledger, revenue, spending, inventory, tax, petty cash, and reports are in scope for the merger. Payroll, leave, performance, and recruitment stay out. Service charge and owner pool are in the product but wait on the sensitive-access decision. Blocking: the Finance implementation scope.

### 6. Confirm that Owner Private is not a store for Finance or HR fields.

AMG owner pool is a finance distribution workflow with emails and statements. Wolf Owner Private is a separate read-only grant.

Options: pour owner-pool rows into Owner Private, or keep them in Finance under an explicit grant.

Recommendation: keep them in Finance. Owner Private grants do not start approving distributions, and finance roles do not start reading Owner Private. Blocking: owner-pool route placement.

### 7. Approve the audit rule that titles and amounts are not written to metadata.

Wolf already rejects sensitive metadata keys and does not store record bodies. AMG history is the journal itself.

Options: copy amounts into audit metadata, or keep metadata structural and let the journal be the financial history.

Recommendation: metadata holds module, action, reason, company id, and resource id only. Amounts, account names, employee names, and statement text stay out. The financial audit trail is the journal status history. Blocking: the audit writer for finance mutations.

### 8. Choose whether `0004` and `0005` ship together or one module first.

`0004` and `0005` referred to label tables. Those files should not be the merger.

Options: ship HR and Finance together, or ship the finance ledger first and leave HR unscheduled.

Recommendation: one finance migration series after approval, in dependency order: operating departments and accounts, journals, then subledgers. No HR migration in that series. Blocking: the first migration file’s contents and order.

## 11. Milestones

The proposed sequence holds. Step 1 is done for source code. The live inventory was attempted and is blocked, as recorded in section 14.

1. Source model inspected at `3c9a1e12`. Live Sheets, Firebase, and runtime `system_state.json` remain unverified until the access in section 14 is provided.
2. Owner approves the decisions in section 10 and the role cutover.
3. Implement Finance inside Wolf behind the current module guard, without redirecting AMG users.
4. Replace AMG auth on the new routes with Wolf sessions. Do not weaken the matrix to match header trust.
5. Add the finance migrations in a reviewable series. Do not apply them to the local Wolf database until that review says so.
6. Dry-run load into an empty database from a snapshot of Sheets and the JSON files.
7. Reconcile trial balance, USALI statements, inventory valuation, tax control totals, service-charge cycles, and owner-pool statements against the source.
8. Run the access tests below.
9. Explicit cutover approval.
10. HR only after its own scope approval. It is not step 3.

AMG keeps serving until step 9. Rollback is to leave AMG writable and stop Wolf finance writes. Wolf tenant tables are not dropped as part of rollback.

## 12. Tests, backup, and cutover

Security and regression tests for the implementation phase, on an ephemeral database:

- Cross-company reads and writes denied.
- A non-finance department membership denied, including HR.
- Company-wide membership behavior matches the approved decision and does not reveal service-charge or owner-pool rows unless the extra grant exists.
- Staff cannot approve, post, reverse, or delete posted journals.
- Administrator cannot approve without an approve grant.
- Owner and administrator roles do not gain Owner Private.
- Header and body user ids do not select the actor.
- Unbalanced journals, cross-company account codes, and unknown operating departments fail constraints.
- Posted journals cannot be hard-deleted.
- Audit rows for allow and deny contain no amounts.
- Report CSV, XLSX, and PDF tests from AMG are ported.
- Dry-run totals match source trial balance and a sample of historical statements to the cent.

Backup before any later dry run: export the spreadsheet, copy the `data/` directory, and record the AMG commit. Wolf’s existing database is not the finance source and is not backed up by mutating it in this phase. Cutover is a config and DNS decision that is out of scope until step 9. No DNS or cloud change is proposed as an action now.

## 13. Risks still open

- Live Sheets may differ from git.
- Plaintext passwords in source must be rotated in AMG independently of this plan.
- Firestore rules are broad if that project is deployed, even though the app code did not read those collections.
- Actor names will not all map to Wolf users.
- Decimal conversion can change historical cents.
- Attachment bytes were not located.
- Wolf cannot represent AMG’s view-only roles without a new permission.
- `docs/data-foundation.md` still describes a non-transactional runner.

The safe next approval is still not a schema migration. It is the read-only access listed in section 14, plus a decision on the eight questions. Do not run `GoogleSheetsClient.initialize`, `GET /api/sheets/diagnostics`, or `POST /api/sheets/init` as the inventory method. Those paths can create tabs and write header rows.

## 14. Phase 3A.2 live dependency inventory

Inspected on 2026-10-23 against the same AMG commit, `3c9a1e12ebcb3132875aca6f446c9b88b6eb3452`, in the existing read-only clone. Wolf application code, schema, migrations, and the local database were not touched. The clone, its JSON files, and every external service were left unchanged.

### What was available

Committed configuration and code:

- `server.ts` calls `dotenv.config()` with no custom path, so a local `.env` beside the process would be loaded and would not override variables already set. The clone has `.env.example` only. There is no `.env` or `.env.local` in that tree.
- `.env.example` names `GEMINI_API_KEY`, `APP_URL`, `GOOGLE_PROJECT_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SPREADSHEET_ID`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, and `SMTP_PASS`. The example values are placeholders.
- `GoogleSheetsClient` reads only `GOOGLE_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and `GOOGLE_PRIVATE_KEY`. `GOOGLE_PROJECT_ID` appears in `.env.example` and in `DbStatusModal.tsx` copy. The sheets client does not read it.
- `GEMINI_API_KEY` and `APP_URL` are named in `.env.example` and `metadata.json` declares a server-side Gemini capability. No `process.env.GEMINI_API_KEY` or `process.env.APP_URL` use was found. No deployed host URL is committed. `APP_URL` in the example is the placeholder string.
- This shell did not have those Google, Gemini, SMTP, or application-default credential variables set.
- `gcloud` is installed and had no active account. Application-default credentials were absent. The Firebase CLI is not installed. Cursor’s Google Drive connection is not authenticated. None of those logins were started.

Live status for Sheets, Firebase, and runtime files is **unknown**. Absence of local credentials is not evidence that a deployment is disconnected.

### Sheets

Source behavior, not live state:

- Required tabs and columns are the six listed in section 3. `readTab` loads `A1:Z` on startup through `loadFromSheets`, which replaces the in-memory accounts, departments, journals, revenue, and spending.
- Mutations call `syncTabToSheets`, which `writeTab` implements as a clear of `A:Z` and a full rewrite with `USER_ENTERED`. That makes a connected sheet both the startup source and the write mirror for those six collections. If credentials are missing, the process keeps the in-memory seed and does not touch a sheet.
- `initialize` lists tabs, **creates any missing required tab**, and writes a header row when the first row is empty. `GET /api/sheets/diagnostics` calls `initialize` before it counts rows. `POST /api/sheets/init` does the same and can then seed accounts back into the sheet. Those routes are not a read-only inventory.
- The OAuth scope in code is `https://www.googleapis.com/auth/spreadsheets`, which includes writes. Formulas are not read. `values.get` returns calculated cell values, so a later inventory still needs a formula-aware read if cross-tab formulas exist.
- `IntegrationsView.tsx` shows a hardcoded spreadsheet id, `1xcAejEwYu7WHEtZ77IvB-OdYMX83nU5LxbQ4VsIGO-I`, and the title “Atrium Master Accounting Sheet”, only when diagnostics return no id. That is a display fallback. It was not opened. It is not evidence of `GOOGLE_SPREADSHEET_ID`.

No tab, header, row count, formula, or duplicate-key check was made against a live spreadsheet.

### Firebase

Source-code evidence:

- `firebase-applet-config.json` names project `organic-forklift-7lxdt`, auth domain `organic-forklift-7lxdt.firebaseapp.com`, storage bucket `organic-forklift-7lxdt.firebasestorage.app`, and Firestore database id `ai-studio-atriumfinance-e0b83289-c09f-4e6a-9fbf-0c039571fe6a`. API keys and other client secrets in that file are not copied here.
- `src/services/firebase.ts` initializes Auth and Firestore and exports a Google provider. `LoginScreen.tsx` can call `signInWithPopup`. The password check remains `POST /api/auth/verify-user`. `signInWithEmailAndPassword` is imported and is not the password check. The server does not verify a Firebase ID token. A client boolean `isGoogleOAuth` skips the plaintext comparison.
- `firestore.rules` allows any signed-in user to read and write `/roles/{roleId}` and `/users/{userId}`. `firebase-blueprint.json` describes `UserProfile` and `RoleDefinition` at those paths. Application code does not call Firestore `collection`, `getDoc`, `setDoc`, or `addDoc`. The exported Firestore handle is unused by those operations.

Live-project evidence: none. Provider list, user counts, and whether those collections contain documents are unresolved. The rules file is not proof that this database is deployed.

### Runtime `system_state.json`

Path resolution is `path.join(process.cwd(), 'data', 'system_state.json')`.

- Read: if the file parses and `mock_data_cleared` is true, the store sets that flag.
- Write: `resetMockData` writes `mock_data_cleared` and `cleared_at`.
- Delete: `seedDemoData` unlinks the file when it exists.

The clone has no `data/system_state.json`. No running process was inspected, so live presence, timestamp, and contents are unverified. The committed JSON files were not used as a substitute.

### Committed JSON snapshot, not production

These shapes are the files in git at the inspected commit. They are not a live inventory. Counts are collection lengths only. Row contents are not reproduced. Owner-pool units and service-charge employees include bank-account fields. Owner-email dispatches include recipient addresses. Those files are sensitive even as a git snapshot.

| File | Top-level keys | Counts in git |
| --- | --- | --- |
| `data/inventory.json` | categories, storerooms, items, movements, requisitions, purchaseOrders, receipts, countSessions, adjustments | 11 categories, 6 storerooms, 12 items, 12 movements, 1 requisition, and empty purchase orders, receipts, counts, and adjustments |
| `data/service_charge.json` | employees, collections, cycles, saved_at | 18 employees, 6 collections, 1 cycle |
| `data/owner_pool.json` | units, batches, stays, ruleConfig, ruleHistory, saved_at | 98 units, 1 batch, 2 stays, 1 rule history entry |
| `data/owner_email_store.json` | config, dispatches, savedDrafts, saved_at | 98 dispatches, no saved drafts |
| `data/petty_cash.json` | config, transactions, claims, saved_at | 3 transactions, no claims |
| `data/tax_module.json` | rules, obligations, closedPeriods when `persist()` runs | Not in git. In-code defaults apply until a runtime file exists. |

`arapStore.ts` keeps settlements and payments in memory and has no file.

### Authority map

| Domain | Storage in source | Read path | Write path | Live status | Authority | Migration concern |
| --- | --- | --- | --- | --- | --- | --- |
| Six accounting tabs | Env-selected spreadsheet, else process memory | `loadFromSheets` / `readTab` when connected; otherwise the in-memory seed | `syncTabToSheets` clears and rewrites the tab when connected | Unknown. Credentials were not present here. | Connected sheet wins on startup and is then overwritten on each sync. Disconnected memory is the only store. | Do not inventory through `initialize`. Confirm the real spreadsheet id out of band. Money is `parseFloat`. |
| Inventory | `data/inventory.json` | Store constructor reads cwd file | `writeFileSync` on change | Git copy verified. Running host unknown. | The process file, if that host is production. Git may be stale. | Stock costs and names. |
| Service charge | `data/service_charge.json` | Same pattern | Same pattern | Git copy verified. Running host unknown. | Same | Staff identity, bank fields, and payout amounts. |
| Owner pool | `data/owner_pool.json` | Same pattern | Same pattern | Git copy verified. Running host unknown. | Same | Owner identity, bank fields, contract amounts. |
| Owner email | `data/owner_email_store.json` | Same pattern | Same pattern | Git copy verified. Running host unknown. | Same | Recipient addresses and dispatch history. SMTP secrets are env vars, not this file’s documented role. |
| Petty cash | `data/petty_cash.json` | Same pattern | Same pattern | Git copy verified. Running host unknown. | Same | Voucher amounts and payee names. |
| Tax | `data/tax_module.json` plus `DEFAULT_TAX_RULES` | Overlay file onto defaults | `persist()` writes rules, obligations, closed periods | Runtime file unknown. Absent from git. | Code defaults until a file exists, then the file overlays them. | Do not assume the git tree is the tax configuration in production. |
| Access-control users and roles | In-memory seed in `server/store.ts` | Process memory | Access-control routes mutate memory only | Live user list unknown. | The running process. Git seed is a fallback picture, not a sync target. | Passwords in source are plaintext and must not be migrated. |
| `system_state.json` | cwd `data/` | `mock_data_cleared` only | Mock reset / demo reseed | Unknown. Absent from the clone. | A flag for demo data, not a ledger or identity store. | Do not import users from it. |
| Firebase Authentication | Client config project above | `signInWithPopup` in the browser | Client sign-in only. Server trusts `isGoogleOAuth`. | Unknown | Not the ledger. Not a verified user directory. | Do not copy Auth users until a read-only project view exists. Do not accept the client flag as proof. |
| Firestore `/users` and `/roles` | Rules and blueprint only | No application read found | No application write found | Unknown | Unresolved. Rules would be wide if deployed. | Confirm emptiness or contents before ignoring it. Do not export user documents into git. |

### Access still required

Provide these without pasting private keys, tokens, or row contents into the repository:

1. The production `GOOGLE_SPREADSHEET_ID` confirmed by the operator, and a Google identity granted `spreadsheets.readonly` on that file. The inventory must use a metadata and values read that does not call `initialize`.
2. Read-only visibility of Firebase project `organic-forklift-7lxdt`: enabled products, Auth providers, and whether Firestore database `ai-studio-atriumfinance-e0b83289-c09f-4e6a-9fbf-0c039571fe6a` contains `/users` or `/roles`. No user export.
3. From the host that actually runs AMG, a statement of whether `data/system_state.json` and `data/tax_module.json` exist, their modification times, and top-level keys only.
4. Confirmation of which directory is production `data/`, so the committed JSON files are not treated as the books.

Until that access exists, schema implementation and data migration stay blocked. The eight owner decisions in the architecture note are unchanged. The four confirmed product decisions are recorded there and are not part of those eight questions. Section 15 is the operator procedure for the access listed above. Section 16 is the readiness gates. None of them were executed in this phase.

## 15. Phase 3A.4 evidence package

Checked again on 2026-10-23. The AMG clone is still `3c9a1e12ebcb3132875aca6f446c9b88b6eb3452` and was not modified. This workspace still has no `GOOGLE_SPREADSHEET_ID`, service-account variables, `GOOGLE_APPLICATION_CREDENTIALS`, or `FIREBASE_TOKEN`. No spreadsheet, Firebase project, or production host was contacted. Missing access is not evidence that a resource is empty or disconnected.

The display fallback id in `IntegrationsView.tsx` is not a production identifier and is not an input to the procedure below.

### A. Google Sheets checklist

Stop here until an authorized operator does both of the following in writing, outside this repository:

- Names the production spreadsheet id and states that this file is the one to inspect.
- Confirms an existing identity already has `https://www.googleapis.com/auth/spreadsheets.readonly` on that file.

Do not grant the full `spreadsheets` scope. Do not reuse the application service account for this inventory, because its code scope can create tabs and clear ranges. Do not call `GoogleSheetsClient.initialize`, `GET /api/sheets/diagnostics`, `POST /api/sheets/init`, `syncTabToSheets`, or `writeTab`.

When that access exists, the inventory is metadata and aggregates only:

1. `spreadsheets.get` with `fields=spreadsheetId,properties.title,sheets.properties(title,sheetId,gridProperties(rowCount,columnCount))`. Record the title and tab names. Grid row count includes empty rows, so it is only a ceiling.
2. For each tab, `values.get` on `A1:Z1` only. Record header cells. These are column names, not business rows.
3. Count body rows locally and report the count. Do not paste the value range. A practical count is the length of column A after the header, computed on the operator’s machine.
4. Request formula cells with `includeGridData=true` and field mask `sheets.properties.title,sheets.data.rowData.values.userEnteredValue.formulaValue`. Report the count of formula cells per tab, and whether any formula text contains `!`. Redact literals and do not paste formula bodies into git.
5. Compare live tab names and headers with `REQUIRED_TABS` in `server/sheets.ts`. A missing tab is a finding. It does not authorize creating the tab.

Source-derived sync behavior, verified in code on this date and not observed on a live sheet:

- Startup read, only when the three credential variables are set: `store.init` calls `loadFromSheets`, which reads all six tabs and replaces accounts, departments, journal headers, journal lines, revenue, and spending.
- Later writes, same condition: `syncTabToSheets` calls `writeTab`, which clears `A:Z` and rewrites the tab with `USER_ENTERED`. Account, department, journal, revenue, and spending mutations call that sync.
- If credentials are absent, those six collections stay in process memory and the sheet is not touched.

That code path is bidirectional when connected: the sheet supplies the process at startup, and the process then replaces each tab it syncs. After startup, memory is the writer and the sheet is the replaced copy that will be read again on the next boot. It is not a one-way archive. Whether production is connected remains unresolved.

### B. Firebase checklist

Stop here. No authorized read-only account is available in this workspace. Do not run `gcloud auth login`, `firebase login`, or any command that prints an access token.

The committed names to test, without treating them as proof that the project exists, are project `organic-forklift-7lxdt` and Firestore database `ai-studio-atriumfinance-e0b83289-c09f-4e6a-9fbf-0c039571fe6a`.

An operator who already has viewer access may run only these read-only commands and paste statuses, not credentials:

```bash
gcloud projects describe organic-forklift-7lxdt --format='value(projectId,lifecycleState)'
gcloud services list --enabled --project=organic-forklift-7lxdt --filter='config.name:(firestore.googleapis.com OR identitytoolkit.googleapis.com OR firebase.googleapis.com OR firebasestorage.googleapis.com)' --format='value(config.name)'
gcloud firestore databases list --project=organic-forklift-7lxdt --format='table(name,type,locationId)'
```

If Identity Platform is enabled, describe the config and report only the configured provider ids. Do not list users.

Collection evidence, if the database exists:

- `listCollectionIds` may be used. It returns names, not documents.
- A count aggregation may be used. Report the number only.
- Do not `get`, `list`, or export documents in `/users`, `/roles`, or any other collection.

Rules: download the deployed ruleset and compare it with `firestore.rules`. Do not publish or edit rules. If the deployed rules match the file, any signed-in user can read and write `/users` and `/roles`. That implication applies only if the download shows those rules are active.

Runtime use: the inspected commit initializes Firestore and never calls `collection`, `getDoc`, `setDoc`, or `addDoc`. That does not prove a deployed bundle is the same commit. The operator should record the revision the host is running. If it is not `3c9a1e12ebcb3132875aca6f446c9b88b6eb3452`, the Firestore conclusion stays open until that revision is inspected.

These commands were not run.

### C. Production host checklist

These commands are for the authorized operator on the host that actually runs AMG. They were not run. Do not point them at the git clone or at this Wolf workspace. Do not copy files into Wolf. Do not print file contents, environment values, or command lines that contain secrets.

Find the process working directory and report the pid and the cwd path only:

```bash
ps -eo pid,args | awk '/server\.ts|tsx server/ && !/awk/ {print $1}'
# For one pid from that list, on Linux:
readlink -f /proc/PID/cwd
# On macOS:
lsof -a -p PID -d cwd -Fn | awk '/^n/ {print substr($0,2)}'
```

Then set `AMG_REVIEW_CWD` to that path and review this script before running it. It prints existence, absolute path, size, modification time, and JSON types. It does not print scalar values.

```bash
AMG_REVIEW_CWD="/absolute/cwd/from/the/step/above" python3 << 'PY'
import json, os, datetime
cwd = os.environ["AMG_REVIEW_CWD"]
data = os.path.join(cwd, "data")
print("cwd_exists", os.path.isdir(cwd))
print("data_dir", os.path.abspath(data))
print("data_dir_exists", os.path.isdir(data))
names = [
    "system_state.json",
    "tax_module.json",
    "inventory.json",
    "service_charge.json",
    "owner_pool.json",
    "owner_email_store.json",
    "petty_cash.json",
]
def shape(value, depth=0):
    if isinstance(value, dict):
        parts = []
        for key in sorted(value):
            child = value[key]
            if isinstance(child, list):
                parts.append(f"{key}:list:{len(child)}")
            elif isinstance(child, dict):
                parts.append(f"{key}:object:{len(child)}")
            else:
                parts.append(f"{key}:{type(child).__name__}")
        return "{" + ",".join(parts) + "}"
    if isinstance(value, list):
        return f"list:{len(value)}"
    return type(value).__name__
for name in names:
    path = os.path.join(data, name)
    exists = os.path.isfile(path)
    print("file", name, "exists", exists)
    if not exists:
        continue
    st = os.stat(path)
    stamp = datetime.datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds")
    print("path", os.path.abspath(path))
    print("bytes", st.st_size)
    print("modified", stamp)
    try:
        with open(path, "r", encoding="utf-8") as handle:
            parsed = json.load(handle)
        print("shape", shape(parsed))
    except Exception as exc:
        print("shape", "unreadable", type(exc).__name__)
PY
```

`system_state.json` in source is only the mock-data flag. `tax_module.json` is optional and, when present, is expected to contain `rules`, `obligations`, and `closedPeriods`. A missing file on the host means that host has no such file. It does not mean no other host has one.

`systemSettings` in `server/store.ts` is a separate in-memory object. The code default sets `base_currency` to `IDR`. `POST /api/admin/settings` replaces that object in memory and does not write a JSON file. A restart returns to the code default unless a newer revision adds persistence. Live settings were not read.

Report formatting defaults in `DEFAULT_MASTER_REPORT_CONFIG` use currency code `IDR`, symbol `Rp`, and `decimal_places` 0. Sheet loads still use `parseFloat` for debit, credit, and amount. Those are source defaults, not a sample of production amounts.

### D. Data-authority matrix

Live existence stays unknown unless the status column says the git snapshot was read. Authority for every live domain stays unresolved. Section 14 remains the 3A.2 note. This table is the 3A.4 classification.

| Source | Type | Code read / write | Live status on 2026-10-23 | Authority | Sensitivity | Duplication | Migration and rollback | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Six accounting tabs | Spreadsheet, optional | Read all six at startup via `loadFromSheets`. Write by clearing and replacing the tab via `syncTabToSheets`. | Not accessible. Production id not confirmed. | Unresolved. Code model is bidirectional when credentials exist, and memory-only when they do not. | Amounts, names, vendor or employee text. | Memory and sheet can diverge if a write reaches only one side. Git has no sheet export. | Import from a frozen export. Leave the sheet writable in AMG until cutover approval. Rollback stops Wolf writes and does not delete the sheet. | `server/sheets.ts`, `server/store.ts`. Live check not run. |
| Inventory, service charge, owner pool, owner email, petty cash | JSON files under `process.cwd()/data` | Each store reads its file in the constructor and writes it on change. | Git snapshot only. Production directory unknown. | Unresolved for production. The running process file would be authoritative for that host. | Owner pool and service charge include bank fields. Owner email includes recipients. Inventory and petty cash include names and amounts. | Git copies can be older or newer than the host. No second live store was verified. | Copy the host `data/` directory to offline storage before a dry run. Do not commit it. Rollback keeps that directory as AMG’s store. | Store classes. Git shapes in section 14. Host script not run. |
| Tax | Code defaults plus optional `tax_module.json` | `init` loads defaults, then overlays `rules`, `obligations`, and `closedPeriods`. `persist` writes those keys. | File absent from git. Host unknown. | Unresolved. Defaults apply only when no file is loaded. | Tax rates, filing notes, possible attachment names. | A host file overrides the code defaults and can disagree with git. | Do not seed Wolf from `DEFAULT_TAX_RULES` and call it production. Rollback keeps the host file. | `server/taxStore.ts`. |
| `system_state.json` | JSON flag | Read `mock_data_cleared`. Write that flag and `cleared_at` on mock reset. Delete on demo reseed. | Absent from the clone. Host unknown. | Not a ledger and not an identity store, if the running code is this commit. | Low if the file matches the writer. Unverified if a host file has extra keys. | None with the user list. | Do not import users from it. Extra keys, if a host file has them, stop the import and report the key names. | `server/store.ts` lines for `stateFile`. |
| Users and roles | Process memory, seeded in source | `initDefaultAccessControl` and access-control routes. No user file write was found. | Live list unknown. | The running process. Git seed is not a sync target. | Plaintext passwords in source. Names and emails. | Seed, a running process, Firebase Auth, and Firestore can each hold a different list. | Provision Wolf users separately. Do not copy passwords. Leave AMG login up until cutover. | `server/store.ts`. Firebase use unresolved. |
| Hotel profile, currency, period lock | Process memory | Defaults in `systemSettings`. `POST /api/admin/settings` overwrites memory only. | Not read. | Code default after every restart, unless the deployed revision differs. | Property name and a controller display name. | Can disagree with report formatting and with any host notes. | Capture the operator’s current settings out of band before migration. Do not scrape `/api/status`, because that response includes the spreadsheet id and service-account email. | `server/store.ts`, `server.ts`. |
| Report formatting | In-memory default | `DEFAULT_MASTER_REPORT_CONFIG` | Not read. | Source default is IDR, prefix `Rp`, zero decimal places. | Low. | Display scale can disagree with `parseFloat` storage. | Approve an exact numeric scale before import. `numeric(20,2)` in section 6 is still a proposal. | `src/types.ts`. |
| Firebase Authentication | Client project config | Google popup, then `verify-user` with a client `isGoogleOAuth` flag. No server token check. | Project not accessed. | Not the ledger. Not a verified directory. | Account identifiers if users exist. | Can diverge from the in-memory seed. | Do not migrate Auth users until the checklist in section 15.B returns. | `src/services/firebase.ts`, `LoginScreen.tsx`. |
| Firestore `/users` and `/roles` | Rules and blueprint | No application read or write in this commit. | Database not accessed. | Unresolved. | User profiles if documents exist. | Could be a second user directory if a deployment writes it. | No copy until a name-only collection list and counts exist. Do not export documents. | `firestore.rules`, `firebase-blueprint.json`. |
| SMTP and PMS audit | External | Owner-pool mail via Nodemailer. `POST /api/integrations/pms-audit` ingests a body. | Not contacted. | Unresolved. Secrets stay in env. | Mail recipients and night-audit payloads. | PMS batches become revenue journals when accepted. | Do not store SMTP secrets in PostgreSQL. Re-specify the PMS contract before enabling it in Wolf. | `ownerEmailStore.ts`, `server.ts`. |
| AR and AP aging | Process memory | `arapStore.ts` derives items and keeps settlements in maps. No JSON file. | Lost on restart unless recreated from journals. | Derived from the ledger path. | Customer and vendor names, amounts. | Can diverge from journals if the process restarts. | Rebuild from the migrated journals. Do not treat memory as a second book. | `server/arapStore.ts`. |

## 16. Migration-readiness gates

These gates are not implemented and are not approved. All nine are open on 2026-10-23.

1. Live source inventory is complete, or every remaining blocker is explicitly accepted. Status: open. Sheets, Firebase, and the production `data/` directory are blocked. The checklists in section 15 are the remaining work. Accepting a blocker is an owner decision and has not been given.
2. Source-of-truth rules are approved for every domain in the matrix. Status: open. The code model is documented. No owner has assigned authority for the connected-sheet case, the JSON host files, tax defaults versus `tax_module.json`, or Firestore.
3. Monetary precision, currency handling, and accounting invariants are specified. Status: open as an approved spec. Source defaults are IDR and zero display decimals. Loads use `parseFloat`. The proposed column type remains `numeric(20,2)` in section 6. Journal balance, period lock, and reversal behavior still need an approved invariant list before import tests are written.
4. Tenant ownership and cross-company references are defined. Status: open. The product frame says shared PostgreSQL with tenant isolation, and the proposal puts `company_id` on finance tables. The Wolf company that receives these books is not chosen. Hotel `department_code` stays an accounting dimension, not a Wolf department. No cross-company finance reference is allowed in the proposal. That rule is not approved.
5. Authentication cutover and user identity mapping are approved. Status: open. Section 5 is a recommendation. Plaintext passwords are not migrated. The client Google flag is not trusted. Role mapping for cashier, purchasing, manager, and auditor is deferred because Wolf cannot express those limits yet.
6. Data import and reconciliation are repeatable and testable. Status: open. No dry-run loader exists. A future loader must be runnable twice against an empty isolated database without duplicating source ids, and must compare trial balance and historical statements to the cent. It must not read the local Wolf database.
7. Rollback can restore service without destroying the original source. Status: open as a design, not as a tested procedure. AMG, its sheet, and its host `data/` directory stay in place and writable until a separate cutover approval. Wolf finance writes stop on rollback. Wolf tenant tables are not dropped as the rollback. This has not been rehearsed.
8. An authorized owner explicitly approves schema implementation. Status: not given. This phase does not grant it.
9. A separate authorized owner explicitly approves production cutover. Status: not given. Gate 8 does not imply gate 9.

The eight original questions in section 10 stay open and are copied here only as a pointer. Their wording lives in `docs/phase-3-finance-hr-architecture.md` and is not rewritten. The four product decisions in that file stay as written.

No schema file, migration, application change, spreadsheet edit, Firebase change, JSON edit, or local Wolf database connection was made for this package.
