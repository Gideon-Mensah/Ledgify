# Phase 5 verification and handoff

Verification executed on 19 September 2026; handoff completed on 20 September 2026.

## Outcome

The Phase 5 implementation is locally verified. Production public registration must remain closed until the operational prerequisites below are satisfied. No production deployment, remote push or external email delivery occurred. Phase 5 changes remain uncommitted for review.

The authorised Tax Settings UI checkpoint was created first after 81 frontend tests, lint and build passed:

`a7bf34e7f1922b5e8d183865f87b169d20f035b7` — **Improve Tax Settings interface**

## Exact final results

| Verification | Passed | Failed/errors | Skipped | Evidence |
|---|---:|---:|---:|---|
| Complete Django suite, PostgreSQL + Redis | 294 | 0 | 0 | `/tmp/ledgify-phase5/backend-final.log`, 110.586 seconds |
| Focused Phase 5 suite | 53 | 0 | 0 | `/tmp/ledgify-phase5/focused-final.log`, 20.047 seconds |
| Complete frontend tests | 85 | 0 | 0 | `/tmp/ledgify-phase5/frontend-tests-final.log` |
| Browser checkpoints | 47 | 0 | 0 | `/tmp/ledgify-phase5/browser/results.json` |
| Frontend lint | Pass | 0 errors | — | `/tmp/ledgify-phase5/lint-final.log` |
| Frontend production build | Pass | 0 errors | — | `/tmp/ledgify-phase5/build-final.log` |
| Migration consistency | Pass | No changes detected | — | `/tmp/ledgify-phase5/migrations-check.log` |
| Synthetic secure deployment check | Pass | 0 issues, including warnings | — | `/tmp/ledgify-phase5/deploy-check.log` |
| Read-only email identity audit | Pass | 0 collision groups | — | `/tmp/ledgify-phase5/identity-audit.log` |
| Phase 5 tracked/untracked whitespace checks | Pass | 0 | — | Commands below |
| Whole-worktree `git diff --check` | Existing finding | 1 | — | `src/styles/taxWorkspace.css:96`: new blank line at EOF |

Focused tests are included in the complete Django total, not additional tests to add to it. The focused suite includes four PostgreSQL race tests (registration, verification, invitation acceptance and organisation creation) and a shared-Redis subprocess test. The complete suite also includes the two existing JWT concurrency tests and the existing eight-worker Redis login-limit test. None were skipped. The build retains the existing warning for minified chunks exceeding 500 kB; this is not a build failure.

Initial failures were resolved: sender validation rejected a valid display-name email; a new test referenced the wrong tax relation; existing authentication fixtures needed explicitly verified users; saved drafts lacked a PUT API helper; onboarding completion could race a redirect; and authentication scope could change during initial permissions loading. Final review also added explicit policy acceptance for legacy accounts and tenant-scoped invitation pagination, with regression tests. Relevant assertions were retained. The final runs above include the corrections. Repeated browser runs also reached the configured rate limit; only disposable Redis database 2 was cleared before the final reproducible run.

## Commands and environment

Working directory: repository root unless a subshell changes directory. PostgreSQL 16.10 (Homebrew) is disposable at `127.0.0.1:15433`, database `ledgify_phase5`, role `taxui`. Redis 8.2.1 is disposable at `127.0.0.1:16380`; test database 1, browser database 2, synthetic check database 3. Neither service is a customer/production data store.

```sh
export PYTHONDONTWRITEBYTECODE=1
export DATABASE_URL=postgresql://taxui@127.0.0.1:15433/ledgify_phase5
export DJANGO_CACHE_URL=redis://127.0.0.1:16380/1

accounting-backend/venv/bin/python accounting-backend/manage.py migrate --noinput
(cd accounting-backend && venv/bin/python manage.py test --noinput)
(cd accounting-backend && venv/bin/python manage.py test apps.accounts.test_phase5 --noinput)
npm test
npm run lint
npm run build
accounting-backend/venv/bin/python accounting-backend/manage.py makemigrations --check --dry-run
accounting-backend/venv/bin/python accounting-backend/manage.py audit_identity_emails

git diff --check
git diff --check -- . ':!src/styles/taxWorkspace.css'
```

