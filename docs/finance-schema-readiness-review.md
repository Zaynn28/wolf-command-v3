# Finance schema readiness review

Phase 3C review of [docs/finance-domain-specification.md](finance-domain-specification.md). It does not approve a schema, a migration, or production cutover.

Labels: **verified** means checked in Wolf source or in AMG commit `3c9a1e12ebcb3132875aca6f446c9b88b6eb3452` for this review. **Previously reported** means carried from the merger plan and not re-opened against a live system. **Proposed** means a design awaiting approval. **Unresolved** means an owner, an accountant, or production evidence is still required.

The four confirmed product decisions stay as written in the domain specification. The eight owner decisions in [docs/phase-3-finance-hr-architecture.md](phase-3-finance-hr-architecture.md) stay open and unchanged. Completing Phase 3B did not approve them.

## 1. Executive assessment

**No-go for implementation.**

The ledger shape is coherent enough for an owner to review: company-scoped accounts, periods, journals, and lines, with composite foreign keys, and hotel workflows kept behind a closed module list. That shape is not ready to become tables.

Blocking gaps:

- Posted-balance equality, rounding, currency scale, reversal, and period reopen are not approved. AMG’s own balance check is a floating-point epsilon, not exact equality.
- Open decision 2 still asks whether every Finance row is department-scoped. The specification proposes company scope for the chart and journals. Those two statements are not reconciled.
- Open decisions 3 and 7 still govern retention and what audit metadata may hold. The current sanitizer does not reject amount or title keys.
- No production source of truth has been verified for Sheets, Firebase, or the host `data/` directory.
- There is no implemented operator role for private company creation. The provision command can insert a company without an administrator session.
- Row-level security is off. It is not required for a first migration unless an owner says so. Application checks and foreign keys would be the only isolation if a schema were approved now.

Hotel inventory, service charge, owner pool, owner email, petty cash, and tax tables are out of the first business schema. They stay company modules until their sensitive-access grant exists and their live files are identified.

No Finance business tables were created. No schema or migration was implemented. No database connection or write was performed. No production data was accessed. Owner schema approval is still required. Production cutover approval is still separate and required.

## 2. Current architecture and gaps

**Verified.** `/finance` and `/hr` render `AccessPanel`. Module open and the records request set `persisted: false`. There is no Finance or HR business table.

**Verified.** `authorize()` allows read, create, update, and delete from a membership. `departmentId: null` covers every department in that company. Approve and Owner Private require explicit grants. Administrator and owner roles do not imply those grants. Finance read, create, and update use a membership whose department is `finance` or ends in `-finance`. Delete uses an administrator or owner membership. Approve uses an approve grant.

**Verified.** `companies` and `departments` use `ON DELETE RESTRICT`. Department identity is `(company_id, id)`. Membership and grant department foreign keys are composite. `0003` states that row-level security stays disabled. `migrate.ts` applies the schema files inside one `sql.begin`. The application database role is the table owner, so ordinary row-level security would not apply to it.

**Verified.** No public registration route was found. `provisionAccount` calls `ensureTenant` when a company id is supplied. The provision command requires `WOLF_ALLOW_ACCOUNT_PROVISION=1` and the local database guard. It does not call `authorizeProvisioning`.

**Verified in AMG.** Journal status is `DRAFT`, `VALIDATED`, `APPROVED`, `POSTED`, or `REVERSED`. Validation refuses a journal unless `is_balanced` is true. That flag is `Math.abs(total_debit - total_credit) < 0.0001` and `total_debit > 0`. The error text says debits must strictly equal credits. The comparison is not exact. Other report checks use `0.01` and `0.05`. Sheet amounts are loaded with `parseFloat`. Currency defaults in code are IDR and zero display decimals. A connected sheet replaces the six accounting collections at startup and later syncs clear and rewrite the tab.

**Previously reported.** Live spreadsheet id, Firebase deployment, and production JSON paths are unknown. Git JSON is not production input. `system_state.json` in this commit stores a mock-data flag, not users.

**Gap.** The architecture note said audit metadata does not store amounts. The sanitizer blocks keys matching credential, salary, and private patterns. It does not name amount or title. That sentence was corrected in the architecture note.

## 3. Entity readiness matrix

First-release candidates are the shared ledger only. Illustrative fields are not SQL.

