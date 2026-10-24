# Database configuration

Wolf reads `DATABASE_URL` from the process environment. `next dev`, `next start`, and `next build` load `apps/wolf/.env.local` through Next.js. The database commands load that same file themselves. Application code does not rewrite a URL into another host, port, or database name. Surrounding whitespace on the environment value is ignored. The accepted string is passed to the driver unchanged.

Refused configuration produces a fixed message with no URL, credential, session token, password hash, or record contents. Request handlers turn that failure into a generic unavailable response. The page error boundary does not log the error object.

## Runtime consumers

These call `readAuthConfig` and then `getDb` with the accepted URL:

- `apps/wolf/src/app/login/actions.ts` signs in and revokes the current session.
- `apps/wolf/src/app/account/password/actions.ts` changes the Wolf password.
- `apps/wolf/src/server/auth/current-session.ts` reads the signed-in account.
- `apps/wolf/src/server/access/gate.ts` opens a guarded module.
- `apps/wolf/src/app/api/records/route.ts` serves module record requests.

`getDb` checks the same policy again immediately before it constructs a client. One process keeps one pool. A later request with a different accepted URL is refused instead of reusing or replacing that pool. Server notices are not written to the console.

`db:migrate`, `db:provision`, and `db:seed:dev` use the development command guard in `apps/wolf/src/server/db/database-target.ts`. They do not use `readAuthConfig`.

## Local development

`NODE_ENV` other than `production`, including `next dev`, accepts only:

- scheme `postgres` or `postgresql`
- host `127.0.0.1`
- port `5433`
- database `wolf_command`

Port `5432` is the unrelated Homebrew PostgreSQL instance and is refused. Other ports, database names, `localhost`, and remote hosts are refused. This is the Compose service published on `127.0.0.1:5433`.

## Production

`NODE_ENV=production`, including `next start` and any deployed process, does not use the local allowlist. A local URL is refused, so a production-mode process does not attach to Homebrew or the Compose database.

Production accepts the supplied URL only when all of these are already true:

- scheme `postgres` or `postgresql`
- host is present and is not a loopback or wildcard address
- port is an explicit integer from 1 through 65535, with no default substituted
- database name is one explicit path segment
- username and password are present in the URL
- `sslmode` is `require`, `verify-ca`, or `verify-full`

The repository does not contain a production host, cloud project, or credential. A deployed process must receive `DATABASE_URL` from its own environment. This document does not select or contact a provider. No production database is provisioned here.

The session cookie is Secure in production unless `WOLF_COOKIE_SECURE=0`.
