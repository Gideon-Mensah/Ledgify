# Ledgify module status matrix

`READY` means evidence supports the implemented scope, not that every possible product feature exists.

| Module | Backend | Frontend | Tests | Accounting Integration | Security | Production Readiness | Outstanding Issues |
|---|---|---|---|---|---|---|---|
| Accounts/Auth | READY | READY | READY | N/A | READY | PARTIAL | Production settings and broader security tests |
| Organisations | READY | READY | PARTIAL | N/A | READY | PARTIAL | Expand tenant-injection matrix |
| Contacts | READY | READY | PARTIAL | PARTIAL | READY | PARTIAL | Limited dedicated tests |
| Accounting/Journal | READY | PARTIAL | READY | READY | READY | PARTIAL | Several active admin pages still localStorage-backed |
| Financial Reports | READY | READY | PARTIAL | READY | READY | PARTIAL | Add report golden/reconciliation coverage |
| Sales/AR | READY | READY | READY | READY | READY | PARTIAL | Legacy prototype services remain in source |
| Purchases/AP | READY | READY | READY | READY | READY | PARTIAL | GRNI needs dedicated reconciliation suite |
| Finance/Aging/Statements | READY | READY | PARTIAL | READY | READY | PARTIAL | Permission omission fixed; add role tests |
| Banking | READY | READY | READY | READY | READY | PARTIAL | Full lint debt in legacy banking components |
| Inventory/WAC | READY | READY | READY | READY | READY | READY | Add concurrency/query-count coverage |
| Manufacturing | READY | READY | READY | READY | READY | READY | API/UI test depth and scale indexes |
| Tax | READY | READY | READY | READY | READY | PARTIAL | Filing action and jurisdiction adapters incomplete |
| Payroll | READY | READY | READY | READY | READY | PARTIAL | Statutory adapters and sensitive-data controls |
| Fixed Assets | READY | READY | READY | READY | READY | PARTIAL | Cross-org update gap fixed; more API tests needed |
| FX | READY | READY | READY | READY | READY | READY | Next-period automation remains a future policy choice |
| Consolidation | READY | READY | READY | READY | READY | READY | NCI/equity/proportionate/CTA/cash flow intentionally unsupported |
| Frontend Platform | READY | READY | READY | READY | READY | READY | Lint 0/0; active accounting localStorage 0 |
| Deployment | READY | PARTIAL | PARTIAL | N/A | READY | PARTIAL | Environment foundation complete; real TLS/proxy/domain/email/database required |

## Milestone 16 production gate

All application modules pass the 55-test regression suite, migration drift, lint and production build gates. Repository production foundations are READY: PostgreSQL-only production configuration, static handling, Gunicorn/non-root backend image, frontend nginx image, compose, CI, health/readiness, throttling, structured logging, request IDs, optional Sentry, dependency pinning/audit, accounting health command and release/restore documentation.

Deployment remains `BLOCKED_EXTERNAL` until a real environment supplies and verifies managed PostgreSQL/PITR, object storage, TLS/DNS/proxy, SMTP, monitoring/error-tracking credentials, secret management and backup restoration. Jurisdiction-specific tax/payroll adapters and advanced consolidation features retain their prior product limitations.
