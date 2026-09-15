# Jurisdiction tax verification record

Verified locally on **14 September 2026**. No production database, external email transport, GRA portal or bank was used. See [the implementation report](PHASE4_JURISDICTION_TAX.md) for scope and remaining statutory gates.

## Final results

| Check | Exact command / configuration | Result |
|---|---|---|
| Focused tax suite, including remittance correction | From repository root: `accounting-backend/venv/bin/python accounting-backend/manage.py test apps.tax --noinput` with the test environment below | **43 tests passed, 15.130s**. `/tmp/ledgify-tax-fourteenth.log`. |
| Complete Django suite after final application changes | From `accounting-backend`: `venv/bin/python manage.py test --noinput` with the test environment below | **241 tests passed, 121.449s**. No system-check issues. Test database destroyed cleanly. `/tmp/ledgify-tax-full-release-candidate.log`. |
| Frontend tests | `npm test` | **63 passed, 0 failed, 0 skipped**, 178.365375ms test-runner duration. `/tmp/ledgify-tax-frontend-final.log`. |
| Frontend and browser-harness lint | `npm run lint` | **Passed**, no lint errors. `/tmp/ledgify-tax-lint-final.log`. |
| Production build | `npm run build` | **Passed**. Vite warns that some minified chunks exceed 500 kB; this performance warning is not suppressed. `/tmp/ledgify-tax-build-final.log`. |
| Fresh synthetic schema | `accounting-backend/venv/bin/python accounting-backend/manage.py migrate --noinput` with the synthetic database below | **Passed**, including tax migrations `0002`–`0006`. No production migrations. `/tmp/ledgify-tax-synthetic-migrate.log`. |
| Migration consistency | `accounting-backend/venv/bin/python accounting-backend/manage.py makemigrations --check --dry-run` with the synthetic environment | **No changes detected**. `/tmp/ledgify-tax-migrations-final.log`. |
| Read-only tax audit | `manage.py audit_tax_configuration`, additionally called inside a PostgreSQL `SET TRANSACTION READ ONLY` block with before/after row hashes | **Three synthetic organisations, no findings; all 119 model-table hashes unchanged**. `/tmp/ledgify-tax-audit-proof.log`. |
| Desktop and mobile tax/document workflows | `node scripts/verify-tax-workflows.mjs` | **21 checks passed**, including all five tax tabs at 1440px and 390px, preset comparison, future version draft, return preparation/review, invoice preview/save, print, local email and international isolation. |
| Mobile settlement lifecycle | `node scripts/verify-tax-settlement.mjs` after the preceding browser fixture workflow | **5 checks passed**, covering filing, evidence upload, allocated settlement, remittance reversal and amendment. |
| Invoice PDF | Chrome `Page.printToPDF`; extracted and rendered with PyMuPDF | **One nonblank page**, VAT 150, NHIL 25, GETFund 25, GHS 1,200 total and frozen synthetic tax/VAT identifiers. Visually inspected. |
| Workpaper PDF | Rendered “Download readable workpaper PDF” action; PyMuPDF extraction/render | **One nonblank page**, separate source/components, net 200, GL 200, reconciliation difference GHS 0.00 and internal-review notice. Visually inspected. |
| Whitespace | `git diff --check` | **Passed**. |

The complete suite also reported zero-difference accounting health checks for trial balance, balance sheet, AR/GL, AP/GL, inventory/GL, tax/GL, fixed assets/GL, payroll/GL and WIP/GL in its own demo fixture. Those checks do not validate any production organisation.

## Reproducible environment

Backend suite variables:

```sh
PYTHONDONTWRITEBYTECODE=1
DATABASE_URL=postgresql://phase1@127.0.0.1:15432/phase1
DJANGO_CACHE_URL=redis://127.0.0.1:16379/0
```

Use a disposable PostgreSQL 16 cluster with the synthetic `phase1` role and Redis 8.2.1 bound to loopback. Do not run concurrent Django suites against the same test-database name. The `phase1` connection is local test configuration, not production credentials.