| Entity | First release | Ownership | Identity and links | Constraints | Money and lifecycle | Authorization | Audit, delete, migration | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Finance settings | Yes, one row per company that uses Finance | Company only. Not a Wolf department. | One row per `company_id` | Currency code and scale required before post | Holds the scale used by every amount | Finance administrator membership to change. Read with finance membership. | Audit the change. No production currency sample. | Blocked. Scale and code are unresolved. |
| Accounting period | Yes | Company only | Unique `(company_id, period_key)` | A journal references a period in the same company | Lock blocks post and reversal | Approve grant to lock. Reopen is unresolved. | Do not delete a period that has journals. AMG lock date is memory only. | Blocked. Close and reopen policy is unresolved. |
| Account | Yes | Company only | Unique `(company_id, account_code)` | Deactivate instead of delete when lines exist | No amount on the account | Read: finance membership. Change: administrator membership. | Structural audit. Sheet or memory chart is unverified live. | Blocked on decision 2. The company-only shape is ready for review. |
| Operating department | Pilot dimension, not a platform default | Company only. Not `departments`. | Unique `(company_id, code)` | Lines reference the same company | None | Same as accounts | AMG department tab. Live tab unverified. | Ready for review as a pilot dimension. Not required for a non-hotel company. |
| Journal | Yes | Company. Wolf finance department is the access gate, not a required column. | Unique `(company_id, source_journal_id)` | Status lifecycle proposed, not approved | Posts only when debits equal credits at the approved scale | Draft: finance membership. Approve, post, reverse: approve grant. Delete of posted rows: no. | Actor ids from the session. Source names kept as labels. Sheet header unverified live. | Blocked. Balance, immutability, and decision 2 are open. |
| Journal line | Yes | Company, checked with the journal | Composite foreign keys to journal, account, and operating department on `company_id` | One-sided amount rule is unresolved | Stored with the company scale. No binary float. | Same as the journal | Deleted only with a draft, and draft deletion is decision 3. | Blocked with the journal. |
| Source document | Pilot only | Company, optional operating department | Unique `(company_id, document_id)` | Must point at a same-company journal when posted | Amount uses the same scale | Finance membership plus the module flag | Revenue and spending tabs. Live unverified. | Out of the first platform schema. Blocked for the pilot until the sheet is verified. |
| Module configuration | Yes, if any optional module can be turned on | Company | Unique `(company_id, module_key)` from a closed list | Disabling stops new writes and keeps history | None | Who may enable a module is unresolved | No AMG equivalent. | Blocked. The closed list is ready for review. |
| Approval action | Yes, as history of approve, post, and reverse | Company | References the journal in the same company | Written only after `authorize()` allows approve | Does not copy amounts if decision 7 stands | Approve grant | Retain with the journal. Retention period unresolved. | Blocked on decision 3 and 7. The grant check itself is verified. |
| Audit event | Already exists | Optional company | Existing resource-type and resource-id pair | Do not add a second audit table | Must not gain amount columns | Server writers only | Decision 7 is open. Current sanitizer is narrower than that decision. | Ready as the existing table. Finance payload rules are blocked. |
| Attachment, reconciliation | No | Company if ever added | Not specified | Not specified | Not specified | Parent read rule | Bytes were not located. AMG reconciliation is module-specific, not one ledger entity. | Out of scope |
| Inventory, service charge, owner pool, owner email, petty cash, tax | No | Company modules | Not in the first schema | Sensitive staff and bank fields need a grant Wolf does not have | Exact totals later | Finance membership is too wide | Git JSON is not approved production data | Out of scope |
| `finance_records`, `hr_records`, payroll, HR | No | — | — | — | — | — | Open decisions 1, 4, and 5 | Out of scope |

## 4. Accounting decision register

None of these are approved. No numerical tolerance is recommended.

