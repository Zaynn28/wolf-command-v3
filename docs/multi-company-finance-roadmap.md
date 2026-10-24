# Multi-company Finance roadmap

Order only. The domain design is [docs/finance-domain-specification.md](finance-domain-specification.md). Schema readiness is [docs/finance-schema-readiness-review.md](finance-schema-readiness-review.md). AMG evidence is [docs/amg-finance-full-merger-plan.md](amg-finance-full-merger-plan.md). The eight open owner decisions stay in [docs/phase-3-finance-hr-architecture.md](phase-3-finance-hr-architecture.md).

Confirmed product decisions, unchanged:

1. Modular Finance with company-enabled workflows.
2. Shared PostgreSQL with enforced tenant isolation.
3. Private onboarding by authorized Wolf operators. Public registration stays disabled.
4. AMG Finance is the first company implementation and migration pilot.

| Step | State | What it produces |
| --- | --- | --- |
| Tenant foundation in Wolf | Present in source. Local application was not rechecked in this phase. | Companies, departments, memberships, grants. No Finance business tables. |
| AMG source inspection | Done at `3c9a1e12ebcb3132875aca6f446c9b88b6eb3452`. | Ledger behavior and storage map. |
| Live production inventory | Blocked. | Spreadsheet, Firebase, and host `data/` evidence. Absence is not emptiness. |
| Domain specification | Written in Phase 3B. Not approved as a schema. | Shared foundation versus company modules. |
| Schema readiness review | Written in Phase 3C. Result was no-go for posting. | Posting, reversal, tax, and hotel modules stay blocked. |
| Local draft foundation | Implemented. Not production-ready. | Company settings, accounts, periods, and draft journals on `127.0.0.1:5433/wolf_command` after `pnpm db:migrate`. |
| Shared Finance application | Implemented locally. Not production-ready. | AMG, BZG, and GGV open the existing AMG Finance application. The company in the Wolf URL selects the context. The chart of accounts, operating departments, and account mapping are stored per company in Wolf PostgreSQL. The current AMG process-memory chart can be imported by a local AMG-only command after export. That snapshot is not a production spreadsheet recovery. Manual draft journals, revenue documents, and spending documents are stored per company in Wolf. The two posted Atrium seed journals and their night-audit documents were not imported. Validation, approval, posting, and reversal are not enabled. AMG's other business reads still use the Atrium process memory. BZG and GGV use the same screens, but their other business API calls are refused or empty and are not sent to that memory store. Feature rows in `finance_modules` are the same for those three companies after `0007`. Enabling a module does not grant membership or approval. |
| AMG runtime boundary | Optional module for company id `amg` only. Identity cutover is not approved. | `atrium-workflows` embeds the existing Atrium application through `/finance/amg-runtime` when that module is enabled. Individual Atrium pillars are still inside that one application and are not separately enforced. Wolf session, AMG finance membership, and the module flag gate the proxy. A Wolf preload forces the local Atrium listener onto `127.0.0.1:3099` without editing Atrium source. Its own login remains on that loopback port. Upstream redirects are refused. Sheet sync, legacy login, mock reset, access-control switching, and PMS integration routes are blocked. In-memory AMG books are not production records, are not persistent, and are not copied to BZG or GGV. |
| Accounting and isolation decisions | Open. | Currency scale, posting rules, retention, and whether row-level security is in the first migration. |
| Schema approval | Not given. | A later migration series. Not `finance_records`. |
| Isolated rehearsal and reconciliation | Not started. | Exact posted totals. No tolerance unless an accountant sets one. |
| Cutover approval | Not given. Separate from schema approval. | AMG remains recoverable until this approval and the rollback period. |
| HR | Unscheduled. | No HR table until its own scope is approved. |

Hotel workflows stay optional modules. They are not the platform default.
