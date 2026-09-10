# Phase 1 security implementation and verification

**Status: Phase 1 implemented and locally verified. Deployment prerequisites remain manual.**

Date: 10 September 2026. Scope: the 9 September production-readiness audit findings C1, C2, H1, M1 and M2, as requested. This is the Phase 1 implementation report, not a new public-launch approval. The full launch verdict remains **NOT READY** until the other audit blockers are addressed.

## Changes and enforced rules

- Consolidation defaults off in both applications. Every registered consolidation API view checks `ENABLE_CONSOLIDATION` before DRF authentication, permissions or organisation queries. Disabled requests return 404, including malformed bearer/header values and write/action methods. Navigation and settings links are conditional; direct workbench and settings URLs redirect before the page mounts.
- When enabled, consolidation requires the existing `MANAGE_CONSOLIDATION` permission in the parent and every source organisation, with active user, organisation and membership. The existing role table is unchanged: owners, admins and accountants have that permission; other roles without it cannot participate. Endpoint action permissions still apply independently.
- Serializers reject foreign groups, source organisations/accounts, target accounts, CTA accounts, periods and nested elimination organisations/counterparties. Existing ownership fields cannot be reassigned by PUT/PATCH. Report and preparation services also validate the persisted graph, including historical snapshots, cross-group period references, reversals and elimination lines. A suspicious historical graph blocks access pending review, even if the offending member is inactive. This intentionally fails closed rather than silently omitting an unauthorised source.
- Elimination create/update runs atomically. Invalid nested input or unbalanced lines roll back the parent and lines. Preparation already used an atomic transaction and now checks authorisation before creating any snapshots. Financial calculations and report aggregation formulas were not changed.
- `audit_consolidation_relationships` is always read-only. It reports group IDs and generic review reasons, using current creator permissions. It cannot prove historic authorisation or detect every relationship that was once unauthorised but is authorised now. It never deletes or repairs records. The local development database contained **0 groups** when checked; this says nothing about production records. Synthetic tests verify detection of an unauthorised member and preservation of records.
- Login now uses a functioning DRF `BaseThrottle` with atomic Redis counters for both client IP and a trimmed, case-folded account identifier. Cache keys hash identifiers. Successful and unsuccessful attempts consume the same limits; responses do not distinguish unknown accounts from bad passwords. Limits are fixed windows, default 10/minute per IP and per account, with 429 and `Retry-After`. A cache failure returns a generic 503 and does not bypass throttling.
- Django admin POST login uses the same limits, in addition to its existing CSRF/session protections. Forwarded IPs are ignored unless the immediate peer is in configured trusted proxy networks. The chain is walked from the trusted side to the first untrusted hop. Universal trust networks are rejected at startup.
- Production requires shared Redis. DEBUG development without a cache URL uses local memory. Production cannot silently fall back to per-worker local memory.
- Organisation FX gain accounts must be active, owned revenue/other-income accounts; loss accounts must be active, owned expense/other-expense accounts. Revaluations validate all supplied gain, loss and control accounts before calculation, including an account that would not be used for that particular gain/loss. Control classifications are receivable, payable or bank as appropriate. Settlement services also reject unsafe historical FX settings. The organisation serializer has no other writable account relationships.
- Manufacturing validates product, BOM, version, component, warehouse, WIP and variance-account ownership. Products must be active and inventory-tracked; warehouses/accounts must be active, and WIP must be an asset. BOM versions and components cannot change their owning BOM/version. Draft production orders may use another valid version of the same organisation/product. Model and service checks also reject persisted foreign relationships; nested output checks prevent disclosing their product details.
- Missing/nonexistent/unauthorised organisation headers remain 403. Malformed UUID headers now return 400. Consolidation group/period parameters and manufacturing/journal query UUIDs/dates are parsed before ORM filtering. Missing/invalid query values return 400; scoped missing records return 404 (some existing manufacturing business-rule paths use 400).

## Authentication and session revocation

`rest_framework_simplejwt.token_blacklist` is installed. Refresh rotation blacklists the original refresh token. Custom access authentication and refresh validation check the user's `auth_version`, active status and the existing password-hash revocation claim.

`POST /api/v1/auth/logout/` requires authentication and a JSON `refresh` token owned by that user. It blacklists the submitted refresh token and increments the user's session version. **Logout signs out all JWT sessions for that user**, not just one device. It also invalidates existing access tokens. A recently rotated but still signed/unexpired refresh can be submitted for logout, allowing a concurrent rotation to be revoked. A token belonging to another user cannot revoke that user's sessions.

