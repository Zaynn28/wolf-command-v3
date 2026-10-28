# BZG Finance gap analysis

Scope: company `bzg` only. This is the Prompt 0 deliverable. `docs/FNB_ERP_SPEC.md` and `.cursor/rules/fnb-erp.mdc` are now in the repo. Sections 3, 4, 5, and 10 were read. No application code, migration, or seed was changed. Phase 1 was not started.

Inventory, recipes, POS backflush, menu engineering, and banquet work are outside this BZG finance pass. Spec section 6 names logical accounts (Inventory, GR/IR, Cash, PB1 payable, and the rest). Those names are not BZG account codes and were not written onto the mapping. The confirmed revenue debit stays `1020`.

Row counts below are the 26 October 2026 read of `127.0.0.1:5433/wolf_command`. This refresh did not open the database. Port 5432 was not used. Row-level security was off: no public table had `relrowsecurity` enabled.

## 1. Stack

| Area | What is in this repo |
| --- | --- |
| Language | TypeScript |
| App | `apps/wolf`, Next.js 16.4.2 App Router, React 19.3.0 |
| Database | PostgreSQL on `127.0.0.1:5433`, database `wolf_command`. Port 5432 is refused. |
| Schema | Drizzle table definitions in `apps/wolf/src/server/db/schema.ts`. SQL files in `apps/wolf/src/server/db/migrations/` are applied in order by `apps/wolf/src/server/db/migrate.ts` inside one transaction. There is no down migration. |
| Auth | Email and Wolf password. Session cookie. `authorize()` and `evaluateModuleAccess` in `apps/wolf/src/server/access/`. Actions include read, create, update, delete, and approve. Grants are company-scoped, not outlet-scoped. |
| UI | `/finance/[companyId]` is a native Wolf workspace with the HRIS sidebar, header, and mobile nav (`apps/wolf/src/app/finance/finance-chrome.tsx`). The company home no longer embeds Atrium. The Menu control goes to `/`. Posting, petty cash, inventory, receivables, payables, tax, service charge, and owner pool screens stay closed. The runtime proxy remains for the old Atrium process and is not linked from the company home. |
| Session shell | `amgSessionBootstrap` in `apps/wolf/src/server/finance/amg-proxy.ts` sets `amg_auth_session`, hides Keluar, and reloads once when the embedded page shows Google sign-in. BZG does not use an Atrium Google sign-in. |
| State | Server-rendered access check, then an iframe. Finance books are not a client store. |
| Jobs | No queue worker. No nightly roll-up job. |
| Tests | `node --test` via `pnpm test` in `apps/wolf`. Finance cases live in `apps/wolf/src/server/finance/*.test.ts`. |
| CI | No GitHub or GitLab pipeline file in the repo. |
| Deploy | `compose.yaml` publishes local Postgres. No production host is configured in the repo. |
| Layout | `apps/wolf/src/app` for routes, `apps/wolf/src/server` for domain code, `apps/wolf/src/components` for shared UI, `docs/` for design notes. |

## 2. Existing entities that touch BZG finance

Checked in source. Counts are the 26 October 2026 read for `company_id = 'bzg'` unless another company is named.

