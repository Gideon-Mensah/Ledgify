# Controlled account reclassification — implementation and verification

## Cause and existing architecture

The PostgreSQL function `ledgify_guard_account_history`, introduced in accounting migration 0022, rejects changes to organisation, type, class or currency when posted/reversed journal lines exist. The old AccountSerializer only validated flagged system accounts. A normal used account therefore passed API validation and then hit a database integrity exception, producing the generic server error.

Account type controls natural debit/credit balance and the Assets/Liabilities/Equity/Revenue/Expense financial-statement hierarchy. Account class provides detail and identifies AR/AP/retained-earnings roles. Cash Flow uses explicit cash-flow categories, bank profiles and its existing class mapping. Reports include ledger-effective posted and reversed journals; they do not exclude former control accounts. Existing AR/AP services used active class discovery, not account names or codes. Existing system-account flags and configuration foreign keys are reused.

## Rules

- Truly unused, unprotected accounts can change type/class to a valid combination, with confirmation and a reason.
- Any related accounting record, including drafts, opening-balance lines and configuration, prevents unrestricted type changes.
- Used accounts cannot change currency or effective cash-flow treatment.
- Safe same-type corrections require explicit confirmation and a reason. Current Asset → Accounts Receivable and Current Liability → Accounts Payable are supported if no current active control conflicts.
- System flags, AR/AP/retained-earnings classes, and tax/banking/payroll/inventory/manufacturing/organisation account references protect classification and active status.
- Accounts with activity, configuration or classification audit history cannot be deleted.
- Ordinary identity edits remain possible. Legacy invalid combinations are not silently repaired during unrelated name/description edits.
- Missing/multiple legacy controls are not automatically chosen or reclassified. Duplicate current active controls yield actionable validation.
- Import validation and account editing use the same type/class compatibility mapping.

## Audited correction and database safety

Account changes acquire the existing organisation ledger advisory lock and re-read the account inside an atomic transaction. Before/after values, reason, actor and timestamp are recorded in AccountClassificationEvent. PostgreSQL protects these audit records from updates/deletes. The existing posted-history database safeguard still rejects type/organisation/currency changes; class changes require a matching audit event selected transaction-locally by the controlled service. No journal, source-document, opening-balance or financial amount is edited by this service.

Account list policies use correlated existence annotations instead of separate relation queries for every account. The service independently rechecks usage under the lock, so frontend policy data is advisory, not an authorisation boundary.

## AR/AP replacement

POST `accounts/{id}/replace-control/` requires `manage_accounts`, a same-organisation target, explicit confirmation and a reason. The target must be unused, active, unprotected, and have the same type and currency. Replacement and posting share the ledger lock; concurrent replacements cannot both win.

`is_current_control` distinguishes the future-posting account from former controls. Existing rows default to true, preserving existing discovery behaviour without reclassifying data. The former control retains its class and stays active so historical reversals can still post correctly. The replacement adopts the role and cash-flow category and is protected as a system account. Neither existing balances nor journal lines transfer.

Invoice/bill approvals and new AR/AP payments, credits, refunds and write-offs use the current active control. Historical carrying-value calculations, reversals, aging, statements and financial reports continue to include the original accounts. Settlements after replacement may therefore create a credit/debit balance on the replacement while an opposite historical balance remains on the former control; an explicit accountant-approved journal is needed if balances should be transferred.

Retained earnings and other configured tax/bank/payroll/inventory controls are protected, but are deliberately not offered this generic AR/AP replacement operation: they require their own configuration-specific transition and validation.

## UI

Edit Account uses the backend policy to disable unsafe type/class/currency/cash-flow/status changes. It identifies current/former controls, requests confirmation and a reason for classification changes, displays backend errors, and offers eligible AR/AP replacements with an explicit history/future-posting/no-balance-transfer warning. The Chart of Accounts recognises protected controls even if their legacy system flag was absent.

## Exact requested scenario — disposable data only

The automated test creates account 1200 as Asset / Current Asset and posts an actual GHS 14,800 opening debit balanced by equity. It snapshots journal headers, journal lines and opening lines, corrects the class to Accounts Receivable, and verifies those snapshots are unchanged.

It then creates and approves ABS-PO-001 for Accra Business Solutions Ltd with quantity 10, unit price GHS 500 and no tax:

| Account | Debit | Credit |
| --- | ---: | ---: |
| 1200 Trade Debtors | GHS 5,000 | GHS 0 |
| 4000 Sales Revenue | GHS 0 | GHS 5,000 |

