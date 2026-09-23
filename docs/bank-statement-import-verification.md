# Bank statement import — implementation and verification

Date: 23 September 2026. Scope: bank-side ingestion, validation and review UI. No journal, invoice, bill, payment, tax or financial-report calculation changes. No commit, push or deployment.

## Architecture and formats

The existing live flow was `LiveBankImportPage` → `bankService` → organisation-scoped `BankImportViewSet` → `preview_bank_statement_import` / `commit_bank_statement_import`. It accepted CSV with a frontend-hard-coded Date/Description/Reference/Amount mapping. Preview records, v2 fingerprints, atomic bank-side import and the existing reconciliation engine were already present. The old standalone frontend `bankStatementImportServices.js` is not used by this live flow and remains unchanged.

This implementation extends that flow, not a second importer. CSV remains supported; XLSX is added using a bounded, values-only OOXML reader in the existing backend import package. No parser dependencies were added.

Supported input limits:

- UTF-8 CSV, optionally BOM-prefixed; comma, semicolon or tab delimiter; quoted fields supported.
- One-sheet XLSX with inline/shared strings, numeric values and common Excel date styles. ISO and supported text dates also work. Formulas must be replaced with values before upload.
- Default 5 MiB upload limit (`BANK_IMPORT_MAX_BYTES`) and 10,000 data rows (`BANK_IMPORT_MAX_ROWS`), at most 64 unique non-empty headers, each at most 255 characters.
- XLSX: maximum 2,000 ZIP members and 32 MiB total uncompressed contents. Encrypted archives, macros/executable parts, external links, XML entities and XML containing NUL bytes and malformed workbook structures are rejected. Arbitrary ZIP files are not accepted as XLSX statements.
- PDF, legacy XLS, OFX, QFX and QIF are intentionally unsupported: the project had no reliable parsers for them. The UI advertises CSV/XLSX only. Multi-sheet XLSX, non-UTF-8 CSV and formula-based workbooks should be exported to a single values-only CSV/XLSX sheet first.

## Canonical schema, aliases and template

`accounting-backend/apps/banking/services/imports/statement_schema.py` owns the field definitions, alias matching, template headers, example and available date formats. The frontend obtains this from the backend; it contains no duplicate CSV header list.

The downloaded BOM-prefixed CSV has headings only (no sample transactions):

```csv
Date,Description,Reference,Money In,Money Out,Balance,Currency,External ID
```

Amount and Transaction type are an alternative to Money In / Money Out, exposed by mapping rather than mixing two incompatible amount formats in the template.

| Field | Recognised headings, after trimming/case/punctuation normalisation |
| --- | --- |
| Date (required) | Date, Transaction Date, Posting Date, Value Date, Booked Date, Booking Date |
| Description (required) | Description, Details, Narrative, Transaction, Memo, Payee |
| Reference | Reference, Ref, Transaction Reference, Payment Reference |
| Amount | Amount, Transaction Amount |
| Transaction type | Transaction Type, Type, Credit Debit, CR DR, Direction |
| Money In | Money In, Credit, Credits, Deposit, Deposits, Paid In |
| Money Out | Money Out, Debit, Debits, Withdrawal, Withdrawals, Paid Out |
| Balance | Balance, Running Balance, Closing Balance |
| Currency | Currency, Currency Code, CCY |
| External ID | External ID, Transaction ID, Bank Transaction ID |

Only a unique matching column is automatically selected. Multiple matches are shown for user resolution. Manual mapping supports arbitrary bank headings. A column cannot map to two fields; unknown columns and missing required fields fail validation. Unmapped columns are ignored.

## Guided workflow and validation