| Entity | Where it is | BZG state |
| --- | --- | --- |
| Company | `companies`. Card loader: `apps/wolf/src/server/finance/companies.ts`. | Row `bzg` / name `BZG`. |
| Currency and scale | `finance_settings`. Migration `0018_idr_foundation.sql`. | `IDR`, display scale `0`, rounding mode `half-up` unless changed. No FX conversion. Internal scale 4 stays in `money.ts`. |
| Module flags | `finance_modules`. Registry: `apps/wolf/src/server/finance/modules.ts`. | Enabled: dashboard, accounting-core, reports, settings, atrium-workflows, inventory, service-charges, owner-pool, petty-cash, tax, hotel-operations. No `procurement` row. A flag does not create books. `defaultFinanceModules` would leave non-core modules off for a `shared` company. |
| Chart of accounts | `finance_chart_accounts`. `apps/wolf/src/server/finance/chart-accounts.ts`. Fields: code, name, type, normal balance, statutory line, USALI line, active. | 0 rows. AMG has 37. |
| Legacy accounts | `finance_accounts`. Code, name, active. | 2 rows: `1000` Cash, `4000` Revenue. Both active. |
| Operating department | `finance_operating_departments`. `apps/wolf/src/server/finance/operating-departments.ts`. | 1 row: code `ROOMS`, name `Rooms`, active. This is not an outlet registry. |
| Account mapping | `finance_mapping_configurations`. `apps/wolf/src/server/finance/mapping-configuration.ts`. | Confirmed. Revenue debit `1020`. The three spending credit fields are blank. `1020` is not on either BZG account table. Left unchanged. |
| Atrium-shaped draft journal | `atrium_draft_journals` and `atrium_draft_journal_lines`. Status check allows only `DRAFT`. Line scale at most 2. | 0 journals. |
| Revenue and spending documents | `atrium_revenue_documents`, `atrium_spending_documents`. `apps/wolf/src/server/finance/atrium-revenue-spending.ts`. | 0 rows. Revenue source is `Manual` or `PMS`. Spending type is `Procurement`, `Payroll`, or `Other`. |
| Legacy draft journal | `finance_periods`, `finance_journals`, `finance_journal_lines`. `apps/wolf/src/server/finance/drafts.ts`. Status check allows only `draft`. Numeric scale 4. | Period `2026-10`. One draft, memo `bzg persistence check`, two balanced lines on `1000` and `4000`. Not posted and not deleted. |
| Posting, approval, reversal | `atriumJournalRoute` in `apps/wolf/src/server/finance/atrium-draft-journals.ts` returns unavailable for validate, approve, post, and reverse. The fixed message is `journalLifecycleUnavailable`. Non-GET for BZG is 403 from `isolatedCompanyResult`. | Off. |
| Reports, ledger, trial balance | `isolatedCompanyResult` in `apps/wolf/src/server/finance/amg-proxy.ts`. | Structural zero bodies for BZG and GGV. Amounts are 0. `usesAmgProcessMemory` is true only for `amg`. BZG does not use USALI: `bzgStandardBooks` hides USALI labels and opens Balance Sheet and P&L. |
| Tax, AR, AP, petty cash, service charge, owner pool, inventory lists | Same isolated GET empty arrays. Writes return 403. | No Wolf tables for tax rates, payments, settlements, or a stock ledger. |
| Money helper | `apps/wolf/src/server/finance/money.ts`. Exact decimal text to bigint units. Scale must be 0–4. Extra fraction digits are rejected. No commercial rounding and no FX conversion. | Already used by draft journals. |
| Users and roles | `users`, `memberships`, `grants`, access roles in `0015_access_policy.sql`. | Operator membership is the existing finance administrator path. Not re-seeded. |
| Audit | `audit_events`. Writer: `apps/wolf/src/server/auth/audit.ts`. | Structural events. Finance amounts stay on journal rows. Revenue metadata stores the action name, not old and new values. |
| Outlets, ESB ids, POS orders, recipes, EDC, QRIS, bank settlement | No matches under `apps/wolf/src`. | Absent. Slot 5 and the pool bar are not stored. |

## 3. Mapping

Spec section 4 names are logical. "Leave" means the current Wolf behavior stays. Nothing in this table was created by this pass.

