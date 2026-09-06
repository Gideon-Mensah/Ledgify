# Currency audit and fixes

The active invoice routes now use the selected organisation's currency when an invoice has no separate currency. A GHS organisation's invoice displays Ghanaian cedi formatting; an explicitly GBP invoice still displays GBP. No commits, pushes, deployments, emails, or production-data changes were performed. Git status was clean at the start.

## Root cause and locations

Currency was independently defaulted to GBP in NewInvoicePage, invoice request payloads, invoice list/detail/edit formatters, payment modals, PDF helpers, bill and purchase-order screens, banking, dashboard, accounting, and reporting pages. The existing central utility also replaced unknown currencies with GBP and invalid amounts with zero. API and authentication-storage normalization therefore hid invalid backend values before a screen could identify them.

The active invoice path was traced through AuthContext/authStorage → salesApiService → InvoicesPage/NewInvoicePage/InvoiceDetailsPage → invoicePdf. Frontend and Django serializers/services were inspected before changes. The shared formatter and active invoice path were fixed before the wider audit.

The audit searched authored source, templates, CSS, imports, tests, fixtures, scripts and documentation for all requested symbols, codes, Intl.NumberFormat, toLocaleString and currency properties. Dollar signs used by JavaScript interpolation, date-only en-GB formatting, ISO configuration, and deliberate test/demo data were distinguished from monetary presentation. No CSS currency pseudo-elements were found.

## Shared currency handling

- `src/utils/currency.js` provides formatCurrency, getCurrencySymbol, normaliseCurrencyCode, isValidCurrencyCode, resolveCurrencyCode, amount validation, and Excel currency number formats.
- `src/utils/organisationCurrency.js` reads the current selected organisation from the same persisted session used to scope API requests. It returns base_currency, optional locale, country_code and organisation_id at use time, without caching an earlier selection. The backend does not currently persist a separate organisation locale; where absent, Intl uses the browser locale.
- Reports and general-ledger balances use organisation base currency. Transactions use their specified currency; blank transaction currency resolves to organisation currency. Explicit invalid codes remain distinguishable and are not replaced with a valid, saveable fallback.
- Recognised Ghanaian legacy values normalize to GHS for display. Missing currency or invalid amounts show a placeholder. Unknown codes show the amount with a controlled code-based label and a development warning that contains no amounts, identifiers or other sensitive data.
- Zero, negative values, large decimal strings, and currencies with zero/two/three minor units are covered. Decimal strings are passed directly to Intl after validation to avoid premature Number rounding.
- CurrencyOptions preserves valid codes outside the common shortlist and exposes invalid selections instead of letting a select control visually choose its first GBP option.

Organisation switching persists the new request scope before mounting pages, remounts the page and header, rejects late responses belonging to the former organisation, and ignores late permission responses. The switcher's forced browser reload was removed. Supplier details now load organisation-scoped purchase orders from the API instead of unscoped browser demo storage, and match supplier UUIDs as strings.

## Backend and migration

Shared CurrencyCodeField/CurrencySerializerMixin validate writable currency fields across sales, purchases, contacts, banking, inventory, payroll and fixed assets. Symbols and unknown codes are rejected; documented blank document currencies use the request organisation. Existing relation/organisation checks remain authoritative. Currency catalogue and revaluation inputs also validate ISO codes.

New organisations require an explicit base currency; the old model default was removed. Test fixtures that intentionally represent GBP organisations now specify GBP explicitly. Draft invoice currency/date edits refresh their existing FX rate and base amount using the existing FX service; no new conversion rules were introduced. Report calculations were not changed.

Migration `organisations/0006_normalise_legacy_currencies.py` reuses the idempotent recognised-values-only cleanup for GH¢, GH₵ and GHC, preserves unknown/valid values, and removes the model default. It was exercised on test databases, not applied to the application database. The new read-only `audit_currencies` management command reports counts of unknown/legacy values without exposing record contents. The configured local database audit returned no findings; this is not a claim about a separate production database.

## Print and exports

Invoice, bill, quote and credit-note PDFs use central formatting with ISO-code presentation because standard PDF fonts do not reliably render the cedi symbol. Invoice/bill PDF builders can be tested without starting a download. Their generated PDF text is tested for GHS and explicit GBP precedence.

Excel retains the existing OOXML ZIP writer, numeric monetary cells and formula/text safeguards. Monetary formats include ISO codes and currency minor-unit precision; generic mixed-currency document rows get their own styles. Report metadata includes the currency. Invoice CSV export now includes a currency column; generic CSV exports include currency per row. Existing sample import templates retain explicitly identified GBP example rows, which their importers ignore.

