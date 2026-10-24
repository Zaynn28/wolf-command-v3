# HR integration

Wolf is the authentication and company-authorization boundary for the embedded HRIS. The HRIS screen is the cloned Vite application. It does not own Wolf sessions, and Wolf does not own its employee records.

## Request flow

1. The browser authenticates to Wolf with the `wolf_session` cookie.
2. `/hr` lists only `amg`, `bzg`, and `ggv`. An HR department membership opens the staff workspace. Another non-finance department membership at that company opens the employee screen only. Finance memberships are not included. `local-books` is not an HRIS company. A Wolf role is not an HRIS role.
3. `/hr/{company}` checks the same membership on the server, then frames `/hr/{company}/runtime/`.
4. The runtime proxy accepts only `http://127.0.0.1:3011`. It rewrites asset URLs onto the company prefix. It does not forward the browser cookie or `Authorization` header.
5. The HTML response sets an HttpOnly `wolf_hr_assertion` cookie on `/hr/{company}/runtime`. The cookie value is an HMAC assertion with issuer `wolf`, audience `hris`, the Wolf user id, the company id, and a 120-second expiry. The signing key is not sent to the browser as JavaScript.
6. The HRIS screen calls `GET /hr/{company}/runtime/__wolf/session` on the same origin. Wolf accepts it only when the Wolf session and the assertion agree on the user and company. The screen then opens without the HRIS demo login.
7. Allowlisted `/api/*` calls on the runtime prefix are forwarded only after the Wolf session, company membership, and assertion all pass. Wolf forwards its verified assertion and does not forward the browser cookie, `Authorization`, or a browser company header. Employee and payroll routes stay blocked until the HRIS confirms company columns for employees, payroll periods, payroll records, and payroll grants. Wolf does not copy employee records.

The process on `127.0.0.1:3011` is a Vite development server. Opening it directly shows a development banner and, only in a Vite development build, the demo sign-in. That is not a Wolf session. A production Wolf process does not treat that port as authentication. Production Wolf refuses `/@vite`, `/@fs`, and `/node_modules` through the runtime proxy. Development Wolf allows the Vite modules the screen needs and still refuses `/@fs`.

Sign-out, session expiry, a required password change, and a disabled HR membership are checked on every runtime request before the assertion is accepted. The 120-second cookie does not extend a Wolf session. The embedded screen repeats the session check every 10 seconds and when the tab becomes visible, and clears itself when Wolf refuses the check.

Demo account material is compiled only into the Vite development build. `login()` returns false when the embed marker is present and when `import.meta.env.DEV` is false.

## Local ports

These are the ports in this workspace. Wolf is `http://localhost:3015`. The HRIS UI process is `http://127.0.0.1:3011`. Do not point the HRIS Express process at Wolf Postgres (`127.0.0.1:5433`) or at an unknown database on port 5432.

```bash
cd "/Users/nozerre/WOLFHRIS" && ./node_modules/.bin/vite --host 127.0.0.1 --port 3011 --strictPort
cd apps/wolf && corepack pnpm@9.15.9 exec next dev --port 3015
```

Open `http://localhost:3015/hr`, then `/hr/amg`, `/hr/bzg`, or `/hr/ggv`.

## Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| `WOLF_HR_ASSERTION_SECRET` | Every environment | HMAC key. At least 32 characters, at most 512, no whitespace, and at least 8 distinct characters. Missing, short, or low-diversity values fail closed in development and production. Wolf does not generate a key. Production reads this variable from the process environment, which is where a Google Secret Manager mount is injected on Cloud Run or GKE. |
| `WOLF_HR_RUNTIME_ORIGIN` | No | In development, only `http://127.0.0.1:3011` is accepted. Any other value refuses the runtime. Production refuses this origin as well, so a production Wolf process cannot use the Vite development server. |
| `WOLF_COOKIE_SECURE` | Development only | `1` marks the assertion cookie `Secure` during development. `0` leaves it unset on local HTTP. Production always sets `Secure`, including when this variable is `0`. |

Rotate the assertion key by setting a new value and restarting Wolf. Previous assertion cookies fail verification. Do not print the old or new value. The Wolf session cookie is unchanged by that rotation.

Do not commit the assertion secret. Do not place it in client code, query strings, or audit metadata.

## Employee API

HRIS API routes require a verified Wolf assertion. A browser `orgId`, `companyId`, or forwarded company header cannot create `req.hrContext`. The context is accepted only when `source` is `verified-assertion` and `companyId` is `amg`, `bzg`, or `ggv`. Otherwise the route returns 401 before a query.

Employee and payroll routes also require confirmed company isolation: `company_id` on `employees`, `payroll_periods`, and `payroll_records`, plus `company_id` and `wolf_user_id` on `hris_payroll_grants`. Until that catalog is confirmed in the HRIS process, those routes return 403 and do not query. Company membership and the payroll grant are separate checks. A Wolf owner, administrator, or HR membership does not approve payroll. Approval reads `hris_payroll_grants` and ignores any grant or role inside the assertion.

`database/company-scope.sql` is an additive script. It adds nullable `company_id` columns and indexes. It does not backfill existing rows and it does not default them to AMG. `server/migrate.js` still executes `database/schema.sql`, which drops the HRIS tables, so that script must not be run. Applying `company-scope.sql` does not by itself open the employee or payroll routes.

## Local handoff

Wolf and the HRIS read the same `WOLF_HR_ASSERTION_SECRET` from their gitignored env files. The value is not in source. HRIS verifies the HMAC assertion from `X-Wolf-Hr-Assertion` and binds `req.hrContext`. Wolf sets that header from the HttpOnly assertion cookie after it rechecks the Wolf session, company membership, and assertion. A browser-supplied header, `orgId`, or cookie is not trusted by itself.

In development, allowlisted company APIs are proxied to `http://127.0.0.1:3012`. The HR screen stays on `http://127.0.0.1:3011`. Production refuses both of those local origins. Payroll approval still requires an HRIS `payroll` grant, which the assertion does not include.

Rows without a company stay hidden. They are not assigned to AMG. Employee and payroll SQL stays blocked while the isolation catalog is unconfirmed.

## Audit

Opening the embedded session writes the existing `authorization_allowed` or `authorization_denied` event. Metadata is `module`, `action`, and `outcome`. The assertion, session cookie, and employee fields are not stored. A failed audit write does not grant access.

The assertion can be presented again until it expires, but only together with the same Wolf session and an active HR membership for that company. It is not a bearer token for another user. State-changing methods on the runtime prefix are refused. The assertion cookie is `HttpOnly`, `SameSite=Strict`, and path-scoped to `/hr/{company}/runtime`.

## Rollback

1. Stop the Vite process on port 3011.
2. Remove the HR runtime route `apps/wolf/src/app/hr/[companyId]/runtime/` and the HR iframe in `apps/wolf/src/app/hr/[companyId]/page.tsx`.
3. Unset `WOLF_HR_ASSERTION_SECRET`.
4. HR department rows and HR memberships are Wolf authorization data. Disable a membership by setting its status to `disabled` rather than deleting history. `local-books` has no HR membership from this integration.

No HR business tables were added to Wolf. No migration is required to roll back the screen.