Every untracked source/document file was additionally checked with `git diff --no-index --check /dev/null <file>`; no whitespace failures were reported. The user's existing `src/styles/taxWorkspace.css` change was not altered or included in the Tax Settings checkpoint.

Synthetic deployment check used the following Python environment construction. The random secret is generated in memory and is not written to this report or committed. The SMTP hostname is synthetic; this command performs no delivery:

```python
import os, secrets, subprocess, sys

env = {
    **os.environ,
    'PYTHONDONTWRITEBYTECODE': '1',
    'DATABASE_URL': 'postgresql://taxui@127.0.0.1:15433/ledgify_phase5',
    'DJANGO_CACHE_URL': 'redis://127.0.0.1:16380/3',
    'DJANGO_DEBUG': 'false',
    'DJANGO_SECRET_KEY': secrets.token_urlsafe(64),
    'DJANGO_ALLOWED_HOSTS': 'api.example.test',
    'FRONTEND_URL': 'https://app.example.test',
    'CORS_ALLOWED_ORIGINS': 'https://app.example.test',
    'CSRF_TRUSTED_ORIGINS': 'https://app.example.test',
    'DJANGO_SECURE_SSL_REDIRECT': 'true',
    'DJANGO_SESSION_COOKIE_SECURE': 'true',
    'DJANGO_CSRF_COOKIE_SECURE': 'true',
    'DJANGO_SECURE_HSTS_SECONDS': '31536000',
    'DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS': 'true',
    'DJANGO_SECURE_HSTS_PRELOAD': 'true',
    'DJANGO_TRUST_PROXY_SSL_HEADER': 'true',
    'REGISTRATION_ENABLED': 'true',
    'EMAIL_BACKEND': 'django.core.mail.backends.smtp.EmailBackend',
    'EMAIL_HOST': 'smtp.example.test',
    'DEFAULT_FROM_EMAIL': 'accounts@example.test',
    'EMAIL_USE_TLS': 'true',
    'TERMS_VERSION': 'synthetic-1',
    'PRIVACY_VERSION': 'synthetic-1',
    'TERMS_URL': 'https://app.example.test/terms',
    'PRIVACY_URL': 'https://app.example.test/privacy',
    'AI_ENABLED': 'false',
    'ENABLE_CONSOLIDATION': 'false',
    'ENABLE_GRA_EVAT': 'false',
}
raise SystemExit(subprocess.run([
    sys.executable, 'accounting-backend/manage.py', 'check',
    '--deploy', '--fail-level', 'WARNING',
], env=env).returncode)
```

Executed with `accounting-backend/venv/bin/python`.

Browser services and verification:

```sh
PYTHONDONTWRITEBYTECODE=1 \
DATABASE_URL=postgresql://taxui@127.0.0.1:15433/ledgify_phase5 \
DJANGO_CACHE_URL=redis://127.0.0.1:16380/2 \
DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost \
CORS_ALLOWED_ORIGINS=http://127.0.0.1:5187 \
FRONTEND_URL=http://127.0.0.1:5187 \
EMAIL_BACKEND=django.core.mail.backends.locmem.EmailBackend \
DEFAULT_FROM_EMAIL=accounts@example.test \
accounting-backend/venv/bin/python accounting-backend/manage.py runserver 127.0.0.1:8187 --noreload

VITE_API_BASE_URL=http://127.0.0.1:8187/api/v1 \
npm run dev -- --host 127.0.0.1 --port 5187 --strictPort

PYTHONDONTWRITEBYTECODE=1 \
DATABASE_URL=postgresql://taxui@127.0.0.1:15433/ledgify_phase5 \
DJANGO_CACHE_URL=redis://127.0.0.1:16380/2 \
FRONTEND_URL=http://127.0.0.1:5187 \
EMAIL_BACKEND=django.core.mail.backends.locmem.EmailBackend \
DEFAULT_FROM_EMAIL=accounts@example.test \
node scripts/verify-identity-browser.mjs
```

