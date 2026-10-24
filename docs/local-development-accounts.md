# Local Wolf accounts

This document is for local development. It is not part of the production application. Do not reuse these passwords anywhere else, and do not enter an email-provider password into Wolf.

`pnpm db:migrate`, `pnpm db:seed:dev`, `pnpm db:provision`, and `pnpm db:bootstrap-operator` load `apps/wolf/.env.local` themselves. A caller does not need to source that file. A variable already present in the environment is kept and is the value the command validates. These commands never write `.env.local`.

Immediately before connecting, all three commands accept only host `127.0.0.1`, port `5433`, and database `wolf_command`, and only when `NODE_ENV` is not `production`. They refuse port `5432`, every other port, remote hosts, a missing or malformed URL, and production mode. A refused URL is not rewritten into the allowed target.

Run the seed only after the local Wolf Postgres service is up and `apps/wolf/.env.local` points at that target:

```bash
WOLF_ALLOW_DEV_SEED=1 pnpm db:seed:dev
```

The seed does not print Wolf passwords. The local accounts are listed here.

| Email | Wolf password | Access |
| --- | --- | --- |
| staff.dev@wolf-command.test | local-wolf-staff-password | Staff in dev-company / dev-finance. No Owner Private grant. |
| admin.dev@wolf-command.test | local-wolf-admin-password | Administrator in dev-company. No Owner Private grant. |
| owner-grant.dev@wolf-command.test | local-wolf-owner-password | Owner in dev-company, plus an explicit Owner Private grant for dev-company. |

An administrator or owner role does not grant Owner Private access. Only the explicit grant does. Module pages check the signed-in account on the server. A company administrator is not a platform operator.

## Provisioning a real account

There is no public registration and no email reset. An authorized administrator creates the account on the local database and gives the person the temporary Wolf password through a channel approved outside this application.

```bash
WOLF_ALLOW_ACCOUNT_PROVISION=1 \
WOLF_PROVISION_EMAIL="person@example.com" \
WOLF_PROVISION_PASSWORD="a-temporary-wolf-password" \
WOLF_PROVISION_COMPANY="company-id" \
WOLF_PROVISION_ROLE="staff" \
pnpm db:provision
```

Optional variables: `WOLF_PROVISION_DEPARTMENT`, and `WOLF_PROVISION_OWNER_PRIVATE=1` when an explicit Owner Private grant is intended. The command refuses production mode and any database other than `127.0.0.1:5433/wolf_command`. It does not send email or print the password.

The temporary password must be changed at the next sign-in. That change requires the current password and revokes the account's other sessions.

To replace a password without email:

```bash
WOLF_ALLOW_ACCOUNT_PROVISION=1 \
WOLF_PROVISION_MODE=reset \
WOLF_PROVISION_EMAIL="person@example.com" \
WOLF_PROVISION_PASSWORD="another-temporary-wolf-password" \
pnpm db:provision
```

The reset revokes existing sessions. The person must change that temporary password before continuing.

## Local operator bootstrap

Company creation in the app is limited to a row in `platform_operators`. There is no public registration and no web bootstrap route. The command refuses production and any database other than `127.0.0.1:5433/wolf_command`. It records only the first operator.

```bash
WOLF_ALLOW_DEV_BOOTSTRAP=1 \
WOLF_BOOTSTRAP_EMAIL="operator@example.com" \
WOLF_BOOTSTRAP_PASSWORD="a-temporary-wolf-password" \
pnpm db:bootstrap-operator
```

The password is not printed. If the email already exists, that account becomes the operator and its password is left unchanged. A company administrator cannot create companies.

The current local Wolf database has one platform operator, `operator.dev@wolf-command.test`. The first sign-in required a password change. After that change, the Wolf password matches the staff row in the table above. The account is a finance administrator of `local-books`, `amg`, `bzg`, and `ggv`. All four open the same Finance application. `amg` also has the Atrium workflow module enabled. Those Atrium books remain process memory. `bzg` has one Wolf draft journal used to check isolation. `ggv` has no Wolf journals. The disabled account `phase2e.staff@wolf-command.test` was not changed. The three seed rows above are not present until `pnpm db:seed:dev` is run.
