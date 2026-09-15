# Phase 3 + Phase 4 checkpoint verification

Verified **15 September 2026** against disposable local PostgreSQL 16 and Redis 8.2.1. No application features or fixes were added during this verification pass. No production data or external mail transport was used.

**Checkpoint gate: passed.** No critical test failed. This is a local checkpoint, not public-launch or statutory-filing approval. The report-export presentation issue below remains unresolved.

## Worktree scope and preservation

Inspected the complete uncommitted inventory: **69 tracked modifications and 68 new files, 137 files total**. All are Phase 3 customer documents/PDF/print/email/safe-correction work, Phase 4 jurisdiction/Ghana tax work, their shared integration, or associated tests/documentation/artifacts. **No unrelated or accidental modifications identified.**

The [per-file scope inventory](checkpoint-verification/worktree-scope.csv) includes original content hashes. All 137 hashes remained identical through verification. No user changes were discarded, rewritten or split. Only this checkpoint report, its verification evidence and binary attributes for verification PDFs were added afterward.

Changes that extend beyond folders named “documents” or “tax” are explained:

- Bank matching uses net cash after withholding, rather than gross payable settlement.
- Ghana payroll guards prevent unsupported statutory calculation/posting.
- Organisation fields hold document identity, registration and reviewed tax configuration.
- Shared routes, API handling, permissions and styles connect the document/tax workflows.
- Large frontend deletions replace prototype invoice/bill/PDF implementations with shared backend-backed documents.
- The sales quote test's fixed clock is a verification correction; production expiry logic is unchanged.
- Existing synthetic PDFs/screenshots and source registers are Phase 4 review evidence, not customer data or credentials.

## Exact final results

| Verification | Passed | Failed | Skipped | Duration |
|---|---:|---:|---:|---:|
| Complete Django suite | 241 | 0 | 0 | 88.144s |
| All Phase 3 document/email focused tests | 16 | 0 | 0 | 5.505s |
| All Phase 4 tax focused tests | 43 | 0 | 0 | 15.913s |
| Explicit PostgreSQL concurrency suite | 14 | 0 | 0 | 7.286s |
| Frontend tests | 63 | 0 | 0 | 266.829125ms |
| Phase 4 desktop/mobile workflows | 21 | 0 | 0 | — |
| Phase 4 filing/settlement/correction workflows | 5 | 0 | 0 | — |
| Phase 3 print/navigation/email/organisation switch | 7 | 0 | 0 | — |
| Comprehensive desktop/390px print actions | 22 | 0 | 0 | — |
| Additional access/disabled-certification probes | 5 | 0 | 0 | — |

Focused/backend counts overlap the full suite; they are reruns, not additional unique coverage. Browser total: **55 passed**. Additional access probes are reported separately.

Also passed:

- Frontend lint and production build. Build completed in 304ms and retains its >500 kB chunk warning.
- Fresh checkpoint database migrations; `makemigrations --check --dry-run`: **No changes detected**.
- Django `check --deploy --fail-level WARNING` under synthetic secure production settings: **0 issues**.
- Read-only tax audit: **four synthetic organisations, no findings, 119 model-table hashes unchanged**, inside a PostgreSQL read-only transaction.
- Runtime AI, consolidation and E-VAT flags: all false. E-VAT certification invocation rejected.
- `git diff --check`: no whitespace errors.

## Complete verification commands

Commands ran from the repository root unless `cd accounting-backend` is shown. PostgreSQL and Redis were loopback-only disposable services on ports 15432 and 16379. The full/focused suites ran sequentially to avoid sharing a live test database.

```sh
cd accounting-backend
export PYTHONDONTWRITEBYTECODE=1
export DATABASE_URL=postgresql://phase1@127.0.0.1:15432/phase1
export DJANGO_CACHE_URL=redis://127.0.0.1:16379/0
export EMAIL_BACKEND=django.core.mail.backends.locmem.EmailBackend
venv/bin/python manage.py test --noinput
venv/bin/python manage.py test apps.sales.test_documents --noinput
venv/bin/python manage.py test apps.tax --noinput
venv/bin/python manage.py test apps.accounts.test_phase1_concurrency apps.accounting.test_phase2_concurrency apps.sales.test_documents.EmailConcurrencyTests apps.tax.test_jurisdictions.TaxActivationConcurrencyTests --noinput
cd ..
npm test
npm run lint
npm run build
```

A new `ledgify_checkpoint` database was created; existing verification databases were preserved:

```sh
/opt/homebrew/opt/postgresql@16/bin/createdb -h 127.0.0.1 -p 15432 -U phase1 ledgify_checkpoint
export PYTHONDONTWRITEBYTECODE=1
export DATABASE_URL=postgresql://phase1@127.0.0.1:15432/ledgify_checkpoint
export DJANGO_CACHE_URL=redis://127.0.0.1:16379/3
accounting-backend/venv/bin/python accounting-backend/manage.py migrate --noinput
accounting-backend/venv/bin/python /tmp/ledgify-checkpoint/seed.py
accounting-backend/venv/bin/python accounting-backend/manage.py makemigrations --check --dry-run
EMAIL_BACKEND=django.core.mail.backends.locmem.EmailBackend CORS_ALLOWED_ORIGINS=http://127.0.0.1:5185 accounting-backend/venv/bin/python accounting-backend/manage.py runserver 127.0.0.1:8185 --noreload
VITE_API_BASE_URL=http://127.0.0.1:8185/api/v1 VITE_AI_ENABLED=false VITE_ENABLE_CONSOLIDATION=false VITE_ENABLE_GRA_EVAT=false npm run dev -- --host 127.0.0.1 --port 5185
```