No email was sent. Existing invoice/bill activity/email-related monetary formatters were redirected to the shared utility; unfinished communication features were not enabled.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | 44 passed, including real invoice/bill PDF generation, numeric Excel/currency styles, print-style regressions, GHS precedence, invalid values, minor units and large decimals |
| `cd accounting-backend && PYTHONDONTWRITEBYTECODE=1 venv/bin/python manage.py test --noinput` | 118 passed; temporary test database destroyed |
| `PYTHONDONTWRITEBYTECODE=1 accounting-backend/venv/bin/python accounting-backend/manage.py check` | No issues |
| `... manage.py makemigrations --check --dry-run` | No changes detected |
| `npm run lint` | Passed |
| `npm run build` | Passed; existing large-chunk advisory remains |
| `git diff --check` | Passed |
| `... manage.py audit_currencies` | Read-only audit, no findings |
| `node scripts/currencyBrowserCheck.mjs` | Isolated Chrome with synthetic API fixtures: 17 routes × GHS/GBP/USD/EUR; live switching; explicit GBP invoice in GHS; CAD/BHD/invalid-code selectors |

Browser routes cover dashboard, invoice list/create/detail, bill list/create/detail, bank accounts, General Journal, Opening Balances, General Ledger, Trial Balance, Profit and Loss, Balance Sheet, Cash Flow, and customer/supplier statements. Invoice, bill and financial-report print media were checked for forbidden pound output. GHS screens with unspecified document currency did not display £. The browser test intercepts all application API requests; it does not exercise live organisational data or send writes to a backend.

Native Chrome `Page.printToPDF` returned “Printing is not available” on this host. Actual physical/browser print layout and spreadsheet appearance in Excel require the manual checks below. PDF generation, print CSS and print-media text checks passed; no screenshot/physical-print verification is claimed.

## Intentional currency references and scope

GBP remains in central currency options, ISO validation/catalogue data, explicitly denominated demo/test fixtures, historical documentation and comments, and the existing GBP-only legacy local-accounting posting guards. The bank import parser intentionally recognizes currency symbols in imported text. Ghanaian legacy labels remain in normalization/migration tests. Production page/component amounts have no literal pound symbols and no separate Intl currency formatter.

This task changes currency presentation and validation, not financial-report arithmetic or FX policy. Existing mixed-currency aggregation/conversion behavior remains the responsibility of the existing report and FX services; no new conversion logic was invented. Existing unused/demo components were not activated.

## Manual checks before release

1. In a non-production environment, apply the migration and run `manage.py audit_currencies`; investigate any unknown values without guessing a replacement.
2. With GHS, GBP, USD and EUR organisations, inspect dashboard, invoice/bill creation and details, bank balances, journals, Opening Balances, financial reports and statements. Switch organisations without refreshing and verify new form defaults and that former records disappear.
3. In GHS, test an invoice with no explicit currency and another explicitly in GBP using an existing valid FX rate. Inspect lines, discount, tax, paid/due balances, payment labels, PDF and print preview. Repeat for bills.
4. Open exported workbooks in Excel; verify currency metadata, numeric cells, totals, negative values, and mixed document-currency rows. Check CSV currency columns.
5. Check invoice, bill and report print layout on a real printer/Save as PDF, and inspect amount labels at mobile widths. Verify email previews/attachments through the existing workflow without sending test messages to customers.

Suggested commit message: `fix: use organisation and transaction currencies throughout Ledgify`

## Files changed

