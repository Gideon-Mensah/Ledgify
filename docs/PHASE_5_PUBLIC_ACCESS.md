# Phase 5: public access and first organisation setup

## Rollout gate

No deployment is performed by this implementation. Keep `REGISTRATION_ENABLED=false` in production until approved Terms/Privacy URLs and version identifiers, production SMTP, a supervised identity-email worker and a retention schedule are configured. Development legal pages are explicitly placeholders, not approved policies. The deployment check validates enabled registration configuration; it cannot prove SMTP delivery, policy approval or worker availability.

Before migration, take and verify a database backup and run `python manage.py audit_identity_emails`. The read-only command reports collision counts and user UUIDs, never email values. Migration accounts/0003 refuses case-insensitive collisions instead of merging users. Resolve ownership separately before retrying. Migration normalises stored addresses, preserves verified flags and adds a PostgreSQL unique expression on lower(trim(email)). Existing unverified accounts must verify through the resend flow; they are deliberately not grandfathered into commercial access. Existing superusers also need verified email to access Django admin. Do not bulk-mark customer accounts verified.

Run `python manage.py migrate`, `python manage.py makemigrations --check --dry-run` and `python manage.py check --deploy` with the actual environment before enabling registration. Keep independent PostgreSQL databases, Redis instances/namespaces, secrets, policy configuration and frontend origins for staging and production. Do not point verification scripts at customer data.

## Workflows and access rules

`/register` obtains a signed, expiring, single-use challenge bound to the client IP. Accessible required fields and a honeypot supplement Redis IP and normalised-email limits. Both new and duplicate valid requests do password-hashing work and return the same 202 message. Registration creates the user, a versioned policy acceptance and an email intent in one transaction; it creates no organisation. Marketing consent is separate and defaults false. IP retention defaults off and requires an explicit policy decision.

Verification and invitation secrets are random URL-safe tokens, hashed with SHA-256 in the database. Raw values exist only transiently in the worker and outgoing email. Frontend links use URL fragments, removed immediately with history.replaceState and held only in component/module memory. They are never stored in localStorage/sessionStorage. Explicit confirmation prevents mail scanners from consuming links. Invalid, expired, revoked and reused links return controlled responses. Error monitoring excludes identity requests and removes breadcrumbs/request bodies/stack locals. Proxy/access logging must not capture request bodies or authorization headers.

A user-row lock serialises verification; success consumes its token, revokes all outstanding verification tokens and increments the session version. Email changes require password reauthentication, revoke sessions and require verification of the new address. Login, JWT access, refresh and admin authentication reject unverified or inactive accounts. Existing password-reset and logout/session-version/blacklist protections remain. Password reset does not verify an email address.

Owners can invite all supported roles. Administrators can invite only roles below administrator/owner. Membership APIs no longer bypass invitation acceptance. An authenticated, active, verified user must explicitly accept using the invited normalised email. Acceptance and membership creation share an organisation lock and preserve any existing membership role. Suspended memberships require administrator review rather than automatic reactivation. Resend/revoke and acceptance recheck current inviter authority. Token, organisation header and invitation UUID substitution cannot grant another tenant's access. Durable access audit events record invitation, membership, identity and onboarding changes without raw tokens.

Verified existing accounts without a recorded policy acceptance explicitly accept the configured current Terms and Privacy Policy on the welcome step; acceptance is recorded inside the final creation transaction. Invitation lists use tenant-scoped pages of 50 rather than truncating older invitations.

The first-organisation wizard stores incomplete progress in a private user-owned draft. Final confirmation, a UUID idempotency key and a payload digest are required. A user lock serialises retries. The organisation, owner, financial year, open period, selected accounts, tax profile, policy reference, setup checklist and audit event are created in one PostgreSQL transaction. Any failure rolls back everything. Reusing a completed key with a changed payload fails; a correct retry returns the same organisation. No data is copied from a previously selected organisation. Users already in an active organisation use organisation selection rather than this first-organisation wizard.