1. **Upload:** select an active organisation-scoped bank account; see bank identity, statement currency and current aggregate ledger book balance. Drag/drop or keyboard-accessible file input, template download, example and plain-language instructions.
2. **Map columns:** inspect automatic aliases, edit labelled dropdowns and review sample values. Choose date format and amount sign interpretation when necessary.
3. **Review:** server-side validation; date, description, reference, money in, money out, balance and text status. Counts and All/Ready/Duplicates/Needs attention/Balance information filters. Invalid rows retain original source values (bounded to 1,000 characters per field) and a specific explanation. Fix mapping reruns preview before import.
4. **Import:** explicit account/count confirmation and acknowledgement. The server imports ready rows only; invalid, duplicate and informational rows are excluded. Submission is disabled while pending. Success is shown only after backend acceptance.
5. **Reconcile:** existing reconciliation and bank-transaction pages receive the selected account in the URL. The transaction page now honours that existing account-filter parameter. Matching remains the existing explicit, controlled workflow.

Preview responses contain at most 100 rows, with a scoped paginated row endpoint. Recent history is bounded to the latest 50 batches and excludes row contents. File bytes are uploaded to the backend, not parsed or copied into React state. No financial actions use browser localStorage; the existing authentication mechanism is unchanged.

### Dates, amounts and currency

- ISO `YYYY-MM-DD` is accepted, including normalised Excel dates. Unambiguous numeric day/month dates and English month names are recognised. `09/10/2026` is rejected in automatic mode until DD/MM/YYYY or MM/DD/YYYY is selected. Invalid calendar dates remain errors.
- Amount + Credit/CR/Money In/Deposit or Debit/DR/Money Out/Withdrawal maps explicitly to the internal direction. A negative amount with a credit direction is rejected.
- Signed Amount without a type requires an explicit positive-is-money-in or positive-is-money-out choice at the API/UI boundary. Existing internal callers retain their established explicit-format defaults.
- Separate Money In/Money Out columns must be non-negative; both populated with nonzero amounts, or both zero, are rejected.
- Decimal parsing is exact, limited to two decimal places. Grouping commas must be groups of three. Currency symbols, decimal commas, exponent notation, NaN, excessive precision and amounts outside the database decimal range are rejected rather than guessed/rounded.
- Missing currency uses the chosen bank account currency. A different currency rejects that row; no conversion is performed. Monetary UI uses the shared currency formatter and account currency. Book balance is labelled in organisation ledger currency.

### Duplicates and accounting safety

Existing v2 fingerprint compatibility and database uniqueness are retained. Bank external IDs are strong, case-sensitive duplicate identities scoped to organisation and bank. Full date/amount/direction/reference/description/currency combinations also flag possible duplicates; description alone is insufficient. Repeated indistinguishable rows without external IDs are held rather than automatically imported as multiple occurrences. The prior banking/concurrency tests were intentionally updated for this stricter behaviour.

Possible duplicates are conservatively skipped, including matching values with differing IDs; this release does **not** provide a force-import override. Legitimate indistinguishable transactions therefore require review/source disambiguation. This is a deliberate safety limitation, not automatic matching or deletion of existing data.

Commit retains the organisation transaction lock, bank/batch row locks, unique fingerprint and idempotent completed-batch retry. It rechecks external IDs and matching values at import time, so two previously valid previews cannot silently duplicate the same transaction. Changed bank currency or inactive bank status blocks import. Import services create BankTransaction rows only; they never create journals or change payments.

Opening/closing balance and brought/carried-forward descriptions are stored as information, not receipts. Source balances remain available in review metadata. Existing bank opening balances and ledger entries are never changed.

**Existing reconciliation prerequisite:** the reconciliation engine calculates statement balance from the bank profile's configured statement opening balance plus imported bank-side movements. The GHS regression therefore sets both the existing ledger opening balance and the already-configured bank statement opening balance to GHS 32,500, records the existing GHS 5,000 receipt, and imports the statement. It verifies GHS 37,500 book balance, GHS 37,500 statement balance, zero difference, and unchanged journals/payment count after accepting the suggested existing-payment match. An account with an unconfigured/incorrect statement opening balance will still require an accounting setup review; this ingestion change intentionally does not derive or repair that balance from uploaded data. Do not interpret the test as verification that a ledger opening alone configures the bank profile.

