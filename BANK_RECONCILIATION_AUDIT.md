# Bank reconciliation audit and repair

Audit date: 14 August 2026

## Problem confirmed

The previous reconciliation page loaded transactions across all bank accounts and dates. It did not select a statement date, did not request a date-consistent ledger balance, did not display the reconciliation difference, and did not expose the existing reconciliation-history model. Manual account coding was labelled as generic reconciliation, which did not explain that it creates a posted journal.

## Accounting definitions

- **Book balance:** debit less credit from posted/reversed journal lines on the linked bank ledger account through the selected reconciliation date.
- **Statement balance:** configured opening statement balance plus money-in less money-out bank statement/feed transactions through the same date.
- **Difference:** statement balance minus book balance.
- A statement balance is unavailable when neither a dated opening balance nor statement transactions exist. The UI does not substitute the book balance.
- Reconciliation is complete only when statement data is available, the difference is zero, and no statement transaction through the selected date remains unreconciled.

## Safety findings

- Matching an existing posted customer or supplier payment links its existing journal; it does not create another payment or journal.
- Invoice and bill suggestions are explicitly payment-creation suggestions and use their domain payment services.
- Manual coding creates a balanced bank journal through the journal creation and posting services. Money out debits the selected account and credits bank; money in debits bank and credits the selected account.
- Reconciliation mutations use atomic transactions and row locks. Duplicate reconciliation and reuse of an existing payment target are rejected with `BusinessRuleError`.
- Customer/supplier payment, account, bank transaction, bank account and ledger relationships are organisation checked. Payment/account currencies and amounts must match.
- Existing-payment unreconciliation removes the reconciliation link without reversing the original payment. Reconciliation-created payments, manual coding and transfers follow their explicit reversal workflows and preserve history.
- Journal posting and reversal continue through the existing journal services, so period locks remain authoritative.

## API and UI delivered

- Added a bank-account reconciliation summary endpoint accepting an explicit `reconciliation_date`.
- Added a bank-account reconciliation-history endpoint backed by `BankReconciliationHistory`.
- Added canonical frontend service methods for summary and history.
- Rebuilt reconciliation as an account/date-scoped workspace with book balance, statement balance, difference, outstanding count, linked ledger and last-reconciled information.
- Added To reconcile, Reconciled and History views; money-in/out columns; readable statuses; safe match review; explicit Code transaction workflow; and safe unreconciliation with a required audit reason.
- Account cards now distinguish ledger book balance, statement balance and difference, show “Not available” honestly, and link directly to reconciliation.

## Validation

- `python manage.py check`: passed.
- `python -m compileall apps common config`: passed.
- `python manage.py makemigrations --check --dry-run`: no changes detected.
- Banking tests: 8 passed.
- Accounting tests: 9 passed.
- Frontend lint: passed with zero errors.
- Frontend production build: passed. Only the non-blocking existing bundle-size advisory remains.

## Remaining limitations

- The current schema has no explicit statement-closing-balance field. Statement balance therefore follows the existing opening-balance-plus-imported-activity architecture.
- Partial, one-to-many and many-to-one reconciliation are not supported by the current backend and were not simulated in React.
- Candidate discovery uses the bounded server-side suggestion window. A separate free-text candidate search endpoint does not yet exist.
- There is no separate formal statement-period/close model; the selected reconciliation date is the period boundary used by the workspace.