| Spec entity | BZG finance decision |
| --- | --- |
| `outlet` | Create later, not now. No outlet table and no ESB id. `ROOMS` in `finance_operating_departments` is an operating department. Slot 5 and the pool bar stay unconfirmed. |
| `location`, `cost_center` | Create later. `ROOMS` is not a store, chiller, or cost center. |
| `item`, `item_uom_conversion`, `item_category` | Not in this repo. Outside this BZG finance pass. |
| `supplier`, `supplier_item_price` | Not in this repo. BZG has no supplier rows. |
| `tax_rate` | Do not create. No PB1, PPN, service, or PPh row. `/api/tax` stays an empty isolated read. Fixture 9.3 is a worked example, not a BZG rate. |
| `payment_method` | Do not create. No cash, QRIS, EDC, e-wallet, or city-ledger method table. |
| `account` | Leave both existing tables: `finance_chart_accounts` (0 BZG rows) and `finance_accounts` (`1000`, `4000`). Do not seed a chart and do not copy AMG's 37 accounts from `apps/wolf/src/server/finance/import-amg-chart.ts`. |
| `posting_rule` | Create later, only after an accountant supplies rules. The current mapping is four fixed fields in `finance_mapping_configurations`, not event + category + outlet. Confirmed revenue debit `1020` stays. Spending credits stay blank. No account codes will be invented from spec section 6. |
| `user`, `role`, `permission` | Leave. `evaluateModuleAccess` already gates finance by company and action. It is not per outlet. Journal validate, approve, post, and reverse stay unavailable. |
| `stock_ledger`, `stock_balance` | Not a BZG finance object. No ledger table. Do not add one in this pass. |
| `purchase_request` through `supplier_payment`, `direct_purchase` | Not present. `atrium_spending_documents` is a draft spending note (0 rows), not a PR, PO, GRN, or invoice. |
| `stock_transfer`, `stock_count`, `stock_adjustment`, `waste_log`, `batch_lot` | Not present. |
| `recipe`, `recipe_version`, `recipe_line`, `item_cost`, `menu_cost_snapshot`, `menu_item`, `menu_modifier`, `modifier_line`, `menu_combo`, `menu_price`, `channel_config`, `cost_target`, `price_proposal` | Not in this repo. Outside this BZG finance pass. |
| `me_run`, `me_result`, `me_action`, `variance_run` | Not present. |
| `sales_order`, `sales_order_line`, `sales_payment` | Not a POS order. `atrium_revenue_documents` is a draft revenue note with source `Manual` or `PMS` (0 rows). |
| `shift`, `daily_close`, `settlement_batch`, `platform_payout`, `reconciliation_match` | Do not create. No EDC, QRIS, or bank feed will be called. |
| `journal`, `journal_line` | Leave both draft stores. `finance_journals` / `finance_journal_lines` allow only `draft`. `atrium_draft_journals` / `atrium_draft_journal_lines` allow only `DRAFT`. |
| `fiscal_period` | Leave `finance_periods`: company, key, and created time. No lock column. Do not add reopen. |
| `ap_open_item`, `ar_open_item` | Leave the empty isolated lists. No aging table. |
| `approval_workflow`, `approval_request` | Leave unavailable. The approve action exists. `atriumJournalRoute` still returns unavailable, and the proxy answers 403 with `journalLifecycleUnavailable`. |
| `audit_log` | Leave `audit_events`. Do not copy amounts into metadata. |
| `attachment`, `notification` | Do not create. |

Requirement disposition for the finance slice of section 5:

| Spec id | BZG finance decision |
| --- | --- |
| FND-01 outlets on every transaction | Company id is the dimension today. No outlet column. Do not add outlet names or ESB ids. |
| FND-02 roles per action and outlet | Leave company-scoped grants. Do not add outlet permissions. |
| FND-03 audit of create, update, approve, void, price, and period | Leave `writeAudit`. It does not store old value, new value, and reason. |
| FND-04 approval workflow | Leave unavailable. |
| FND-05 UoM base units | Outside this finance pass. No conversion table. |
| FND-06 effective-dated tax and service charge | Do not create. |
| FND-07 shared money helper | Leave `money.ts`. It does not round half-up, and it does not convert FX. BZG's stored scale is 2. |
| FND-08 attachments | Do not create. |
| FND-09 notifications, FND-10 import dry-run | Do not create. |
| ACC-01 posting engine | Do not enable. No `posting_rule` table. Mapping debit `1020` is not a rule engine. |
| ACC-02 event journals | No source documents. Revenue and spending rows are 0. Posting stays off. |
| ACC-03 balanced journal in the same transaction as the document | Draft saves in `atrium-revenue-spending.ts` and `drafts.ts` already refuse an unbalanced draft. They do not post. Isolated reports are zero bodies, not journals. |
| ACC-04 period lock and approved reopen | Do not create. |
| ACC-05 GR/IR | No purchasing documents. |
| ACC-06 AP/AR aging | Leave the empty isolated lists. |
| ACC-07 P&L, balance sheet, cash flow, or export | Leave the zero USALI and financial-statement bodies. Those bodies have no cash-flow section and are not a posted Wolf ledger. No export job exists. |
| ACC-08 tax CSV | Do not create. |
| PAY-01..07 | Do not create. |
| INV, COST, PRC, POS, ME, VAR, BNQ, SVC | Not applied to BZG finance. The `service-charges` and `inventory` module flags are `atrium-memory` in `modules.ts` and do not create those ledgers. |

## 4. Conflicts