Chromium was connected through local CDP port 9343. Browser helper defaults and local-service guards are in the script. No real recipients or SMTP provider were used.

## Browser and visual inspection

The script completed new registration, locmem verification, login, all eight onboarding steps, draft save/reload, backward navigation, review/creation and welcome at **1440, 1024, 768 and 390px**. It checked keyboard navigation, step-heading focus, unchecked marketing/tax activation, removal of token fragments, no token-bearing localStorage data and no page-wide horizontal overflow at each checkpoint.

Ghana flows retained GHS/Africa/Accra and draft tax profiles. The 390px international flow selected GB, retained GBP and Custom/International, and omitted Ghana registration controls. The mobile invitation flow authenticated the verified international account, reviewed and accepted the Ghana organisation invitation, and selected the correct invited organisation. The 1024px flow additionally simulated a legacy account without a policy record and required explicit current-policy acceptance before setup. Invitation pagination was covered by a 51-row tenant-isolation regression. Backend tests separately cover a newly registered invited user, mismatched emails, expired/revoked tokens, tenant-header/UUID attacks and duplicate/concurrent acceptance.

47 screenshots were generated. Nine representative screenshots were manually viewed: desktop review/welcome, 1024px regional settings and legacy-policy acceptance, 768px Ghana tax setup, and 390px registration/business identity/international tax/invitation review. Text and controls were readable, long forms scrolled vertically, no inspected page had clipped page-wide content, and the invitation review retained the correct organisation identity. No PDF work was needed for this phase; financial-document generation remains covered by the complete existing backend/frontend tests.

## Security and data guarantees verified

- New valid registrations create one unverified account and versioned policy acceptance, never an organisation. Case/whitespace variants are protected by PostgreSQL uniqueness; simultaneous case variants create one account.
- Unknown, wrong-password, inactive and unverified logins share failure responses and perform password hashing. JWT access/refresh rejects unverified users and preserves session-version/rotation/revocation checks.
- Verification tokens are hashed, expiring and single-use. Concurrent consumption has one winner. Email changes revoke sessions and require new verification. Password reset tokens cannot substitute for verification tokens.
- Email intent status reaches sent only when the configured backend accepts one message. Production console/locmem and unsafe frontend origins are rejected. Named senders are supported; header injection is rejected. Provider details and raw identity tokens are not logged/exported to monitoring.
- Invitation role assignment, current inviter authority, last-owner preservation and matching verified email are enforced server-side. Cross-organisation IDs/headers fail safely; existing roles are not overwritten by acceptance.
- Onboarding rollback leaves no organisation, accounts or partial draft completion. Identical concurrent/retried requests return one organisation. Changed payload/key retries fail. Draft progress is private to the authenticated user.
- Ghana obligations do not activate without explicit confirmation. International choices cannot install Ghana profiles/codes. Initial open periods and required protected accounts are created atomically; zero opening balances create no journals.
- Cleanup removes expired secrets/abandoned drafts while retaining audit/policy history. Business-detail edits create safe before/after audit records.

## Remaining launch prerequisites and limitations

1. Supply approved Terms/Privacy URLs and immutable version IDs. The clarification has not been answered; development placeholders are not commercial policies. Keep production registration disabled until these exist.
2. Configure real SMTP credentials, production sender/frontend origin, a supervised `deliver_identity_emails --loop` worker, inbox/bounce verification and queue/failure alerts. Locmem acceptance does not establish production deliverability.
3. Schedule `cleanup_identity`, approve retention/IP policy and verify production backup/restore. This phase does not implement a complete customer-account erasure or consent-withdrawal workflow.
4. Audit existing email collisions before applying migrations. Existing unverified accounts must verify; do not silently mark them verified. Existing accounts without a policy acceptance must explicitly accept the configured current policies on the welcome step; this was verified using a synthetic legacy-account fixture.
5. The existing large-bundle build warning remains. The preserved CSS blank-line finding is unrelated to Phase 5.