| # | Decision | Options | Consequences | Proposal | Evidence | Approver | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Monetary storage | `numeric`, or integer minor units | `numeric` keeps a visible scale. Integers need one fixed scale. | `numeric`, with decimal arithmetic in application code | AMG uses `parseFloat` | Accountant and owner | Blocked |
| 2 | Currency and scale | One company currency with a stored scale, or a global two-decimal assumption | A global scale of 2 misstates a zero-decimal currency | Per-company code and scale. Do not assume 2. | Code default IDR and `decimal_places` 0. Live value unknown. | Accountant and owner | Blocked |
| 3 | Rounding and display | Round only at posting, or also while reporting | Two stored totals will not reconcile | Store the posted value. Display scale may differ only when labeled as display. | AMG rounds some report totals to cents with `Math.round` | Accountant | Blocked |
| 4 | Multi-currency | Single currency per company, or rates and history | Mixed lines need a conversion record Wolf does not have | Reject mixed currencies in one journal until a design is approved | No verified production multi-currency sample | Accountant and owner | Blocked |
| 5 | Balancing | Exact equality, or an epsilon | An epsilon hides float error and can post a real difference | Exact equality at the company scale. Drafts may be unbalanced. | AMG validates with epsilon `0.0001` and requires a positive debit total. The message says “strictly equal.” | Accountant | Blocked |
| 6 | Posted immutability | Freeze posted lines, or allow edits | Edits destroy the audit trail | Posted lines do not change. Corrections are new journals. | Status enum includes `POSTED`. Line-level immutability was not fully re-audited. | Accountant and owner | Blocked |
| 7 | Reversal | New linked journal that swaps sides, or a negative edit | A negative edit is an edit of history | New journal, link to the original, original becomes `REVERSED` only through that path | Status `REVERSED` exists. Full reversal procedure was not re-audited in this pass. | Accountant | Blocked |
| 8 | Period close | Lock with no reopen, or reopen with an approve grant | Reopen allows backdated posts | Lock blocks post and reversal. Reopen is not assumed. | AMG `period_lock_date` is in memory and is not persisted | Accountant and owner | Blocked |
| 9 | Duplicates | Unique source ids per company, plus an idempotency key on import | Replay creates a second set of books | Unique `(company_id, source id)`. Import of the same id is a no-op or a conflict, not a second insert. | Proposed. Live duplicates unknown. | Owner | Blocked |
| 10 | Tax rounding | Company tax module later, or in the first ledger | Tax defaults in code may not be production | No tax tables in the first schema. No tax tolerance. | `tax_module.json` absent from git. Defaults exist in code. | Accountant | Blocked |
| 11 | Company versus department | Company-owned books with an operating-department dimension, or a Wolf department on every row | Decision 2 asked for department scope on every business row. Hotel codes are not Wolf departments. | Company scope for settings, periods, accounts, and journals. Operating department on lines. Wolf department remains the access gate. | `departmentServesModule` only accepts `finance` or `*-finance` | Owner. This is open decision 2. | Blocked |
| 12 | Module enablement | Operator only, or company administrator | A company administrator could turn on owner-pool data for every finance member | Closed key list. Enabling role unresolved. Sensitive modules stay off until a narrower grant exists. | No module registry in Wolf or AMG | Owner | Blocked |
| 13 | Deletion and retention | Soft delete, restrict, or a named retention period | Decision 3 is open. Posted history should not be hard-deleted in any of the options under review. | Restrict deletes of posted journals and of users who approved them. Draft deletion and retention period wait on decision 3. | Existing tenant foreign keys are `ON DELETE RESTRICT` | Owner. Decision 3. | Blocked |
| 14 | Reconciliation | Exact equality, or an approved tolerance | AMG epsilons are `0.0001`, `0.01`, and `0.05` in different checks | Posted debit and credit totals, journal counts, and line counts require exact equality after the scale is chosen. No tolerance is set. | Those epsilons are in `server/store.ts` | Accountant | Blocked |

## 5. Tenant isolation and row-level security

**Verified controls today.**

- Session cookie, then database memberships and grants.
- `authorize()` denies the wrong company and a department outside the membership.
- Composite department foreign keys keep a membership in its company.
- Finance and HR pages do not return stored rows.

**Remaining risks.**

- A missed `company_id` predicate in a future query returns another company’s rows. The database will not stop it.
- The provision command can create a company without an operator session.
- Company-wide membership opens every department module, including Finance and HR.
- Queued jobs do not exist yet. A future job that trusts a client company id would bypass the session.
- Audit company id is omitted on some denials so an unknown company does not fail the foreign key. That is intentional and must not be copied onto finance inserts.

**Proposed, not enabled.** Row-level security is not part of the first Finance migration unless an owner explicitly adds it. If it is added later:

- Use a runtime role that does not own the tables and does not have `BYPASSRLS`.
- Enable and force row-level security on finance tables.
- Set a transaction-local company id only after the session is verified. Reset it before the connection returns to the pool.
- Missing or malformed context returns no rows and inserts nothing.
- Policies cover select, insert, update, and delete.
- Jobs use a server identity and an assigned company, not a payload field.
- Composite foreign keys remain, so a line cannot point at another company’s account even if a policy is wrong.

**Drift test.** For each fixture, call `authorize()` and run the same read or write as the runtime role. The policy result must match the function. Cases include another company, a non-finance department, a company-wide member, an administrator without an approve grant, and Owner Private without a grant. A difference fails the test. Policies do not become a second matrix. `authorize()` stays the source of the decision. This phase did not create roles or policies.

## 6. AMG migration readiness

Schema approval does not approve cutover. No live system was contacted.

| Source | Source establishes | Production unverified | Target | Transformation | Reconcile and rollback | Blocker |
| --- | --- | --- | --- | --- | --- | --- |
| Six accounting tabs | Startup read and later full-tab rewrite when credentials exist | Spreadsheet id and whether it is connected | Accounts, operating departments, journals, lines, source documents | Replace `parseFloat` with exact decimal text. Do not import the `0.0001` epsilon as policy. | Exact posted totals after scale approval. Leave the sheet in place. | No confirmed spreadsheet |
| Inventory, service charge, owner pool, owner email, petty cash JSON | File paths and git shapes | Host directory and whether git matches it | Later company modules | Drop bank fields from any shared finance read. No SMTP secrets. | Exact counts and totals. Keep the host files. | Not first schema. Live files unknown. |
| Tax | Code defaults. Optional overlay file. | Host file | Later tax module | Do not load defaults as production | No tax tolerance | File absent from git |
| Users and roles | In-memory seed. Plaintext compare. Client Google flag. | Running user list | Wolf users | No password copy. Reset through Wolf provision. | Identity match on normalized email | Live list unknown |
| Hotel settings | Memory defaults, including IDR | Running values | Finance settings | Capture out of band | Currency code must match the books | Not persisted |
| `system_state.json` | Mock-data flag only in this commit | Host file | No user import | Stop on unexpected keys | None | Host unknown |
| Firebase Auth and Firestore | Client init. No Firestore read or write in this commit. Permissive rules in the file. | Project, providers, documents, deployed revision | No copy | Re-enroll in Wolf | Do not export users | Project not accessed |

Rollback remains: stop Wolf finance writes, leave AMG and its stores writable, and do not drop Wolf tenant tables. That path is not rehearsed.

## 7. Approvals and blockers

Still required before any migration file:

- Owner answers on decisions 2, 3, 7, and 8, or a written statement that the first ledger may proceed company-scoped while those questions stay open for HR and retention.
- Accountant answers on decisions 1, 2, 3, 5, 6, 7, 8, and 14 in section 4.
- A named Wolf company for the AMG pilot, created only through an approved operator path.
- Confirmation that hotel modules are excluded from the first migration.
- Explicit schema approval, separate from cutover approval.

Still required before cutover, and not sufficient for schema approval:

- Read-only production inventory from merger-plan section 15.
- An approved source of truth for each domain.
- A rehearsal against an empty isolated database.
- Exact reconciliation of counts and posted totals.
- A separate cutover approval.

The eight original questions remain open. They are not repeated here so their wording stays only in the architecture note.

## 8. Next phase and go criteria

The next safe step is an owner and accountant review of section 4 and of open decisions 2, 3, and 7. It is not a migration.

Go for a later implementation phase requires all of the following:

- Written schema approval.
- A chosen currency code and scale for the pilot.
- Exact balance and exact reconciliation, or an accountant-signed exception that names the comparison.
- Posted immutability and reversal linkage accepted.
- Period lock behavior accepted, including whether reopen exists.
- Company versus department ownership accepted against decision 2.
- Draft deletion and retention accepted against decision 3.
- Audit metadata limits accepted against decision 7.
- First migration limited to settings, periods, accounts, journals, lines, approval history, and, for the pilot only, operating departments.
- Hotel subledgers excluded.
- Row-level security either explicitly deferred or specified with a non-owner role. It is deferred in this review.
- No use of the local Wolf database until that implementation phase is separately approved.

This review does not meet those criteria.

No Finance business tables were created. No schema or migration was implemented. No database connection or write was performed. No production data was accessed. Owner schema approval is still required. Production cutover approval is still separate and required.