- `accounting-backend/apps/accounting/test_account_imports.py`
- `accounting-backend/apps/accounting/test_journal_pagination.py`
- `accounting-backend/apps/accounting/test_opening_balances.py`
- `accounting-backend/apps/accounting/tests.py`
- `accounting-backend/apps/accounts/tests.py`
- `accounting-backend/apps/banking/serializers.py`
- `accounting-backend/apps/banking/services/transactions/create_transaction.py`
- `accounting-backend/apps/banking/tests.py`
- `accounting-backend/apps/contacts/serializers.py`
- `accounting-backend/apps/contacts/test_imports.py`
- `accounting-backend/apps/fixed_assets/serializers.py`
- `accounting-backend/apps/fixed_assets/tests.py`
- `accounting-backend/apps/fx/serializers.py`
- `accounting-backend/apps/inventory/serializers.py`
- `accounting-backend/apps/inventory/tests.py`
- `accounting-backend/apps/organisations/management/commands/audit_currencies.py`
- `accounting-backend/apps/organisations/migrations/0006_normalise_legacy_currencies.py`
- `accounting-backend/apps/organisations/models.py`
- `accounting-backend/apps/organisations/serializers.py`
- `accounting-backend/apps/organisations/test_currencies.py`
- `accounting-backend/apps/payroll/serializers.py`
- `accounting-backend/apps/payroll/tests.py`
- `accounting-backend/apps/purchases/serializers.py`
- `accounting-backend/apps/purchases/services/bills/create_bill.py`
- `accounting-backend/apps/purchases/services/credits/create_supplier_credit.py`
- `accounting-backend/apps/purchases/services/payments/create_supplier_payment.py`
- `accounting-backend/apps/purchases/services/refunds/create_supplier_refund.py`
- `accounting-backend/apps/purchases/tests.py`
- `accounting-backend/apps/sales/serializers.py`
- `accounting-backend/apps/sales/services/credit_notes/create_credit_note.py`
- `accounting-backend/apps/sales/services/invoices/create_invoice.py`
- `accounting-backend/apps/sales/services/payments/create_customer_payment.py`
- `accounting-backend/apps/sales/services/refunds/create_customer_refund.py`
- `accounting-backend/apps/sales/tests.py`
- `accounting-backend/common/currencies.py`
- `accounting-backend/common/currency_serializers.py`
- `docs/CURRENCY_AUDIT.md`
- `scripts/currencyBrowserCheck.mjs`
- `src/components/accounting/JournalFormModal.jsx`
- `src/components/accounting/JournalImportReversalModal.jsx`
- `src/components/banking/BankingTransactionsWorkspace.jsx`
- `src/components/banking/ReconciliationWorkspace.jsx`
- `src/components/bills/RecordBillPaymentModal.jsx`
- `src/components/commercial/CreditNotesWorkspace.jsx`
- `src/components/common/CurrencyOptions.jsx`
- `src/components/contacts/CustomerInformationCards.jsx`
- `src/components/contacts/CustomerInvoicesCard.jsx`
- `src/components/contacts/CustomerSummaryCards.jsx`
- `src/components/dashboard/CashFlowChart.jsx`
- `src/components/dashboard/RecentInvoices.jsx`
- `src/components/dashboard/RecentTransactions.jsx`
- `src/components/invoices/RecordPaymentModal.jsx`
- `src/components/layout/Header.jsx`
- `src/components/layout/MainLayout.jsx`
- `src/components/suppliers/SupplierDirectory.jsx`
- `src/pages/accounting/AccountDetailsPage.jsx`
- `src/pages/accounting/CashFlowBreakdownPage.jsx`
- `src/pages/accounting/ConsolidationPage.jsx`
- `src/pages/accounting/FXPage.jsx`
- `src/pages/accounting/GeneralJournalPage.jsx`
- `src/pages/accounting/JournalDetailsPage.jsx`
- `src/pages/accounting/LiveAccountingPages.jsx`
- `src/pages/accounting/LiveFixedAssetPages.jsx`
- `src/pages/accounting/NewJournalPage.jsx`
- `src/pages/banking/LiveBankingPages.jsx`
- `src/pages/banking/LiveProfessionalBankingPages.jsx`
- `src/pages/commercial/LiveCommercialPages.jsx`
- `src/pages/commercial/LiveTaxCreditPage.jsx`
- `src/pages/contacts/CustomerDetailsPage.jsx`
- `src/pages/contacts/CustomerStatementPage.jsx`
- `src/pages/contacts/EditCustomerPage.jsx`
- `src/pages/contacts/NewCustomerPage.jsx`
- `src/pages/dashboard/DashboardPage.jsx`
- `src/pages/inventory/LiveInventoryPages.jsx`
- `src/pages/manufacturing/ManufacturingPages.jsx`
- `src/pages/payroll/PayrollPage.jsx`
- `src/pages/purchases/BillDetailsPage.jsx`
- `src/pages/purchases/BillsPage.jsx`
- `src/pages/purchases/EditBillPage.jsx`
- `src/pages/purchases/EditPurchaseOrderPage.jsx`
- `src/pages/purchases/EditSupplierPage.jsx`
- `src/pages/purchases/NewBillPage.jsx`
- `src/pages/purchases/NewSupplierPage.jsx`
- `src/pages/purchases/PurchaseOrderDetailsPage.jsx`
- `src/pages/purchases/SupplierDetailsPage.jsx`
- `src/pages/reports/FinancialAnalysisPage.jsx`
- `src/pages/sales/EditInvoicePage.jsx`
- `src/pages/sales/InvoiceDetailsPage.jsx`
- `src/pages/sales/InvoicesPage.jsx`
- `src/pages/sales/NewInvoicePage.jsx`
- `src/pages/settings/CompanySettingsPage.jsx`
- `src/pages/tax/VatReturnsPage.jsx`
- `src/services/accountService.js`
- `src/services/accountTransactionsService.js`
- `src/services/agedPayablesService.js`
- `src/services/agedReceivablesService.js`
- `src/services/api.js`
- `src/services/bankAccountService.js`
- `src/services/bankTransactionServices.js`
- `src/services/billAccountingService.js`
- `src/services/billService.js`
- `src/services/creditNoteService.js`
- `src/services/customerService.js`
- `src/services/domainMappings.js`
- `src/services/generalLedgerService.js`
- `src/services/invoiceAccountingService.js`
- `src/services/invoiceInventoryService.js`
- `src/services/invoiceService.js`
- `src/services/paymentAccountingService.js`
- `src/services/purchaseOrderService.js`
- `src/services/purchasesApiService.js`
- `src/services/quoteService.js`
- `src/services/salesApiService.js`
- `src/services/supplierService.js`
- `src/store/AuthContext.jsx`
- `src/utils/billPdf.js`
- `src/utils/creditNotePdf.js`
- `src/utils/currency.js`
- `src/utils/invoicePdf.js`
- `src/utils/monetaryFields.js`
- `src/utils/organisationCurrency.js`
- `src/utils/quotePdf.js`
- `src/utils/reportExport.js`
- `src/utils/xlsxWorkbook.js`
- `tests/currency.test.mjs`
- `tests/currencyPdf.test.mjs`
- `tests/exportWorkbook.test.mjs`