The browser uses a separate freshly migrated database:

```sh
DATABASE_URL=postgresql://phase1@127.0.0.1:15432/ledgify_tax
DJANGO_CACHE_URL=redis://127.0.0.1:16379/2
EMAIL_BACKEND=django.core.mail.backends.locmem.EmailBackend
CORS_ALLOWED_ORIGINS=http://127.0.0.1:5184
PYTHONDONTWRITEBYTECODE=1
```

After creating/migrating that **empty disposable database**, run `accounting-backend/venv/bin/python scripts/seed-tax-verification.py` from the repository root with those variables. The script refuses a different host/name or an existing organisation. It creates synthetic Ghana VAT, international and no-tax organisations and writes private, short-lived browser tokens to a mode-0600 file under `/tmp`; it does not print token values.

Start Django at `127.0.0.1:8184`. Start Vite with `VITE_API_BASE_URL=http://127.0.0.1:8184/api/v1 npm run dev -- --host 127.0.0.1 --port 5184`. Use an isolated Chrome profile with remote debugging on loopback `9343`. Run the two browser scripts in order against that fixture. These scripts deliberately create records and are **not** intended for production or repeated use against arbitrary existing data. They support environment overrides for local URLs/fixture paths only; the harness rejects non-loopback URLs.

## Retained review artifacts

- [21 desktop/mobile workflow results](tax-verification/browser-results.json)
- [5 settlement lifecycle results](tax-verification/settlement-browser-results.json)
- [Synthetic posted invoice PDF](tax-verification/ghana-tax-invoice.pdf)
- [Synthetic VAT workpaper PDF](tax-verification/tax-review-workpaper.pdf)
- [390px profile screenshot](tax-verification/mobile-Profile.png)
- [390px return/settlement screenshot](tax-verification/mobile-return-settlement.png)

Detailed raw logs remain under `/tmp` and may disappear when the local runtime resets. The counts, commands, limits and review artifacts above are retained in the workspace. Artifacts contain synthetic identifiers only, not credentials or customer records.

## Failures encountered and resolved

- An earlier full run exposed an existing quote-acceptance test with an expiry fixed at 13 September 2026. The test now fixes its clock at its intended fixture date; production quote expiry rules were not weakened. The final full suite passed.
- Earlier tax-test iterations corrected a route name, fixture import and multi-version fixture selection. A threaded concurrency test initially left database connections open; workers now explicitly close their connections. Later focused/full runs completed with clean database teardown.
- A resumed run found that temporary PostgreSQL/Redis/browser services and `/tmp` artifacts had disappeared. The initial focused command failed with connection refused before exercising tests. Disposable services were recreated; subsequent PostgreSQL/Redis runs passed.
- The settlement browser harness initially selected a hidden adjustment “Reason” field instead of the visible modal field, then extracted only the first text node of a control-balance label. Its selectors were corrected; the application rejected the malformed payment and did not post it. The resumed rendered workflow passed.
- An earlier runtime interruption prevented one tool command from executing. No result is claimed for that command. Verification was rerun successfully after continuation.

## Coverage boundaries and required next evidence

- Backend permission/tenant checks include foreign IDs, immutable data and emergency role restrictions, plus the retained Phase 1/2 suites. This is not exhaustive formal proof of every possible tenant/role/action combination.
- Browser verification covers representative workflows at desktop/390px, not every field, device, browser, bulk dataset or role. API tests supply additional coverage for credits/debits, withholding, refunds, locking and FX.
- Email verification used the in-memory backend. It proves application submission/PDF construction, not public email delivery, SPF/DKIM or provider reliability.
- The small synthetic audit does not prove production migration compatibility, production performance or a backup restoration arrangement.
- No official GRA portal file acceptance, statutory accountant sign-off, production deployment check or E-VAT sandbox test occurred. Those gates remain explicit in the implementation report.