### Security and accessibility

All account lookups, preview batches, row pages and commits remain organisation-scoped, with existing view/import permissions. Tests deny cross-organisation account IDs, batch IDs, row URLs, commit URLs and changed organisation headers. Upload size, MIME, file signatures, CSV structure and spreadsheet contents are checked. Formula expressions/macros are never executed. The template exports fixed schema headings only; source text is rendered through React escaping rather than HTML or spreadsheet execution. Exceptions return helpful validation messages, not server paths.

The UI has labelled selects/file input, a step indicator, live progress/error messages, row-associated error explanations, semantic table headers, text status labels, keyboard focus indicators and confirmation. Account changes clear prior preview state; organisation changes remount the page and existing API protections reject stale organisation responses. Narrow previews scroll horizontally; dates and monetary columns retain readable widths.

## Changed files for this task

Backend:

- `accounting-backend/apps/banking/services/imports/statement_schema.py` — canonical schema, template, readers, alias/date/amount parsing.
- `accounting-backend/apps/banking/services/imports/csv_import.py` — existing preview/import service extensions and duplicate rechecks.
- `accounting-backend/apps/banking/models.py`
- `accounting-backend/apps/banking/migrations/0006_statement_import_review.py` — additive source values, statement balance, duplicate kind and information status. No financial-data rewrite.
- `accounting-backend/apps/banking/serializers.py` — upload validation, review fields, bounded preview responses.
- `accounting-backend/apps/banking/views.py` — schema/template/detection and paginated row actions.
- `accounting-backend/apps/banking/test_statement_import.py` — parser, API, tenant, import and reconciliation regressions.
- `accounting-backend/apps/banking/tests.py` — repeated-row expectations.
- `accounting-backend/apps/accounting/test_phase2_concurrency.py` — existing concurrent import regression expectations; no accounting implementation change.

Frontend:

- `src/pages/banking/BankStatementImportPage.jsx`
- `src/pages/banking/LiveProfessionalBankingPages.jsx` — replace only the old importer with the new component export.
- `src/styles/bankStatementImport.css`
- `src/services/bankService.js` — use existing API transport for new endpoints.
- `src/utils/bankImportPresentation.js`
- `src/components/banking/BankingTransactionsWorkspace.jsx` — initialise bank filter from the import destination link.
- `tests/bankImportPresentation.test.mjs`

Verification/documentation:

- `scripts/seed-statement-import-verification.py` — guarded disposable-database fixtures; generated session credentials go to a local permission-restricted temporary file, not source control.
- `scripts/verify-statement-import.mjs` — real local-backend browser workflow in an isolated browser context.
- `docs/bank-statement-import-verification.md`

Pre-existing work in Modal, RecordPaymentModal, LiveAccountingPages, generalLedger.css, verify-payment-focus.mjs and generalLedgerLayout.test.mjs was preserved.

## Verification commands and results

Commands run from the repository root unless `cd` is shown. PostgreSQL/Redis URLs refer to disposable local services, not production.

```sh
cd accounting-backend
PYTHONDONTWRITEBYTECODE=1 DATABASE_URL=postgresql://taxui@127.0.0.1:15433/ledgify_phase5 DJANGO_CACHE_URL=redis://127.0.0.1:16380/1 venv/bin/python manage.py test apps.banking apps.accounting.test_phase2_concurrency --noinput --keepdb -v 1
PYTHONDONTWRITEBYTECODE=1 DATABASE_URL=postgresql://taxui@127.0.0.1:15433/ledgify_phase5 DJANGO_CACHE_URL=redis://127.0.0.1:16380/1 venv/bin/python manage.py test --noinput --keepdb -v 1
PYTHONDONTWRITEBYTECODE=1 DATABASE_URL=postgresql://taxui@127.0.0.1:15433/ledgify_statement_browser DJANGO_CACHE_URL=redis://127.0.0.1:16380/1 venv/bin/python manage.py makemigrations --check --dry-run
cd ..
npm test
npm run lint
npm run build
git diff --check
```

