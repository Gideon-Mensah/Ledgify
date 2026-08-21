# Security readiness

Implemented controls include tenant-scoped APIs, permission matrices, immutable/reversal accounting workflows, JWT rotation, production-short access-token defaults, explicit CORS/CSRF, TLS/HSTS/secure-cookie switches, nosniff/referrer/frame headers, login/API/AI throttling, request IDs, structured logs, optional Sentry without PII, fail-closed production PostgreSQL, non-root backend container, seed protection and audited AI actions.

Before real customer data: provision TLS/DNS/proxy, managed PostgreSQL with encryption/PITR, object storage, secret manager, SMTP, monitoring/alerts, dependency scanning, tested backups/restores and documented incident ownership. Review Django admin access, employee bank-field exposure, upload MIME/size controls, penetration testing and data-retention/legal obligations. Known product limitations include jurisdiction adapters and advanced consolidation features documented in the module matrix.