The temporary `seed.py` is a copy of `scripts/seed-tax-verification.py` with only the disposable database guard changed to `ledgify_checkpoint` and private fixture destination changed to `/tmp/ledgify-checkpoint/fixture.json`. Its existing empty-database guard was retained. Additional bill/credit/long-invoice/GBP fixtures were created by `/tmp/ledgify-checkpoint/seed-documents.py` against that guarded database, after the tax settlement browser workflow completed.

Browser commands used an isolated headless Chrome profile with CDP on loopback port 9343:

```sh
DOCUMENT_APP_URL=http://127.0.0.1:5185 DOCUMENT_FIXTURE_FILE=/tmp/ledgify-checkpoint/fixture.json DOCUMENT_ARTIFACT_DIR=/tmp/ledgify-checkpoint/artifacts node scripts/verify-tax-workflows.mjs
DOCUMENT_APP_URL=http://127.0.0.1:5185 DOCUMENT_FIXTURE_FILE=/tmp/ledgify-checkpoint/fixture.json DOCUMENT_ARTIFACT_DIR=/tmp/ledgify-checkpoint/artifacts node scripts/verify-tax-settlement.mjs
accounting-backend/venv/bin/python /tmp/ledgify-checkpoint/seed-documents.py
DOCUMENT_APP_URL=http://127.0.0.1:5185 DOCUMENT_FIXTURE_FILE=/tmp/ledgify-checkpoint/doc-fixture.json DOCUMENT_ARTIFACT_DIR=/tmp/ledgify-checkpoint/print-artifacts node /tmp/ledgify-checkpoint/verify-all-print.mjs
DOCUMENT_APP_URL=http://127.0.0.1:5185 DOCUMENT_FIXTURE_FILE=/tmp/ledgify-checkpoint/doc-fixture.json DOCUMENT_ARTIFACT_DIR=/tmp/ledgify-checkpoint/phase3-artifacts node scripts/verify-document-print.mjs
accounting-backend/venv/bin/python scripts/inspect-document-pdfs.py /tmp/ledgify-checkpoint/print-artifacts
accounting-backend/venv/bin/python scripts/inspect-document-pdfs.py /tmp/ledgify-checkpoint/artifacts
accounting-backend/venv/bin/python scripts/inspect-document-pdfs.py /tmp/ledgify-checkpoint/phase3-artifacts
accounting-backend/venv/bin/python /tmp/ledgify-tax-audit-proof.py
DJANGO_ALLOWED_HOSTS=testserver accounting-backend/venv/bin/python /tmp/ledgify-checkpoint/access-check.py
git diff --check
```

The audit wrapper invokes `call_command('audit_tax_configuration')` inside `SET TRANSACTION READ ONLY` and compares before/after hashes for all 119 model tables. The access script checks four foreign-organisation endpoints and rejects an E-VAT certification call. Temporary scripts contain synthetic fixture operations only; private JWT fixture files were excluded from the checkpoint.

Deployment check command: `accounting-backend/venv/bin/python accounting-backend/manage.py check --deploy --fail-level WARNING`, launched through Python `subprocess.run` with:

```text
PYTHONDONTWRITEBYTECODE=1
DATABASE_URL=postgresql://phase1@127.0.0.1:15432/ledgify_tax
DJANGO_CACHE_URL=redis://127.0.0.1:16379/3
DJANGO_DEBUG=false
DJANGO_SECRET_KEY=<generated in memory with secrets.token_urlsafe(64); never printed>
DJANGO_ALLOWED_HOSTS=checkpoint.example.invalid
CORS_ALLOWED_ORIGINS=https://checkpoint.example.invalid
CSRF_TRUSTED_ORIGINS=https://checkpoint.example.invalid
DJANGO_SECURE_SSL_REDIRECT=true
DJANGO_SESSION_COOKIE_SECURE=true
DJANGO_CSRF_COOKIE_SECURE=true
DJANGO_SECURE_HSTS_SECONDS=31536000
DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS=true
DJANGO_SECURE_HSTS_PRELOAD=true
EMAIL_BACKEND=django.core.mail.backends.locmem.EmailBackend
AI_ENABLED=false
ENABLE_CONSOLIDATION=false
ENABLE_GRA_EVAT=false
```

This verifies Django's security checks, not actual HTTPS deployment, external email delivery or provider configuration. In-memory email is deliberately unsuitable for production acceptance; the Phase 3 test verifies that production email cannot falsely report success with that backend.

## Print, browser and rendered-page inspection

**39 PDFs / 81 pages inspected automatically: zero blank pages and zero out-of-bounds text pages.**