Refresh and logout acquire the same PostgreSQL user-row lock. A competing refresh either fails or produces a successor invalidated by logout. Two simultaneous rotations produce exactly one successful successor. Password changes and successful resets invalidate access and refresh through the password-hash claim; inactive users cannot refresh. Existing pre-Phase-1 tokens lack the session-version claim and require a fresh login after rollout.

Frontend logout starts a session-generation barrier, consumes an already-running rotation only to revoke it, calls authenticated logout, and clears local state in `finally`, including network failures. If the access token expired, it obtains temporary credentials from the refresh endpoint solely for revocation, without saving them. New automatic refreshes are blocked while logout is pending, and late responses cannot restore the session or retry old requests. Authentication network waits have timeouts. Server revocation cannot be guaranteed when the server is unreachable; local sign-out still completes.

No token values or credentials were added to application logs. SimpleJWT's standard outstanding-token table stores refresh tokens; protect database access and backups accordingly. The existing generic password-reset response is preserved.

## Migration and rollout configuration

New migration: `accounting-backend/apps/accounts/migrations/0002_auth_version.py`, adding `User.auth_version` as a positive bigint, default 0. It depends on `accounts.0001_initial`. SimpleJWT supplies its own blacklist migrations; they are installed from the pinned package, not copied into this repository. Full test database creation successfully applied the application and blacklist migrations on SQLite and PostgreSQL. SQL generation and migration consistency checks passed. No migration was applied to the existing application database or any production database.

| Setting | Default / required action |
|---|---|
| `ENABLE_CONSOLIDATION` | Backend `false`; keep false for launch |
| `VITE_ENABLE_CONSOLIDATION` | Frontend build-time `false`; keep false in Vercel, then rebuild |
| `DJANGO_CACHE_URL` | Required for `DJANGO_DEBUG=false`; private Redis URL, preferably TLS where needed |
| `DRF_LOGIN_RATE` | `10/minute`, client-IP limit |
| `LOGIN_ACCOUNT_RATE` | `10/minute`, normalized-account limit |
| `TRUSTED_PROXY_CIDRS` | Empty; configure only verified Render/ingress peer networks |
| `AI_ENABLED`, `VITE_AI_ENABLED` | Existing flags remain default false |

Use separate Redis instances or logical databases for staging and production, with all workers in one environment sharing the same cache. Use a no-eviction policy and monitor capacity/connectivity: evicting counters weakens enforcement. Cache failures deny login; `/ready/` still checks only the database, so Redis needs its own operational monitoring. No Celery or subscriptions were introduced. Docker Compose now includes an internal Redis service and the required backend cache URL.

Render deployment variables and Vercel build variables require manual configuration; no provider settings were changed. Verify how the ingress overwrites/appends `X-Forwarded-For`, restrict direct backend access, and configure only its actual trusted peers. Empty trust settings are safe against spoofing but may put all clients behind one proxy into one IP bucket. Do not guess broad proxy ranges.

Before an authorised deployment:

1. Back up the database and verify restoration. Configure separate staging PostgreSQL/Redis, secrets, origins and SMTP.
2. Install `accounting-backend/requirements.txt` (adds `redis==6.4.0`). Review `python manage.py migrate --plan`, then run `python manage.py migrate` and `python manage.py collectstatic --noinput` in staging first.
3. Drain old backend workers and roll out the revocation-aware backend consistently. Do not keep workers that ignore session versions serving traffic. Existing users must log in again. A rollback to the old authentication code would remove this protection; prefer a forward fix and assess signing-key invalidation before any security rollback.
4. Keep both consolidation flags false. Build/deploy the frontend only after backend logout is available. Schedule `python manage.py flushexpiredtokens` daily for blacklist retention.
5. Run the read-only consolidation audit against the authorised environment. Review every finding with the affected owners; do not enable the module or automatically repair records.
6. Repeat the staging checks below before requesting approval to deploy. This document is not deployment authorisation.

## Tests, commands and results

All commands ran locally. Python project commands used `PYTHONDONTWRITEBYTECODE=1` to preserve tracked bytecode. Test databases were disposable. PostgreSQL 16 and Redis 8.2.1 ran only on loopback under `/tmp`; no deployed service was used.