- Two draft ledgers exist: `finance_journals` (scale 4, status `draft`) and `atrium_draft_journals` (line scale at most 2, status `DRAFT`). Spec ACC-01 wants one posting engine. A new `posting_rule` table would be a third model. Neither store can post: `atrium_draft_journals_status_check` and `finance_journals_status_check` allow only the draft status, and `atriumJournalRoute` returns unavailable for validate, approve, post, and reverse.
- Spec rule 3 says debit and credit accounts come from `posting_rule` (event + category + outlet). BZG has `finance_mapping_configurations`: one revenue debit and three spending credits. The revenue debit is the confirmed value `1020`. The spending credits are blank. `1020` is not a `finance_chart_accounts` row and not a `finance_accounts` row. `activeAccount` in `atrium-revenue-spending.ts` rejects a mapped code that is not an active chart account of the required type, so a revenue save fails closed. The confirmed flag and `1020` were not changed.
- Spec rule 8 forbids floats, wants IDR displayed with 0 decimals, and wants 4 or more decimals internally, rounded only by one shared helper. `money.ts` uses bigint and rejects extra fraction digits. It has no commercial rounding and no FX. `finance_settings` now stores `IDR` and display scale `0`, with rounding mode `half-up`. Atrium lines are constrained to scale at most 2. Legacy journal lines are numeric scale 4. `responseAmount` returns `Number(...)`, and `AtriumDraftLine.debit` / `credit` are typed as `number`. `emptyIsolatedReport` hardcodes `currency: "IDR (Rp)"` and JavaScript number zeros. That string is shared with GGV. None of these were reconciled.
- Spec rule 1 is an append-only stock ledger. BZG has no stock ledger. Draft journals are mutable: `saveDraftJournal` deletes and reinserts `finance_journal_lines`, and `deleteAtriumDraftJournal` deletes a draft that is not linked to a revenue or spending document. Posted-document immutability has no posted rows because posting is off. The `bzg persistence check` draft was not deleted.
- Spec FND-06 and the Indonesia rules require effective-dated, configurable PB1, PPN, service charge, and PPh. There is no `tax_rate` table. `/api/tax` is an empty isolated GET. Fixture 9.3 (service 5%, PB1 10%) was not copied in.
- Spec FND-01 puts `outlet` on every transactional table. BZG transactions are keyed by `company_id`. `ROOMS` is the only operating department. Slot 5 and the pool bar are not stored.
- Spec ACC-04 requires a locked fiscal period and an approved reopen. `finance_periods` has company, key, and created time. `saveDraftJournal` rejects a missing period with "The period is not open for this company." That check is presence, not a lock.
- Module rows for tax, inventory, service charges, and hotel operations can be `Y` while `usesAmgProcessMemory` is true only for `amg`. `isolatedCompanyResult` then returns empty lists or zero reports, and writes return 403. The flag is not a ledger.
- Spec FND-03 wants user, time, old value, new value, and reason. `writeAudit` stores user, time, resource, and metadata. The revenue save metadata is the action name. Amounts stay off the audit row.
- Spec POS-01 and the idempotency rule want an external id. `createRevenueDocument` generates `rev_${uuid}` itself. There is no POS external id.
- `atrium_revenue_documents_source_check` allows `PMS`, and `hotel-operations` is an atrium-memory module. There is no PMS client in `apps/wolf/src`. The label is not a room-charge or city-ledger feed.
- There is no reversible migration runner. `migrate.ts` applies forward SQL in one transaction. This pass added none.

## 5. Risks

- Copying AMG process memory, the AMG chart, or AMG report amounts into BZG would break the zero-report rule in `isolatedCompanyResult`.
- Seeding outlets, tax rates, FX, a rounding mode, or account codes before they are confirmed would invent master data. Slot 5 and the pool bar have no ids. Spec section 6 must not be turned into codes.
- Turning on posting, period lock, or RLS would change the current 403 lifecycle and the isolation model. RLS stays off. Posting stays off.
- The legacy `bzg persistence check` draft is the isolation fixture named in `docs/local-development-accounts.md`. Deleting or posting it was not done.
- On 26 October 2026 the 264 balanced AMG ABS drafts were posted into the running Atrium process at `127.0.0.1:3099` so the AMG statements can show them. Wolf `atrium_draft_journals` remains `DRAFT` because that check allows only draft. AMG journal list and read follow that process. BZG, GGV, and the persistence-check draft were not posted. `JRN-PMS-202608-CLOSE` and `JRN-PMS-202609-CLOSE` were not changed.
- Replacing `EmbeddedAppFrame`, the Menu bar, or `amgSessionBootstrap` with a new ERP screen would drop the full-screen shell and the no-Google-sign-in behavior. Those were left as they are.
- Live ESB, POS, EDC, QRIS, bank, and PMS calls are out of bounds and were not made.
- BZG and GGV share `emptyIsolatedReport`. A currency or amount change for one company would change the other.