- Comprehensive print run: 30 PDFs / 72 pages, including eight server-generated documents and 22 browser print outputs.
- Tax run: two PDFs / two pages.
- Phase 3 run: seven PDFs / seven pages, including print after loading journal/report/banking modules, GHS/GBP identity switching and local email submission.
- Visually inspected invoice, bill, customer credit, customer statement, trial balance, and first/last pages of long browser/server invoices. Totals, repeated headers and page numbering are present. Long invoice: 11 browser pages and eight server pages.
- Every PDF uses the saved synthetic organisation identity. No legacy fictitious company identity or fabricated certification details appeared. Synthetic test organisations are intentionally labelled as such.
- Report print actions were invoked from the actual export menu. Their generated iframe document was captured and rendered, rather than printing an unrelated page.

**Noncritical defect:** the report export menu's generic print path serializes nested account objects as JSON. The trial balance is nonblank and retains amounts, but wraps internal account metadata across a wide three-page table. See [the captured example](checkpoint-verification/report-formatting-observation.pdf). This should be improved before treating that export as a polished customer-facing report. It was not changed in this verification-only pass.

## Explicit safety checks

| Requirement | Evidence / result |
|---|---|
| No blank printed documents | All 81 tested pages contain text; representative pages visually inspected. This is fixture coverage, not proof about every possible input. |
| No fictitious company information | Generated outputs match saved synthetic organisation identities; shared backend `identity()` and organisation-aware report exports supply customer identity. |
| Active financial actions do not use localStorage | Static import traversal from `src/main.jsx` found 133 reachable JS modules. Only `authStorage.js` and the selected-organisation currency reader reference localStorage. Legacy financial storage services remain unreferenced by the active graph. |
| Email success requires backend acceptance | `SourceDocumentPage` accepts only backend `status=sent`; Phase 3 tests cover rejection, transport failure, replay, permissions, HTML escaping and concurrent submission. Browser email uses the in-memory backend. |
| Cross-organisation document/email/tax access fails | Separate direct probes returned 404 for foreign invoice PDF/email, tax return and tax-code version creation; retained focused/full tests cover additional permissions and header/ID isolation. |
| Ghana base and amounts | Tested 1,000 exclusive / 1,200 inclusive: VAT 150, NHIL 25, GETFund 25; each component uses the same base. Separate control postings and GL reconciliation pass. |
| Classifications distinct | Tax tests preserve STANDARD/ZERO/EXEMPT/OUT_SCOPE and reasons; zero tax does not erase classification. |
| Historical snapshots and organisation overrides | Tax tests cover prospective overrides, immutable original snapshots, linked credit/debit treatment, FX reversals, preset isolation, registration migration and local/leap-day boundaries. |
| Unapproved/unverified rules cannot post | Pending statutory WHT stays inactive; approved effective windows select transactional rates; draft comparison previews are explicitly non-posting. |
| Filed returns immutable | Database-guard and lifecycle tests reject snapshot edits/reopening; corrections create open-period adjustments or separate amendment revisions. |
| WHT portal export truthfulness | Current DT110/ITAS adapter remains unavailable; review CSV is explicitly `NOT_GRA_UPLOAD`, reconciled and not filing. |
| E-VAT, AI and consolidation disabled | Backend flags checked false; direct AI/consolidation routes guarded in browser; E-VAT connector reports disabled and rejects certification calls. |
| No GRA certification claim | No positive certification claim in reviewed active UI/document paths or generated PDFs; reserved fields/protocols do not fabricate official responses. |

## Unresolved items and scope limits

1. **Noncritical report-print presentation defect** described above; no blank output or accounting mutation observed.
2. **Build performance warning:** some chunks exceed 500 kB; build passes.
3. **Existing statutory gates:** current official WHT portal template/schedules, VAT-withholding transition and accountant applicability approval remain pending. No misleading adapter was activated.
4. **Existing rollout gates:** restored-production-data migration/audit, quotation/order conversion review after tax-profile migration, external mail/monitoring/backup verification and operational launch sign-off remain outside this disposable checkpoint.

Harness issues resolved without application edits: the temporary print script initially had a quoting syntax error; the standalone API probe initially omitted `testserver` from allowed hosts; an optional inspection command used system Python rather than the project virtualenv. The staged whitespace check also detected CRLF in the new inventory CSV and an ASCII-encoded PDF treated as text; the CSV was normalized to LF and verification PDFs marked binary without changing their bytes. Corrected final runs passed. No critical application test failed.

## Checkpoint instruction

Authorised local commit message:

```text
Add production documents and jurisdiction tax engine
```

The combined commit intentionally preserves overlapping Phase 3/4 files. No artificial split, reset or production change was performed. The final response records the resulting commit hash and post-commit worktree status. **No push or deployment was performed.**

Machine-readable [results](checkpoint-verification/results.json), [scope inventory](checkpoint-verification/worktree-scope.csv), and browser/access evidence are retained with this report. Raw logs and the full rendered-image set remain under `/tmp/ledgify-checkpoint`; temporary runtime files may be removed by the environment later.
