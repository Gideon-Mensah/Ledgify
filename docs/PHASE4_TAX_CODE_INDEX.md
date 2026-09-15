# Tax implementation code index

Line references reflect the local implementation on 14 September 2026. They are navigation aids, not claims about untested deployments.

| Symbol | File and line |
|---|---|
| `validate_components` | [`accounting-backend/apps/tax/engine.py:32`](../accounting-backend/apps/tax/engine.py#L32) |
| `calculate_components` | [`accounting-backend/apps/tax/engine.py:58`](../accounting-backend/apps/tax/engine.py#L58) |
| `create_profile` | [`accounting-backend/apps/tax/configuration.py:98`](../accounting-backend/apps/tax/configuration.py#L98) |
| `review_profile` | [`accounting-backend/apps/tax/configuration.py:123`](../accounting-backend/apps/tax/configuration.py#L123) |
| `activate_profile` | [`accounting-backend/apps/tax/configuration.py:143`](../accounting-backend/apps/tax/configuration.py#L143) |
| `draft_version` | [`accounting-backend/apps/tax/configuration.py:249`](../accounting-backend/apps/tax/configuration.py#L249) |
| `approve_version` | [`accounting-backend/apps/tax/configuration.py:255`](../accounting-backend/apps/tax/configuration.py#L255) |
| `activate_version` | [`accounting-backend/apps/tax/configuration.py:301`](../accounting-backend/apps/tax/configuration.py#L301) |
| `affected_drafts` | [`accounting-backend/apps/tax/configuration.py:317`](../accounting-backend/apps/tax/configuration.py#L317) |
| `version_impact` | [`accounting-backend/apps/tax/configuration.py:330`](../accounting-backend/apps/tax/configuration.py#L330) |
| `version_on` | [`accounting-backend/apps/tax/configuration.py:309`](../accounting-backend/apps/tax/configuration.py#L309) |
| `prepare_line_tax` | [`accounting-backend/apps/tax/document_tax.py:11`](../accounting-backend/apps/tax/document_tax.py#L11) |
| `validate_document_snapshot` | [`accounting-backend/apps/tax/document_tax.py:105`](../accounting-backend/apps/tax/document_tax.py#L105) |
| `freeze_document` | [`accounting-backend/apps/tax/document_tax.py:161`](../accounting-backend/apps/tax/document_tax.py#L161) |
| `withholding_register` | [`accounting-backend/apps/tax/returns.py:36`](../accounting-backend/apps/tax/returns.py#L36) |
| `vat_workpaper` | [`accounting-backend/apps/tax/returns.py:61`](../accounting-backend/apps/tax/returns.py#L61) |
| `prepare_return` | [`accounting-backend/apps/tax/returns.py:122`](../accounting-backend/apps/tax/returns.py#L122) |
| `transition_return` | [`accounting-backend/apps/tax/returns.py:136`](../accounting-backend/apps/tax/returns.py#L136) |
| `export_wht` | [`accounting-backend/apps/tax/returns.py:189`](../accounting-backend/apps/tax/returns.py#L189) |
| `export_workpaper` | [`accounting-backend/apps/tax/returns.py:213`](../accounting-backend/apps/tax/returns.py#L213) |
| `post_adjustment` | [`accounting-backend/apps/tax/operations.py:25`](../accounting-backend/apps/tax/operations.py#L25) |
| `post_payment` | [`accounting-backend/apps/tax/operations.py:90`](../accounting-backend/apps/tax/operations.py#L90) |
| `reverse_tax_payment` | [`accounting-backend/apps/tax/operations.py:58`](../accounting-backend/apps/tax/operations.py#L58) |
| `map_controls` | [`accounting-backend/apps/tax/operations.py:137`](../accounting-backend/apps/tax/operations.py#L137) |
| `TaxConfigurationViewSet` | [`accounting-backend/apps/tax/api.py:120`](../accounting-backend/apps/tax/api.py#L120) |
| `TaxReturnViewSet` | [`accounting-backend/apps/tax/api.py:437`](../accounting-backend/apps/tax/api.py#L437) |
| `adopt` | [`accounting-backend/apps/tax/api.py:250`](../accounting-backend/apps/tax/api.py#L250) |
| `reverse_payment` | [`accounting-backend/apps/tax/api.py:512`](../accounting-backend/apps/tax/api.py#L512) |
| `TaxRegimeVersion` | [`accounting-backend/apps/tax/jurisdiction_models.py:31`](../accounting-backend/apps/tax/jurisdiction_models.py#L31) |
| `OrganisationTaxProfile` | [`accounting-backend/apps/tax/jurisdiction_models.py:48`](../accounting-backend/apps/tax/jurisdiction_models.py#L48) |
| `TaxRateVersion` | [`accounting-backend/apps/tax/jurisdiction_models.py:94`](../accounting-backend/apps/tax/jurisdiction_models.py#L94) |
| `DocumentTaxSnapshot` | [`accounting-backend/apps/tax/jurisdiction_models.py:144`](../accounting-backend/apps/tax/jurisdiction_models.py#L144) |
| `TaxReturnDraft` | [`accounting-backend/apps/tax/jurisdiction_models.py:174`](../accounting-backend/apps/tax/jurisdiction_models.py#L174) |
| `TaxPayment` | [`accounting-backend/apps/tax/jurisdiction_models.py:218`](../accounting-backend/apps/tax/jurisdiction_models.py#L218) |
| `Command` | [`accounting-backend/apps/tax/management/commands/audit_tax_configuration.py:11`](../accounting-backend/apps/tax/management/commands/audit_tax_configuration.py#L11) |
| `Command` | [`accounting-backend/apps/tax/management/commands/publish_ghana_tax_preset.py:15`](../accounting-backend/apps/tax/management/commands/publish_ghana_tax_preset.py#L15) |
| `JurisdictionIntegrationTests` | [`accounting-backend/apps/tax/test_jurisdictions.py:39`](../accounting-backend/apps/tax/test_jurisdictions.py#L39) |
| `TaxActivationConcurrencyTests` | [`accounting-backend/apps/tax/test_jurisdictions.py:496`](../accounting-backend/apps/tax/test_jurisdictions.py#L496) |
| `reverse_journal_entry` | [`accounting-backend/apps/accounting/services/journals/reverse_journal.py:23`](../accounting-backend/apps/accounting/services/journals/reverse_journal.py#L23) |

## Frontend and integration entry points

- [`src/pages/tax/JurisdictionTaxSettings.jsx`](../src/pages/tax/JurisdictionTaxSettings.jsx)
- [`src/components/documents/TaxOperations.jsx`](../src/components/documents/TaxOperations.jsx)
- [`src/components/documents/TaxDocumentEditor.jsx`](../src/components/documents/TaxDocumentEditor.jsx)
- [`src/components/documents/TaxClassifications.jsx`](../src/components/documents/TaxClassifications.jsx)
- [`src/components/documents/WithholdingFields.jsx`](../src/components/documents/WithholdingFields.jsx)
- [`src/components/documents/DocumentView.jsx`](../src/components/documents/DocumentView.jsx)
- [`src/routes/PayrollJurisdictionRoute.jsx`](../src/routes/PayrollJurisdictionRoute.jsx)
- [`src/utils/taxProfile.js`](../src/utils/taxProfile.js)
- [`accounting-backend/apps/tax/evat.py`](../accounting-backend/apps/tax/evat.py)
- [`accounting-backend/common/documents.py`](../accounting-backend/common/documents.py)
- [`accounting-backend/apps/organisations/permissions.py`](../accounting-backend/apps/organisations/permissions.py)
- [`scripts/verify-tax-workflows.mjs`](../scripts/verify-tax-workflows.mjs)
- [`scripts/verify-tax-settlement.mjs`](../scripts/verify-tax-settlement.mjs)
- [`scripts/seed-tax-verification.py`](../scripts/seed-tax-verification.py)

## Complete current worktree inventory

This inventory includes preserved uncommitted Phase 3 changes as well as tax-phase changes. It is not a claim that every listed change originated in this phase. No files were reset to create it.

```text
 M .env.example
 M accounting-backend/.env.example
 M accounting-backend/apps/accounting/services/journals/reverse_journal.py
 M accounting-backend/apps/banking/services/reconciliation/matcher.py
 M accounting-backend/apps/banking/services/reconciliation/reconcile.py
 M accounting-backend/apps/organisations/models.py
 M accounting-backend/apps/organisations/permissions.py
 M accounting-backend/apps/organisations/serializers.py
 M accounting-backend/apps/payroll/services/calculation_engine.py
 M accounting-backend/apps/payroll/services/payroll_service.py
 M accounting-backend/apps/payroll/views.py
 M accounting-backend/apps/purchases/models.py
 M accounting-backend/apps/purchases/serializers.py
 M accounting-backend/apps/purchases/services/bills/approve_bill.py
 M accounting-backend/apps/purchases/services/bills/create_bill.py
 M accounting-backend/apps/purchases/services/bills/update_bill.py
 M accounting-backend/apps/purchases/services/credits/approve_supplier_credit.py
 M accounting-backend/apps/purchases/services/credits/create_supplier_credit.py
 M accounting-backend/apps/purchases/services/payments/create_supplier_payment.py
 M accounting-backend/apps/sales/models.py
 M accounting-backend/apps/sales/serializers.py
 M accounting-backend/apps/sales/services/credit_notes/approve_credit_note.py
 M accounting-backend/apps/sales/services/credit_notes/create_credit_note.py
 M accounting-backend/apps/sales/services/invoices/approve_invoice.py
 M accounting-backend/apps/sales/services/invoices/create_invoice.py
 M accounting-backend/apps/sales/services/payments/create_customer_payment.py
 M accounting-backend/apps/sales/tests.py
 M accounting-backend/apps/sales/views.py
 M accounting-backend/apps/tax/models.py
 M accounting-backend/apps/tax/serializers.py
 M accounting-backend/apps/tax/services/ledger_service.py
 M accounting-backend/apps/tax/tests.py
 M accounting-backend/apps/tax/urls.py
 M accounting-backend/apps/tax/views.py
 M accounting-backend/config/settings.py
 M accounting-backend/config/urls.py
 M accounting-backend/requirements.txt
 M src/components/banking/ReconciliationWorkspace.jsx
 M src/components/bills/RecordBillPaymentModal.jsx
 M src/components/commercial/CreditNotesWorkspace.jsx
 M src/components/invoices/EmailInvoiceModal.jsx
 M src/components/invoices/RecordPaymentModal.jsx
 M src/components/reports/ReportExportMenu.jsx
 M src/config/featureFlags.js
 M src/pages/accounting/GeneralJournalPage.jsx
 M src/pages/accounting/JournalDetailsPage.jsx
 M src/pages/accounting/LiveAccountingPages.jsx
 M src/pages/accounting/OpeningBalancesPage.jsx
 M src/pages/commercial/LiveCommercialPages.jsx
 M src/pages/purchases/BillDetailsPage.jsx
 M src/pages/sales/InvoiceDetailsPage.jsx
 M src/pages/settings/CompanySettingsPage.jsx
 M src/routes/AppRoutes.jsx
 M src/services/api.js
 M src/services/purchasesApiService.js
 M src/services/salesApiService.js
 M src/styles/banking.css
 M src/styles/designSystem.css
 M src/styles/journalDetails.css
 M src/styles/journals.css
 M src/styles/liveReports.css
 M src/utils/billPdf.js
 M src/utils/creditNotePdf.js
 M src/utils/invoicePdf.js
 M src/utils/quotePdf.js
 M src/utils/reportExport.js
 M tests/currency.test.mjs
 M tests/currencyPdf.test.mjs
 M tests/exportWorkbook.test.mjs
?? accounting-backend/apps/organisations/migrations/0007_organisation_ghana_post_gps_organisation_logo_data_and_more.py
?? accounting-backend/apps/organisations/migrations/0008_organisation_tax_configuration_version_and_more.py
?? accounting-backend/apps/purchases/migrations/0015_billline_tax_snapshot_and_more.py
?? accounting-backend/apps/purchases/migrations/0016_alter_billline_tax_rate_and_more.py
?? accounting-backend/apps/sales/migrations/0014_invoiceemailattempt.py
?? accounting-backend/apps/sales/migrations/0015_customercreditnoteline_tax_snapshot_and_more.py
?? accounting-backend/apps/sales/migrations/0016_alter_customercreditnoteline_tax_rate_and_more.py
?? accounting-backend/apps/sales/services/documents/email_invoice.py
?? accounting-backend/apps/sales/test_documents.py
?? accounting-backend/apps/tax/api.py
?? accounting-backend/apps/tax/configuration.py
?? accounting-backend/apps/tax/document_tax.py
?? accounting-backend/apps/tax/engine.py
?? accounting-backend/apps/tax/evat.py
?? accounting-backend/apps/tax/jurisdiction_models.py
?? accounting-backend/apps/tax/management/__init__.py
?? accounting-backend/apps/tax/management/commands/__init__.py
?? accounting-backend/apps/tax/management/commands/audit_tax_configuration.py
?? accounting-backend/apps/tax/management/commands/publish_ghana_tax_preset.py
?? accounting-backend/apps/tax/migrations/0002_taxtransaction_component_snapshot_and_more.py
?? accounting-backend/apps/tax/migrations/0003_tax_integrity_guards.py
?? accounting-backend/apps/tax/migrations/0004_alter_taxrate_rate_and_more.py
?? accounting-backend/apps/tax/migrations/0005_tax_configuration_mutation_guards.py
?? accounting-backend/apps/tax/migrations/0006_taxadjustment_idempotency_key_and_more.py
?? accounting-backend/apps/tax/operations.py
?? accounting-backend/apps/tax/presets.py
?? accounting-backend/apps/tax/returns.py
?? accounting-backend/apps/tax/test_jurisdictions.py
?? accounting-backend/apps/tax/withholding.py
?? accounting-backend/common/document_views.py
?? accounting-backend/common/documents.py
?? accounting-backend/requirements-test.txt
?? docs/PHASE3_ACTION_MATRIX.md
?? docs/PHASE3_DOCUMENT_WORKFLOWS.md
?? docs/PHASE4_JURISDICTION_TAX.md
?? docs/PHASE4_TAX_CODE_INDEX.md
?? docs/PHASE4_TAX_VERIFICATION.md
?? docs/tax-sources/SOURCES.md
?? docs/tax-verification/browser-results.json
?? docs/tax-verification/ghana-tax-invoice.pdf
?? docs/tax-verification/mobile-Profile.png
?? docs/tax-verification/mobile-return-settlement.png
?? docs/tax-verification/settlement-browser-results.json
?? docs/tax-verification/tax-review-workpaper.pdf
?? scripts/inspect-document-pdfs.py
?? scripts/seed-tax-verification.py
?? scripts/verify-document-print.mjs
?? scripts/verify-tax-settlement.mjs
?? scripts/verify-tax-workflows.mjs
?? src/components/documents/DocumentView.jsx
?? src/components/documents/SavedDocument.jsx
?? src/components/documents/SourceDocumentPage.jsx
?? src/components/documents/TaxClassifications.jsx
?? src/components/documents/TaxDocumentEditor.jsx
?? src/components/documents/TaxOperations.jsx
?? src/components/documents/WithholdingFields.jsx
?? src/pages/tax/JurisdictionTaxSettings.jsx
?? src/routes/PayrollJurisdictionRoute.jsx
?? src/styles/documents.css
?? src/styles/jurisdictionTax.css
?? src/utils/documentActions.js
?? src/utils/documentIdentity.js
?? src/utils/documentPdf.js
?? src/utils/ledgerDocumentRows.js
?? src/utils/printReport.js
?? src/utils/taxProfile.js
?? tests/documentActions.test.mjs
?? tests/taxProfile.test.mjs
```