| Command / check | Result |
|---|---|
| `accounting-backend/venv/bin/python accounting-backend/manage.py test apps.organisations.test_phase1_security --noinput` before implementation | 6 tests; all 6 failed, reproducing the attacks |
| `npm test` | 55 passed; 0 failures/skips |
| `npm run lint` | Exit 0 |
| `npm run build` | Exit 0; existing >500 kB chunk warning remains |
| From `accounting-backend`: `venv/bin/python manage.py test --noinput` | 163 discovered; 160 passed, 3 infrastructure-specific skips; 54.791 s |
| Same complete Django command with disposable PostgreSQL and Redis | 163 passed; 0 skips; 57.114 s |
| Focused security command with PostgreSQL/Redis, shown below | 37 passed; 0 skips; 24.089 s |
| `accounting-backend/venv/bin/python accounting-backend/manage.py makemigrations --check --dry-run` | Exit 0; no changes detected |
| `accounting-backend/venv/bin/python accounting-backend/manage.py sqlmigrate accounts 0002` | Exit 0; SQL reviewed |
| `accounting-backend/venv/bin/python accounting-backend/manage.py collectstatic --noinput` | Exit 0 |
| `accounting-backend/venv/bin/python accounting-backend/manage.py check --deploy` with development defaults | Exit 0 with 7 security warnings; not production-safe defaults |
| `check --deploy --fail-level WARNING` with explicit synthetic secure production configuration | Exit 0; no issues; does not verify deployed settings |
| `accounting-backend/venv/bin/python accounting-backend/manage.py audit_consolidation_relationships` | Checked 0, review 0; no records changed in local development DB |
| `node /tmp/ledgify-phase1-browser.mjs` | 6 browser checks passed, at 1440×1000 and 390×844, with synthetic authenticated API responses |
| `git diff --check` | Exit 0 |

Final focused command (run from repository root with isolated `DATABASE_URL` and `DJANGO_CACHE_URL`):

```sh
PYTHONDONTWRITEBYTECODE=1 accounting-backend/venv/bin/python accounting-backend/manage.py test \
  apps.organisations.test_phase1_security \
  apps.manufacturing.test_phase1_security \
  apps.accounts.test_phase1_concurrency \
  apps.accounts.test_phase1_shared_cache --noinput
```

The new backend tests cover unrelated organisations, parent/source role combinations, inactive memberships, member/mapping attacks, PUT/PATCH reparenting, historical leaks, atomic nested eliminations, report/preparation rejection, FX and manufacturing relationships, malformed identifiers, real login POST limits, expiry, generic failures, spoofed proxy headers, admin login, cache outages, token ownership, password resets/changes, inactive users and concurrent revocation. The Redis test starts eight independent Django worker processes and verifies the shared account limit. The two row-lock tests and Redis process test deliberately skip without their required infrastructure; all run in the PostgreSQL/Redis suite.

New frontend tests cover flags, route wiring, backend-first logout, network failures, late responses, pending rotations, blocking new refreshes during logout and expired-access-token logout. Browser checks rendered the real application with synthetic API data: workbench redirected to `/`, consolidation settings redirected to `/settings`, and dashboard/settings contained zero consolidation links and issued zero consolidation requests. They do not verify a deployed account or live data.

Intermediate failures were investigated rather than hidden: mixed-case login compatibility was corrected; a test-helper name collided with Django's `fixtures` attribute and was renamed; admin template testing required static collection; running discovery from the repository root found zero tests, so the complete suite was run from the backend directory. The first full PostgreSQL run found 15 nullable-join locking failures in existing inventory, reconciliation and manufacturing code. Nullable relations now load in separate queries, retaining primary-row locks and non-null joined locks; existing accounting tests pass unchanged. No formulas were changed. A synthetic production check initially reported the two optional HSTS subdomain/preload warnings; a separate all-secure synthetic configuration passed. Real HSTS choices still require verified domain coverage.

## Remaining risks and verification checklist

Phase 1 does not resolve the other launch audit findings: consolidation calculation limitations, wider accounting/report correctness, dependency remediation, privacy/terms/deletion, billing, backups/disaster recovery, file storage, email delivery and deployed monitoring still need their own work. Consolidation must remain disabled. The large frontend bundle warning remains. Browser token storage continues to use the existing localStorage architecture, so preventing XSS remains essential. This phase did not introduce a cookie-session redesign or a password-change UI. Generic reset response bodies do not eliminate email-delivery timing differences.

