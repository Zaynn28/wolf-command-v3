# Data foundation

This is the company boundary for Wolf. It is not the Finance domain model. That design is [docs/finance-domain-specification.md](finance-domain-specification.md). Finance and HR still have no business tables.

## What already existed

`schema.sql` is the historical authentication migration. It creates `users`, `memberships`, `grants`, `sessions`, `auth_attempts`, `audit_events`, and `otp_challenges`. Company and department values are unconstrained text. `migrations/0002_password_auth.sql` adds Wolf password columns, widens attempt and audit checks, and drops `otp_challenges`.

The Drizzle schema in `apps/wolf/src/server/db/schema.ts` matches the post-0002 tables, not the historical file. Before this foundation it did not declare the SQL checks, the unique email, the session token hash uniqueness, or the partial grant indexes. Those constraints still live in SQL. Drizzle now also describes `companies`, `departments`, the tenant foreign keys, and the audit resource columns added by `migrations/0003_tenant_foundation.sql`.

Membership and grant rows stay the only access records. Companies and departments give those rows a parent. They do not replace them.

## Entities

- `companies` holds a stable text id. Existing membership and grant company ids are copied forward. `name` starts as that same id because no separate display name has been collected.
- `departments` belong to one company. The primary key is `(company_id, id)`, so two companies may use the same department id.
- `users` and `sessions` are unchanged. A user is not owned by one company.
- `memberships` still mean staff, administrator, or owner, active or disabled, company-wide when `department_id` is null.
- `grants` still mean Owner Private access or a separate approve grant. Role does not imply either grant.
- `audit_events` keep the existing event type. New nullable columns record company, resource type, and resource identifier when the writer has them.

There is no generic module-records table. One shared payload table would let a missed module filter cross Finance, HR, and Owner Private. Future module tables must carry `company_id`, and a department module table must also carry a department in that same company.

## Constraints

- A membership or grant company id must reference `companies`.
- A non-null department id must reference `departments` for that same company. A null department id remains company-wide, and PostgreSQL does not require a department row for it.
- Deleting a company or department is restricted while a membership, grant, or company audit row points at it.
- Owner Private and approve shapes stay on the existing `grants_shape_check`.
- Audit resource type and resource id are both empty or both present.
- Audit metadata is still a small scalar object. Writers reject credential keys and values that look like a password hash or a session token. They do not store record bodies.

## Row-level security

Row-level security is not enabled.

The application connects as one database role. That role owns the tables. PostgreSQL skips row-level security for the table owner unless `FORCE ROW LEVEL SECURITY` is set. Turning the feature on without a separate non-owner role and a transaction-local actor id would not isolate tenants. The pool does not set a per-request user today. The access rules also depend on department names, Owner Private grants, and an approve grant that is distinct from read, create, update, and delete. Copying that matrix into policies would create a second decision that can drift from `authorize()`. PGlite tests run with a privileged role, so they would not prove the policies either.

Isolation for this version is the foreign keys plus the server authorization path. The server loads the user from the session, then loads membership and grant rows. Client user ids, roles, and grant labels are not consulted. Revisit row-level security only with a non-owner role, forced policies, and a transaction-scoped actor.

## Migration sequence

`pnpm db:migrate` applies `schema.sql`, then `0002_password_auth.sql`, then `0003_tenant_foundation.sql`, then `0004_finance_drafts.sql`, then `0005_finance_workspace.sql`, then `0006_finance_modules.sql`, then `0007_finance_module_parity.sql`, then `0008_finance_operating_departments.sql`, then `0009_finance_mapping_configurations.sql`, then `0010_finance_chart_accounts.sql`, then `0011_atrium_draft_journals.sql`, then `0012_atrium_revenue_spending.sql`. `0004` adds draft finance tables only. Journal status is constrained to `draft`. `0005` adds `finance_settings.workspace_kind`, default `shared`, allowed values `shared` and `amg`. `0006` stores each company's enabled finance modules. It does not copy journals or accounts. `0007` turns on the same feature rows for `amg`, `bzg`, and `ggv`. It does not copy journals or accounts. `0008` adds empty company-scoped operating departments. It does not copy Atrium process-memory departments. `0009` adds one empty account-mapping document per company. It does not copy the Atrium in-memory mapping. `0010` adds an empty company-scoped chart of accounts in `finance_chart_accounts`. It does not copy the Atrium in-memory chart and does not change the draft-ledger `finance_accounts` table. A later local command can import an AMG chart export into that table. That command is not part of `0010` and does not copy the chart into BZG or GGV. `0011` adds empty Atrium draft-journal tables. It does not copy process-memory journals and does not change `finance_journals`. `0012` allows revenue and spending draft sources and adds empty company-scoped revenue and spending documents. It does not copy process-memory documents. Mapping codes stay free text, including empty values, and are not a foreign key to the chart. Posting is not implemented. The `0003` file:

1. Creates `companies` and `departments` if they are absent.
2. Inserts company ids already present on memberships or grants.
3. Inserts department ids already present on those same rows.
4. Adds the company and department foreign keys.
5. Adds nullable audit company, resource type, and resource identifier columns.

It does not drop, truncate, or rewrite user, session, membership, or grant rows. It does not change passwords or account status. Running it again is safe. The current `migrate.ts` runner applies `schema.sql`, `0002`, and `0003` inside one `sql.begin` transaction. An earlier draft of this note said the statements were not wrapped. That sentence was wrong for the current runner.

This note does not itself apply a migration. Whether `0003` is already present in a local database was not rechecked here.

## Compatibility risks

- A membership or grant whose department id is non-null but blank will fail the department foreign key, because the backfill skips blank ids.
- Company and department display names are the ids until a profile is approved.
- Authorization events still store the requested company id in metadata. They do not write the company foreign key, because a denied company may not have a row and the denial must still be recorded.
- Module business tables are intentionally absent.