Ghana recommends GHS/Africa/Accra/en-GH, supports local/+233 phone input and GhanaPost GPS, and recommends a Ghana tax profile without activating it. VAT, income WHT, VAT WHT and PAYE declarations are explicit. Activation requires a separate confirmation. Ghana tax accounts are installed only on explicit Ghana-profile activation. The existing verified preset, review, activation, future override and tax calculation services are reused unchanged. Draft tax profiles remain available for accountant review; required tax setup stays visible on the checklist.

United Kingdom defaults are GBP/Europe/London/en-GB. Other countries require reviewed currency/timezone/locale and default to Custom/International. Country changes clear Ghana obligations and activation confirmation. International organisations cannot select Ghana charts/profiles. No Ghana tax codes are installed for international organisations. Initial zero balances create no journals. Additional accounts and opening data use the existing import/accounting workflows after setup. Required control accounts cannot be unprotected, reclassified, deactivated or deleted through the account API.

## Email operation

Use the existing Django `EMAIL_BACKEND`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, TLS/SSL and `DEFAULT_FROM_EMAIL` settings. `FRONTEND_URL` must be the configured HTTPS frontend origin with no path, credentials, query or fragment. Local HTTP is accepted only in development. Console/file/dummy delivery always fails closed; in-memory delivery is test/development only. Production requires configured SMTP. HTML and plain-text messages identify Ledgify and escape organisation names/messages.

Run a separate supervised process with the same database and email configuration:

```sh
python manage.py deliver_identity_emails --loop
```

The outbox contains intent/status only, not token-bearing message content. Workers acquire user/organisation locks before intent locks. Each intent moves from pending to sending before SMTP. Sent means the backend returned exactly one accepted message, not guaranteed inbox delivery. A provider error or zero acceptance is recorded safely. Ambiguous sending/failed attempts are not automatically retried; the user can request a fresh link after cooldown. Monitor pending age, failed count and stale sending attempts. Alert if pending age exceeds the delivery objective (recommended five minutes) or the supervised worker exits. Test actual inbox arrival and bounce handling operationally before launch; locmem tests do not verify provider delivery. Never reset sending to pending as a bulk retry.

Run the retention command daily:

```sh
python manage.py cleanup_identity
```

It expires invitations, deletes old expired verification tokens and delivery attempts, removes old revoked/expired invitations, strips old accepted invitation hashes/messages and deletes abandoned incomplete drafts. Durable access audit and policy records remain. Establish a legally approved retention/deletion policy for these durable records before commercial launch; this phase does not provide a full statutory account-erasure workflow.

## New environment variables

See `accounting-backend/.env.example` for defaults. `REGISTRATION_ENABLED` defaults false outside development. Set `TERMS_VERSION`, `TERMS_URL`, `PRIVACY_VERSION`, `PRIVACY_URL` to approved immutable policy publications. `POLICY_RECORD_IP` is optional and defaults false. Token lifetime, invitation lifetime, email cooldown, identity retention and abandoned-draft retention are configurable positive integers. Registration, verification and invitation rates use positive count/second|minute|hour|day values. Production Redis is mandatory and counters are shared across workers; cache failures deny requests rather than disabling limits.

## Models and migrations

- accounts/0003: email collision guard/normalisation and unique expression, EmailVerification, PolicyAcceptance, IdentityEmailAttempt.
- organisations/0009: business type/locale/accounting start; OrganisationInvitation, AccessAuditEvent, OnboardingDraft, OrganisationSetup.
- accounts/0004: cross-app foreign keys for email attempts and policy acceptance.

Organisation logos use the existing validated, size-limited canonical PNG representation stored privately in PostgreSQL; include them in database backup/restore. No public upload path or local ephemeral media directory is introduced.

## Verification

The release verification uses disposable local PostgreSQL/Redis, Django locmem email and Chromium CDP. Commands/results are recorded in `PHASE_5_VERIFICATION.md`. `scripts/verify-identity-browser.mjs` rejects non-local service URLs and exercises real forms at 1440, 1024, 768 and 390px, saves/reloads drafts, verifies messages through locmem, completes Ghana/international onboarding and accepts an invitation across organisations. Synthetic screenshots stay outside the tracked repository.

AI, consolidation and GRA E-VAT remain disabled by existing frontend/backend flags. No payment/subscription functionality or certification claims are added.