Final account 1200 debit balance: GHS 19,800. Trial Balance debits/credits: GHS 19,800 each; difference zero. Balance Sheet remains balanced; profit is GHS 5,000. Opening journal lines remain exactly unchanged. A separate test compares report totals before/after the class correction, including unchanged P&L and Cash Flow output.

This is a verified synthetic fixture, not a claim that the user's actual organisation was modified. Its exact organisation/environment was requested but not supplied during implementation. No live correction or real invoice approval was performed.

An opening AR control balance also needs matching customer-level opening balances for subledger reconciliation. Reclassifying an existing general-ledger opening debit does not invent those customer records; Accounting Health can appropriately expose the existing reconciliation difference. No balancing workaround is introduced.

## Verification

Backend commands ran against disposable PostgreSQL on 127.0.0.1:15433 and Redis on 127.0.0.1:16380, with `PYTHONDONTWRITEBYTECODE=1`, `DATABASE_URL=postgresql://taxui@127.0.0.1:15433/ledgify_phase5`, and `DJANGO_CACHE_URL=redis://127.0.0.1:16380/1`.

From `accounting-backend/`:

```sh
venv/bin/python manage.py test apps.accounting.test_account_classification --noinput
venv/bin/python manage.py test --noinput
venv/bin/python manage.py makemigrations --check --dry-run
```

- Focused classification suite: 24 passed, 0 failed, 0 skipped, including PostgreSQL concurrent replacement.
- Complete backend suite: 327 passed, 0 failed, 0 skipped.
- Migration check: no changes detected. New migrations 0023–0025 ran on the disposable test database; no application database was migrated.

From repository root:

```sh
npm test
npm run lint
npm run build
git diff --check
```

- Frontend: 93 passed, 0 failed, 0 skipped; 3 new account-classification tests.
- Lint, production build and diff checks passed. Existing bundle-size warning remains.
- Isolated Chromium checks at 1440px and 390px used synthetic API fixtures: used type locked, permitted class editable, confirmation required, protected control locked, replacement confirmation submitted, no horizontal page overflow or console errors. Browser artifacts: `/tmp/ledgify-coa-verification/`.

The 24 focused tests cover unused edits, invalid combinations, used type changes, same-type correction, exact opening/history preservation, report totals, explicit consent, duplicate controls, system restrictions, cash-flow/currency restrictions, draft usage, AR/AP replacement and future posting, historical reversal, replacement validation, tenant/permission rejection, the exact invoice scenario, PostgreSQL bypass rejection and audit immutability, configured FX controls, retained earnings, legacy name edits, list policies, read-only posting designation and concurrent replacement.

## Release and remaining limits

Apply migrations together with the updated backend before using the new frontend. Do not run an old backend against accounts that have already undergone control replacement: old discovery code does not understand `is_current_control` and could report duplicate controls. No deployment, commit or push was performed.

Real-organisation correction and ABS-PO-001 approval remain pending exact target identification. Review the opening customer subledger reconciliation and any desired balance-transfer journal separately. Reports, invoices, tax calculations and their presentation were not redesigned.

## Files changed
- `accounting-backend/apps/accounting/migrations/0023_controlled_account_classification.py`
- `accounting-backend/apps/accounting/migrations/0024_account_classification_guard.py`
- `accounting-backend/apps/accounting/migrations/0025_current_posting_control.py`
- `accounting-backend/apps/accounting/models.py`
- `accounting-backend/apps/accounting/serializers.py`
- `accounting-backend/apps/accounting/services/account_classification.py`
- `accounting-backend/apps/accounting/services/account_imports.py`
- `accounting-backend/apps/accounting/test_account_classification.py`
- `accounting-backend/apps/accounting/views.py`
- `accounting-backend/apps/purchases/services/bills/approve_bill.py`
- `accounting-backend/apps/purchases/services/credits/approve_supplier_credit.py`
- `accounting-backend/apps/purchases/services/payments/create_supplier_payment.py`
- `accounting-backend/apps/purchases/services/refunds/create_supplier_refund.py`
- `accounting-backend/apps/sales/services/credit_notes/approve_credit_note.py`
- `accounting-backend/apps/sales/services/invoices/approve_invoice.py`
- `accounting-backend/apps/sales/services/payments/create_customer_payment.py`
- `accounting-backend/apps/sales/services/refunds/create_customer_refund.py`
- `accounting-backend/apps/sales/services/write_offs/create_bad_debt_write_off.py`
- `docs/controlled-account-reclassification.md`
- `src/components/accounting/AccountFormModal.jsx`
- `src/pages/accounting/LiveAccountingPages.jsx`
- `src/services/accountingApiService.js`
- `tests/accountClassification.test.mjs`