New automated coverage: canonical populated template; renamed and arbitrary headers/manual mapping; split and signed amounts; CR/DR aliases; XLSX and native Excel dates; ISO/DD-MM/day-first/month-first/ambiguous dates; missing columns; invalid signs/types/amounts; decimals/large amounts; default/mismatched currency; exact and possible duplicates and repeated external IDs; independent preview/retry/concurrent commit; informational opening/closing balances; partial imports with original row errors; 100-row API pagination; cross-organisation IDs/headers/permissions; malformed/unsupported/MIME-mismatched files; macros/entities/external links/archive/row/byte limits. Frontend tests cover status labels, informational/rejected amount suppression, exact decimal preservation, dynamic currencies and server counts.

Final complete Django suite: **353 passed, 0 failed, 0 skipped** on PostgreSQL/Redis (124.179 seconds), including all concurrency tests and 26 new statement-import tests. The earlier focused banking/concurrency run passed 45 tests; the subsequently added workbook-security test is included in the final full suite. Frontend: **100 passed, 0 failed, 0 skipped**, including five new presentation tests. Lint and production build passed. No unresolved test failures remain.

An initial Django invocation from the repository root discovered zero tests; the reported complete totals come from the corrected command run inside `accounting-backend`, not that empty run.

Browser verification setup (create the dedicated `ledgify_statement_browser` database on local PostgreSQL first; run servers in separate terminals):

```sh
PYTHONDONTWRITEBYTECODE=1 DATABASE_URL=postgresql://taxui@127.0.0.1:15433/ledgify_statement_browser DJANGO_CACHE_URL=redis://127.0.0.1:16380/1 accounting-backend/venv/bin/python accounting-backend/manage.py migrate --noinput
PYTHONDONTWRITEBYTECODE=1 DATABASE_URL=postgresql://taxui@127.0.0.1:15433/ledgify_statement_browser DJANGO_CACHE_URL=redis://127.0.0.1:16380/1 accounting-backend/venv/bin/python accounting-backend/manage.py shell -c 'exec(open("scripts/seed-statement-import-verification.py").read())'
PYTHONDONTWRITEBYTECODE=1 DATABASE_URL=postgresql://taxui@127.0.0.1:15433/ledgify_statement_browser DJANGO_CACHE_URL=redis://127.0.0.1:16380/1 DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost CORS_ALLOWED_ORIGINS=http://127.0.0.1:5190 accounting-backend/venv/bin/python accounting-backend/manage.py runserver 127.0.0.1:8189 --noreload
VITE_API_BASE_URL=http://127.0.0.1:8189/api/v1 npm run dev -- --host 127.0.0.1 --port 5190 --strictPort
# Requires local Chrome DevTools Protocol at 127.0.0.1:9343.
node scripts/verify-statement-import.mjs
```

Browser results: four passing viewport scenarios (1440, 1024, 768, 390px), real CSV uploads/imports, XLSX preview, required sign choice, date-fix flow, error filters, current template download, 205-row paging, explicit import confirmation, keyboard access to upload action, selected bank retained in transactions/reconciliation, and GHS→GBP organisation switch resetting state. Zero browser console exceptions/errors or document-width overflow. Sixteen screenshots captured under `/tmp/ledgify-statement-browser`; representative desktop/mobile upload, mapping, review and success screenshots were visually inspected. Mobile date wrapping was corrected following inspection. Browser tests use fresh synthetic organisations; they do not send real statements or alter customer data.

Migration check: no changes detected. Frontend: 100 passed, 0 failed, 0 skipped. Lint passed. Production build passed with Vite's existing >500 kB chunk advisory. Diff whitespace check passed. Migration was applied only to disposable verification databases; application environments still need the normal migration step when these changes are later released.
