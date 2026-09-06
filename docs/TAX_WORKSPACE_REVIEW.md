# Tax workspace implementation review

## Delivered

The Tax landing route and Indirect Tax page now provide output/input tax, adjustment and payable/refundable cards; configured due-date reminders; period selection; overview, sales, purchases, adjustments and filing-period views; search, rate, type, status and inclusion filters; sorting; shared pagination; transaction details; and totals covering every filtered row. Filters persist in URLs and organisation-specific session storage. Loading, empty, error and retry states are explicit.

Tax settings now shows effective dates, status, recoverability, usage and product defaults. Managers can add/edit rates and deactivate them with confirmation. Saves have duplicate-submission guards. Read-only members can inspect configuration. The API rejects invalid rates/date ranges, foreign-organisation control accounts and deletion of referenced rates.

Reports use shared organisation currency/date utilities. Printing includes organisation, period, filters, generation time, all filtered transactions and totals. Genuine OOXML Excel exports retain numeric amounts, signed credits/reversals, formatting, widths and totals. CSV includes report metadata; PDF metadata wraps to available width.

## Verified defects corrected

- The summary API validated rate/direction/status filters but discarded them when calling its service. Summary and activity now use one filtered reporting projection.
- Existing tax totals ignored journal reversals and journal eligibility. Original postings remain in their original period; a separate signed offset appears on the reversal date. Void/draft journal records do not contribute to totals. Original reversed entries are labelled separately from their reversal adjustments.
- Stored tax transactions contain document-currency amounts. Summing them directly could combine incompatible currencies. Reporting now translates with the saved posting exchange rate into organisation currency. Legacy credit journals lacking FX metadata use the source credit's saved rate. Missing foreign-currency rates produce an explicit error. No postings or historical tax records are rewritten.
- Deleting a used rate could reach a protected foreign-key failure. It now returns a useful validation error and directs users to deactivate.
- Generic workbook metadata had shifted the header below the fixed freeze/filter row. Header position now derives from the actual header row.

Credit notes and supplier credits retain their existing reducing signs. Payments do not create duplicate accrual tax. Nonrecoverable purchase tax remains expensed. The frontend does not calculate tax.

## Files for this task

Frontend:
- `src/pages/tax/VatReturnsPage.jsx`
- `src/pages/tax/TaxSettingsPage.jsx`
- `src/styles/taxWorkspace.css` (new)
- `src/utils/taxReport.js` (new)
- `src/services/taxApiService.js`
- `src/routes/AppRoutes.jsx`
- `src/routes/routeConfig.js`
- `src/utils/xlsxWorkbook.js`
- `src/utils/reportExport.js`
- `tests/taxWorkspace.test.mjs` (new)

Backend:
- `accounting-backend/apps/tax/services/register_service.py` (new)
- `accounting-backend/apps/tax/services/report_service.py`
- `accounting-backend/apps/tax/serializers.py`
- `accounting-backend/apps/tax/views.py`
- `accounting-backend/apps/tax/test_workspace.py` (new)

Documentation: this file. Earlier currency-audit changes remain in the working tree; this list does not attribute them to the Tax task.

## Verification

- `npm test`: 48 passing tests.
- `npm run lint`: passed.
- `npm run build`: passed; existing advisory about chunks larger than 500 kB remains.
- From `accounting-backend`: `PYTHONDONTWRITEBYTECODE=1 venv/bin/python manage.py test --noinput`: 126 passing tests, including accounting health-check reconciliations.
- `venv/bin/python manage.py check`: passed.
- `venv/bin/python manage.py makemigrations --check --dry-run`: no model changes detected.
- Final focused tax suite: 13 tests.
- Isolated Chrome checks used a temporary SQLite Django database, real invoice creation/approval services and a dated reversal. Verified 10 visible rows of 15, all 15 rows visible in print media, saved detail values, settings validation controls, filter preservation on settings/back navigation, and 390px mobile document width with table scrolling contained inside its wrapper. No application API responses were mocked.

Tests cover sales/purchases, payable/refundable totals, credits, reversals, void/draft eligibility, inclusive date boundaries, rate/filter validation, organisation isolation, permissions, historical snapshots, currency formatting and Excel ZIP/numeric contents. Frontend automated tests include utility and source-contract checks; browser checks supplement these, rather than constitute a full interactive end-to-end suite.

## Limits and manual review

The backend has configured filing periods and statuses, but no genuine electronic submission/finalisation workflow, payment-obligation reconciliation or supported manual tax-adjustment creation service. The UI does not invent these actions. Existing adjustment records can be reviewed. Inclusion denotes report eligibility, not a filed-return assignment. Defaults exist on products, not as one global tax rate.

The register currently loads all organisation tax records for projection, and the UI paginates the filtered result locally. Large ledgers would benefit from a dedicated paginated reporting query and server export job. Rate usage checks also issue related-record queries. No database schema migration was added by this Tax task.

Print-media content and visibility were verified; native printer pagination/blank-page behaviour and opening the workbook in desktop Excel still require manual review on the target machine. The available browser host did not provide native PDF printing during the earlier currency review.

Suggested review:
1. Select an organisation and period containing invoices, bills and both credit types; compare output/input/net cards with source postings and the tax control accounts.
2. Reverse a posting in a later period; inspect the original and later periods separately and together.
3. Exercise search, each filter, sorting, page two and the detail dialog; navigate to settings and back.
4. Try a period without activity and an unavailable API; confirm empty/error/retry behaviour.
5. As a manager, create a rate, reject invalid dates/percentages, cancel/confirm deactivation, and verify posted snapshots remain unchanged. Repeat as a read-only member.
6. Print a multipage report and open Excel/CSV exports; compare all filtered rows, metadata, signs and totals. Check desktop, tablet and mobile layouts.

No changes were committed or pushed.
