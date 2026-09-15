# Phase 3 / Phase 4 report correction checkpoint — 16 September 2026

The report presentation defect recorded in the 15 September checkpoint is corrected. This verification supplements `PHASE3_PHASE4_CHECKPOINT.md`; its earlier report-formatting observation is superseded by this document. It is a local engineering checkpoint, not a production deployment or Ghana certification.

## Cause and correction

The old shared printer constructed columns from arbitrary API keys and called `JSON.stringify` on nested values. Account serializer records consequently became wide cells containing internal fields. The PDF/CSV and generic workbook paths had similar object fallbacks.

`src/utils/reportPresentation.js` now defines explicit columns, scalar projections and sections for Trial Balance, P&L, Balance Sheet, Cash Flow, General Ledger, Account Details, receivables/payables aging, indirect-tax workpapers and bank reconciliation. Other operational exports retain scalar columns but exclude internal keys, UUID values and nested records. No report renderer falls back to serializing an object.

P&L retains its income, cost-of-sales, operating and other-income/expense sections. Balance Sheet retains current/non-current classifications. Existing section-sum formulas are represented with decimal-string arithmetic; backend ledger calculations, report totals, journal statuses, tax calculations and historical snapshots are unchanged. Negative balances use parentheses, zeros use `0.00`, and exact supplied decimal digits are retained by the print/PDF formatter. Existing specialised financial workbook calculations are unchanged.

Both visible Print buttons and export-menu Print use the same isolated document. Tables have weighted columns, wrapping account names, right-aligned numeric cells, repeating section/column headers, A4 page sizing and page numbers. Organisation identity is freshly loaded and the existing organisation-change guard remains in force. Account Details supplies the structured ledger, including opening/closing balances even when there are no transactions. Aging separates transaction currency from base amounts. Bank reports distinguish unavailable statements from completed reconciliation.

Tax reports use configured tax names instead of generated version codes. Reviewed tax PDFs show period/revision and human journal numbers instead of internal return/journal UUIDs and snapshot checksums. The machine-readable audit snapshot and its checksum remain unchanged. CSV exports retain organisation and currency metadata.

## Exact final results

| Verification | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Focused report presentation / workbook tests | 23 | 0 | 0 |
| Complete frontend tests | 75 | 0 | 0 |
| Accounting, finance and banking backend suites | 69 | 0 | 0 |
| Tax backend suite, including PDF ID regression assertions | 43 | 0 | 0 |
| Browser report actions / matching direct Print | 30 | 0 | 0 |
| Browser large/comparative/mixed-currency reports | 3 | 0 | 0 |
| Browser organisation switching | 4 | 0 | 0 |

Focused tests overlap the complete frontend suite; do not add those counts. Backend suites used disposable PostgreSQL and Redis. Lint, production build and `git diff --check` passed. The build retains the pre-existing warning about bundles larger than 500 kB.

Earlier development runs exposed and resolved two workbook compatibility failures (numeric invoice amount and tax filter metadata), an unused import, a missing synthetic bank fixture and a mobile test assertion that read hidden header text with `innerText`. These are not outstanding final failures. An automatic approval-review capacity error was resolved by retrying the authorized local browser command.

## Commands

From the repository root:

```sh
node --test tests/reportPresentation.test.mjs tests/exportWorkbook.test.mjs
npm test
npm run lint
npm run build
git diff --check
```

From `accounting-backend`, sequentially against disposable services:

```sh
PYTHONDONTWRITEBYTECODE=1 DATABASE_URL=postgresql://phase1@127.0.0.1:15432/phase1 DJANGO_CACHE_URL=redis://127.0.0.1:16379/0 venv/bin/python manage.py test apps.accounting apps.finance apps.banking --noinput
PYTHONDONTWRITEBYTECODE=1 DATABASE_URL=postgresql://phase1@127.0.0.1:15432/phase1 DJANGO_CACHE_URL=redis://127.0.0.1:16379/0 venv/bin/python manage.py test apps.tax --noinput
```

Browser verification reused the isolated `ledgify_checkpoint` database, Django on localhost:8185, Vite on localhost:5185 and headless Chromium CDP on localhost:9343 from the earlier checkpoint. Django uses its in-memory email backend. The private fixture JSON contains disposable authentication tokens and is deliberately not committed. The seed helper only permits the named disposable database.

