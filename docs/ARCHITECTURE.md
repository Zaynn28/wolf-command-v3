# Wolf Command V3

## Initial application
- apps/wolf: Next.js web application
- packages/shared: shared application types and utilities
- docs: architecture and implementation records

## Initial modules
- Owner Dashboard
- Finance
- HR
- Academy
- Content Machine
- Owner Private

## Security requirements
- Authentication must be real before private data is exposed. Sign-in uses a Wolf password stored as an Argon2id hash, not the password for someone's email account.
- Authorization must be enforced on the server, not just hidden in the UI. The module matrix is documented in `docs/ACCESS.md`.
- Owner Private data must be isolated from staff and other company users.
- Secrets must never be committed to Git.
- Database configuration follows `docs/database-configuration.md`. Local development accepts only `127.0.0.1:5433/wolf_command`. Production uses a separate remote TLS contract and is not deployed from this repository.
- Company and department boundaries follow `docs/data-foundation.md`. Module business tables are not part of that foundation.
- Production deployments require explicit owner approval.

## Implementation rule
A screen is not proof that a feature works. Verify each feature with
tests, real user workflows, error-path checks and recovery evidence.

## Initial deployment direction
Google Cloud is the preferred platform. Production infrastructure and
paid services require cost review and explicit approval before purchase.