- [ ] Configure and verify actual staging/production PostgreSQL, Redis and trusted proxy boundaries; do not infer this from local passing tests.
- [ ] Apply all migrations in staging and production during the separately authorised rollout; confirm blacklist tables and `accounts.0002_auth_version` are present.
- [ ] Verify all backend workers use the new authentication class; old JWTs fail and a new login succeeds.
- [ ] Across at least two workers, exceed both login limits, confirm 429/Retry-After, wait for expiry and confirm successful login. Verify arbitrary forwarded headers cannot bypass the limits; verify admin login too.
- [ ] Verify known/unknown reset responses remain identical and an actual staging reset email works. Old access and refresh tokens must fail after reset.
- [ ] Rotate a token and reject reuse; log out and reject both old access and refresh; test inactive users, expired access at logout and concurrent logout/refresh.
- [ ] Keep consolidation off and confirm every API action returns 404, including invalid authentication. Direct frontend URLs must redirect with no consolidation requests.
- [ ] Only in an isolated test environment, enable consolidation and repeat foreign member/mapping/nested-line/period attacks; verify no partial writes or snapshots and test authorised owner/admin/accountant workflows.
- [ ] Run the read-only graph audit and review findings manually. Production records were not inspected here.
- [ ] Reject foreign FX and manufacturing IDs on POST/PUT/PATCH; confirm legitimate same-organisation operations still work.
- [ ] Run `check --deploy` with the actual deployment environment and resolve applicable warnings; confirm HTTPS, cookies, headers, origins and hostnames at the ingress.
- [ ] Schedule blacklist cleanup, monitor Redis availability/capacity, and complete the remaining commercial-launch audit work.

No deployment, GitHub push, commit or modification of real production data was performed.

## Changed file inventory

All paths are relative to the repository root. Generated `dist/`, collected static assets and virtual-environment files are ignored build/test outputs, not source changes.

### Backend authentication/configuration

- `accounting-backend/apps/accounts/authentication.py`
- `accounting-backend/apps/accounts/migrations/0002_auth_version.py`
- `accounting-backend/apps/accounts/models.py`
- `accounting-backend/apps/accounts/serializers.py`
- `accounting-backend/apps/accounts/test_phase1_concurrency.py`
- `accounting-backend/apps/accounts/test_phase1_shared_cache.py`
- `accounting-backend/apps/accounts/urls.py`
- `accounting-backend/apps/accounts/views.py`
- `accounting-backend/common/middleware.py`
- `accounting-backend/common/rate_limits.py`
- `accounting-backend/common/throttles.py`
- `accounting-backend/common/views.py`
- `accounting-backend/config/settings.py`
- `accounting-backend/config/urls.py`
- `accounting-backend/requirements.txt`

### Tenant relationships and PostgreSQL compatibility

- `accounting-backend/apps/accounting/views.py`
- `accounting-backend/apps/ai/tools/consolidation_tools.py`
- `accounting-backend/apps/banking/services/reconciliation/reconcile.py`
- `accounting-backend/apps/banking/services/reconciliation/unreconcile.py`
- `accounting-backend/apps/consolidation/management/commands/audit_consolidation_relationships.py`
- `accounting-backend/apps/consolidation/security.py`
- `accounting-backend/apps/consolidation/serializers.py`
- `accounting-backend/apps/consolidation/services.py`
- `accounting-backend/apps/consolidation/tests.py`
- `accounting-backend/apps/consolidation/views.py`
- `accounting-backend/apps/fx/account_validation.py`
- `accounting-backend/apps/fx/services/revaluation_service.py`
- `accounting-backend/apps/inventory/services/adjustments/create_adjustment.py`
- `accounting-backend/apps/manufacturing/models.py`
- `accounting-backend/apps/manufacturing/security.py`
- `accounting-backend/apps/manufacturing/serializers.py`
- `accounting-backend/apps/manufacturing/services/bom_service.py`
- `accounting-backend/apps/manufacturing/services/production_completion_service.py`
- `accounting-backend/apps/manufacturing/services/production_order_service.py`
- `accounting-backend/apps/manufacturing/test_phase1_security.py`
- `accounting-backend/apps/manufacturing/views.py`
- `accounting-backend/apps/organisations/serializers.py`
- `accounting-backend/apps/organisations/services/permission_service.py`
- `accounting-backend/apps/organisations/test_phase1_security.py`
- `accounting-backend/apps/purchases/services/payments/create_supplier_payment.py`
- `accounting-backend/apps/sales/services/payments/create_customer_payment.py`

### Frontend

- `src/config/featureFlags.js`
- `src/pages/settings/CompanySettingsPage.jsx`
- `src/routes/AppRoutes.jsx`
- `src/routes/FeatureRoute.jsx`
- `src/routes/routeConfig.js`
- `src/services/api.js`
- `src/services/authService.js`
- `src/services/authStorage.js`
- `src/services/sessionLifecycle.js`
- `src/store/AuthContext.jsx`
- `tests/phase1Security.test.mjs`

### Environment and documentation

- `.env.example`
- `accounting-backend/.env.example`
- `docker-compose.yml`
- `docs/PHASE1_SECURITY.md`
- `docs/PRODUCTION_CONFIGURATION.md`
- `docs/PRODUCTION_DEPLOYMENT.md`