```sh
export DOCUMENT_APP_URL=http://127.0.0.1:5185
export DOCUMENT_FIXTURE_FILE=/tmp/ledgify-checkpoint/doc-fixture.json
export DOCUMENT_ARTIFACT_DIR=/tmp/ledgify-report-final
PYTHONDONTWRITEBYTECODE=1 DATABASE_URL=postgresql://phase1@127.0.0.1:15432/ledgify_checkpoint DJANGO_CACHE_URL=redis://127.0.0.1:16379/3 accounting-backend/venv/bin/python scripts/seed-report-verification.py
node scripts/verify-report-print.mjs
node scripts/verify-report-stress.mjs
node scripts/verify-report-switch.mjs
PYTHONDONTWRITEBYTECODE=1 DATABASE_URL=postgresql://phase1@127.0.0.1:15432/ledgify_checkpoint DJANGO_CACHE_URL=redis://127.0.0.1:16379/3 accounting-backend/venv/bin/python scripts/verify-tax-workpaper-pdf.py
accounting-backend/venv/bin/python scripts/inspect-report-pdfs.py /tmp/ledgify-report-final
```

The tax PDF helper rolls back its export/audit database changes after writing the synthetic PDF. Browser scripts must run sequentially because they share one Chromium tab. The final checks also ran `git diff --cached --check` and reviewed the staged diff before committing.

## Rendered evidence

**31 PDFs, 53 pages:** 20 actual report prints (ten report types at 1440px and 390px), six stress/comparative/currency PDFs (browser print and PDF export), four organisation-switch prints, and one reviewed tax-return PDF.

Every page was rendered with PyMuPDF, checked for non-empty content and out-of-bounds text, and visually inspected using the nine contact sheets in `report-verification/`. All pages are A4. The inspector also rejects raw object markers, serialized internal metadata, internal UUIDs and footer-only pages, and verifies repeated headings in multipage Trial Balance outputs.

The 100-account long-name Trial Balance prints over seven browser pages and five exported-PDF pages, retaining every account and the supplied `100,010.00` total. The real synthetic ledger Trial Balance remains balanced at GHS `4,775.10`; P&L net profit remains GHS `1,599.10`; Balance Sheet assets and liabilities plus equity remain GHS `3,585.10`. Organisation switching shows GBP `125.00` on both debit and credit sides for the Bristol fixture and restores the Accra identity/GHS values when switched back. The mixed-currency aging example retains GBP `100.00` transaction outstanding and GHS `1,200.00` base outstanding without converting either value in the renderer.

`report-verification/pdf-inspection.json` records each page. Individual page PNGs can be regenerated with the inspector; the committed contact sheets contain every inspected page. PDFs and result JSON files are retained alongside test/build logs. Synthetic company/contact names in this evidence are test fixtures, not hard-coded application identities.

## Correction file inventory

Application presentation:

- `src/utils/reportPresentation.js`
- `src/utils/printReport.js`
- `src/utils/reportExport.js`
- `src/utils/xlsxWorkbook.js`
- `src/utils/taxReport.js`
- `src/components/reports/ReportExportMenu.jsx`
- `src/pages/accounting/LiveAccountingPages.jsx`
- `src/pages/accounting/AccountDetailsPage.jsx`
- `src/pages/tax/VatReturnsPage.jsx`
- `accounting-backend/apps/tax/returns.py`

Regression tests and verification helpers:

- `tests/reportPresentation.test.mjs`
- `accounting-backend/apps/tax/test_jurisdictions.py`
- `scripts/verify-report-print.mjs`
- `scripts/verify-report-stress.mjs`
- `scripts/verify-report-switch.mjs`
- `scripts/verify-tax-workpaper-pdf.py`
- `scripts/seed-report-verification.py`
- `scripts/inspect-report-pdfs.py`

Documentation/evidence: this file, `docs/report-verification/*`, and the PDF binary rule in `.gitattributes`.

## Checkpoint scope and limitations

The worktree was clean at the start of this correction. The existing local combined checkpoint `3b226afd9804df5144d54305a2b06d588fc1eba3` already contained the Phase 3 and Phase 4 implementation, migrations, documentation and tests. Updating that local checkpoint keeps the combined work together; no artificial split or unrelated feature work is included. Existing user work is preserved.

No unresolved defect was found in the tested report-formatting paths. The existing bundle-size warning and previously documented external launch prerequisites (including accountant/statutory review and unverified GRA portal-template support) remain. Browser verification used Chromium; this is not a claim of exhaustive support across every printer driver/browser or all possible customer datasets. No push, deployment or external email occurred.