## 6. Migration plan

Ordered, additive, and not started. No step enables RLS, posting, or a new master-data seed. No step truncates or reseeds. Rollback of a later change has to be a forward disable: `migrate.ts` has no down migration.

1. Phase 1 stays unstarted. The spec slice is FND, INV-01..03, a posting skeleton, audit, UoM, and tax rates. For BZG finance, UoM, stock ledger, locations, tax rates, outlets, and ESB ids stay out. `money.ts` and `audit_events` stay as they are. `posting_rule` stays unbuilt until an accountant supplies rules. Both journal tables stay draft-only. Debit `1020` stays. A later finance slice, after the questions in section 8 are answered, would add an empty company-scoped rule table only, and would not seed accounts.
2. Phase 2 stays unstarted. Purchase-side journals need purchasing documents. BZG has no suppliers or receipts. `atrium_spending_documents` is not a GRN.
3. Phases 3–6 stay outside BZG finance: recipe, price, POS backflush, variance, and menu engineering. Costing method and stock-deduction point stay unset.
4. Phase 7 stays blocked. Payment methods, file settlement, period lock, AP/AR aging, and tax CSV wait on tax policy, a bank-file layout, and posting. No API import.
5. Phases 8–9 stay outside this pass. Banquet, service-charge distribution, offline POS, and forecasting wait on named outlets, including slot 5 and the pool bar. PMS stays disconnected.

Prompt 0 says not to start Phase 1. This document is the stop point.

## 7. Open decisions

Spec section 10, with a proposed answer from the current BZG books. Nothing below was written into the database.

1. **Does Wolf own the general ledger, or export journals?** Proposal: keep the books in Wolf. Draft journals, the chart table, and the mapping already live in Postgres, and there is no export job. BZG does not yet have a posted ledger: both journal stores are draft-only, and reports are the zero bodies from `isolatedCompanyResult`. Do not add an export, and do not turn posting on. Confirm before any later phase treats Wolf as the posted book.
2. **Costing method default per category.** No item categories exist. Spec INV-09 and COST-09 default to weighted average. Proposal: leave this unset. Do not store a BZG default. Use weighted average only if inventory costing is later brought into scope.
3. **Stock deduction point.** No POS and no stock ledger. Spec POS-03 defaults to deduction at sale, with kitchen fire as the other option. Proposal: leave this unset. It belongs with Phase 5, not Phase 1, and there is no outlet to attach it to. Slot 5 and the pool bar stay unconfirmed.
4. **Single legal entity or multi-entity.** `companies` already separates `bzg`, `amg`, and `ggv`. Proposal: BZG stays one legal entity, company id `bzg`. Future outlets are dimensions on that company, not new companies. Do not add a second BZG entity. AMG and GGV stay isolated.
5. **Offline POS in Phase 1 or later.** Spec POS-08 is a later phase (phase 8). There is no POS code under `apps/wolf/src`. Proposal: later, not Phase 1.
6. **Which region's PB1 rules, and online tax reporting.** No tax rates are stored. Spec section 1 says the app produces reports and exports, not a filing system. Fixture 9.3 is not a BZG rate. Proposal: support no region and file nothing until rates, bases, dates, and inclusive or exclusive mode are supplied. Do not hardcode 10%, 5%, or 11%/12%.
7. **Delivery platforms: API or file import.** No GoFood, GrabFood, or ShopeeFood code under `apps/wolf/src`. Proposal: no integration now. If PAY-05 is ever built, file import first, and no live API.
8. **Hotel PMS, room charge, city ledger.** The revenue source check allows the label `PMS`. `hotel-operations` is an atrium-memory flag. Isolated `/api/revenue` and `/api/spending` are empty for BZG. Proposal: leave PMS disconnected. `ROOMS` is not a PMS property. Slot 5 and the pool bar are not PMS ids.

These BZG finance points are still open and were not guessed:

- Book currency is IDR for every company. Display scale is 0. Internal scale 4 stays in `money.ts`. Rounding defaults to half-up and can be changed per company. There is no FX conversion.
- Rounding. `money.ts` rejects extra fraction digits. It does not define nearest Rp 500 or Rp 1,000.
- Chart and posting rules. BZG has no `finance_chart_accounts` rows. Confirmed debit `1020` stays and matches neither account table. Spending credits are blank.
- Which draft table is the future posted journal: `atrium_draft_journals` or `finance_journals`.
- Whether the `bzg persistence check` draft remains the isolation fixture. This pass left it untouched.
- Period lock, and who may reopen a period.
- Whether RLS is ever enabled. It is off.

## 8. Questions

1. Do you confirm that a later posted BZG ledger stays in Wolf, with posting left off until you approve a phase after this one?
2. Do you confirm BZG is one legal entity, and that outlets will be dimensions on company `bzg` rather than new companies?
3. Answered: every company book is IDR. Display scale is 0. Internal scale stays 4 inside `money.ts`. Document totals use the configured rounding mode, default half-up. No FX conversion.
4. What rounding rule should document totals use beyond rejecting too many decimal places?
5. Which region's PB1 applies, and which rates, bases, effective dates, and inclusive or exclusive mode? Fixture 9.3 will not be stored as BZG policy.
6. What are the confirmed outlet names and ESB ids? Slot 5 and the pool bar stay out until you name them.
7. Will you supply a chart that contains the confirmed debit `1020`, and the posting-rule accounts an accountant wants? `1020` will not be removed here. No codes will be invented. The three spending credits are blank.
8. Which draft table is the future posted journal: `atrium_draft_journals` or `finance_journals`?
9. Should the `bzg persistence check` draft stay the isolation fixture?
10. Is hotel PMS, room charge, or city ledger in scope? The `PMS` source label is not a connection.
11. Does BZG use GoFood, GrabFood, or ShopeeFood? If it does, this pass still assumes a later file import and no API.
12. Should costing stay at the spec default of weighted average, and stock deduction at sale, only when inventory and POS are in scope? Offline POS stays in phase 8 until you say otherwise.
13. If a period lock is added later, who may reopen it? RLS stays off unless you say otherwise.
14. Phase 1 stays unstarted until you approve this gap analysis and the items above.

## 9. HR payroll structure

Payroll component configuration stays in the existing HRIS payroll model, not in Wolf finance. There is no finance posting, and no tax, BPJS, overtime-rate, or service-charge distribution rule was added. Company structures and period snapshots are effective-dated in HRIS. Stock, posted journals, and gaji pokok rows are unchanged.

## 9. Company operating system

Decision for the access starter. Spec FND-02 asks for permissions per action and per outlet. Wolf access is still company-scoped: `evaluateModuleAccess` and department memberships. This slice does not add outlets, tax rates, account codes, or a second permission engine. Outlet permissions stay deferred, which matches section 3.

The screen is the existing Wolf Access page, one company at a time. HR Configuration has departments and payroll config. It does not have an authentication setting for every company, so the operating structure was not added there.

`finance_settings.workspace_kind = 'amg'` is the hotel signal, and only company `amg` can hold it. AMG gets rooms plus the shared units. BZG and GGV are `shared`, so they get the neutral starter. GGV's demo department Night Audit is not a company type and was not copied. `local-books` stays off operator lists. A company with no finance settings, including `dev-company`, is not seeded.

Starter rows live in `company_operating_units`, `company_operating_roles`, and `company_operating_responsibilities`. A responsibility stores an existing capability id. It does not publish a policy, insert a membership, or grant Owner Private. Wolf roles stay `staff`, `administrator`, and `owner`. An operating role name is not one of those. HR actions share the HR member check. That check opens the HR workspace. It is not an HRIS role. Finance member opens the book and does not open HR. Procurement member stays procurement only. Finance approval is the existing department grant. Journal post is not an enforced action, so it is not a responsibility. USALI and owner pool are hotel finance-book duties mapped to the finance member check, not to Owner Private, and they are not seeded for a neutral company.

Seeding is insert-on-conflict-do-nothing. It does not delete memberships.

Operating roles now also store interface, feature, and approval grants in `company_operating_role_grants`. The Access screen saves those switches per company and role. Hotel-only grants, including USALI, owner pool, and Rooms, cannot be stored for a neutral company. A grant changes access only after a row exists in `company_operating_role_assignments`. This slice does not assign anyone, does not publish a policy, and does not grant Owner Private. Journal posting, draft approval, payroll calculation, and payroll posting to finance are not grants because those actions are not enforced. People with no operating-role assignment keep their current membership.