No unresolved critical test failure remains. This report is local implementation verification, not a public-launch approval or a claim that production infrastructure has been checked.

AI, consolidation and GRA E-VAT defaults remain false in frontend/backend configuration; no enabling flag or connector was added. No subscription payments or GRA certification claim was added. Nothing was pushed or deployed.

## Changed files

The following paths constitute Phase 5 work. `src/styles/taxWorkspace.css` is a separately preserved user change and is excluded from this list.
- `accounting-backend/.env.example`
- `accounting-backend/apps/accounting/serializers.py`
- `accounting-backend/apps/accounting/views.py`
- `accounting-backend/apps/accounts/apps.py`
- `accounting-backend/apps/accounts/authentication.py`
- `accounting-backend/apps/accounts/backends.py`
- `accounting-backend/apps/accounts/checks.py`
- `accounting-backend/apps/accounts/identity.py`
- `accounting-backend/apps/accounts/identity_throttles.py`
- `accounting-backend/apps/accounts/identity_views.py`
- `accounting-backend/apps/accounts/management/__init__.py`
- `accounting-backend/apps/accounts/management/commands/__init__.py`
- `accounting-backend/apps/accounts/management/commands/audit_identity_emails.py`
- `accounting-backend/apps/accounts/management/commands/cleanup_identity.py`
- `accounting-backend/apps/accounts/management/commands/deliver_identity_emails.py`
- `accounting-backend/apps/accounts/migrations/0003_emailverification_identityemailattempt_and_more.py`
- `accounting-backend/apps/accounts/migrations/0004_identityemailattempt_invitation_and_more.py`
- `accounting-backend/apps/accounts/models.py`
- `accounting-backend/apps/accounts/serializers.py`
- `accounting-backend/apps/accounts/test_phase1_concurrency.py`
- `accounting-backend/apps/accounts/test_phase5.py`
- `accounting-backend/apps/accounts/tests.py`
- `accounting-backend/apps/accounts/urls.py`
- `accounting-backend/apps/accounts/views.py`
- `accounting-backend/apps/organisations/invitation_services.py`
- `accounting-backend/apps/organisations/invitation_views.py`
- `accounting-backend/apps/organisations/migrations/0009_organisation_accounting_start_date_and_more.py`
- `accounting-backend/apps/organisations/models.py`
- `accounting-backend/apps/organisations/onboarding.py`
- `accounting-backend/apps/organisations/onboarding_views.py`
- `accounting-backend/apps/organisations/serializers.py`
- `accounting-backend/apps/organisations/test_phase1_security.py`
- `accounting-backend/apps/organisations/urls.py`
- `accounting-backend/apps/organisations/views.py`
- `accounting-backend/common/identity_telemetry.py`
- `accounting-backend/config/settings.py`
- `docs/PHASE_5_PUBLIC_ACCESS.md`
- `docs/PHASE_5_VERIFICATION.md`
- `scripts/verify-identity-browser.mjs`
- `src/components/auth/ChangeEmailForm.jsx`
- `src/components/auth/InvitationManager.jsx`
- `src/components/auth/SetupChecklist.jsx`
- `src/pages/auth/AcceptInvitationPage.jsx`
- `src/pages/auth/LoginPage.jsx`
- `src/pages/auth/OrganisationSelectionPage.jsx`
- `src/pages/auth/PublicRegistration.jsx`
- `src/pages/dashboard/DashboardPage.jsx`
- `src/pages/onboarding/OnboardingPage.jsx`
- `src/pages/settings/CompanySettingsPage.jsx`
- `src/routes/AppRoutes.jsx`
- `src/routes/ProtectedRoute.jsx`
- `src/services/api.js`
- `src/store/AuthContext.jsx`
- `src/styles/publicAccess.css`
- `src/utils/identityLinks.js`
- `src/utils/onboarding.js`
- `tests/phase5Identity.test.mjs`

57 Phase 5 paths remain modified/untracked. No Phase 5 commit was requested or created.
