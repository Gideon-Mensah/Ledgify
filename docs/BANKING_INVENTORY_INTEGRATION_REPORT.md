# Banking and Inventory Integration Report

## 1. Banking endpoints used

- `GET/POST /api/v1/bank-accounts/`
- `GET/PATCH /api/v1/bank-accounts/{id}/`
- `GET/POST /api/v1/bank-transactions/`
- `GET /api/v1/bank-transactions/{id}/suggestions/`
- `POST /api/v1/bank-transactions/{id}/reconcile/`
- `POST /api/v1/bank-transactions/{id}/accept-suggestion/`
- `POST /api/v1/bank-transactions/{id}/unreconcile/`

The manual reconciliation body uses `target_account_id`. Internal transfers use the existing `bank_transfer` suggestion type and suggestion-acceptance endpoint. Cash coding is the existing manual account reconciliation workflow; there is no separate backend Cash Coding endpoint.

## 2. Inventory endpoints used

- `GET/POST /api/v1/products/`
- `GET/PATCH/DELETE /api/v1/products/{id}/`
- `GET /api/v1/products/{id}/stock/`
- `GET/POST /api/v1/warehouses/`
- `PATCH /api/v1/warehouses/{id}/`
- `GET /api/v1/stock-movements/`
- `POST /api/v1/stock-adjustments/`
- `GET /api/v1/inventory/valuation/`

## 3. Frontend pages connected

- Banking: accounts, transactions, reconciliation, manual cash coding, suggestion acceptance, internal-transfer matching, and unreconciliation.
- Inventory: product catalogue, product details, warehouses, stock summaries, stock movements, stock adjustments, and WAC valuation.
- Active routes are mounted from `LiveBankingPages.jsx` and `LiveInventoryPages.jsx`.

## 4. Backend files touched

- `apps/banking/tests.py` only. Production backend models, serializers, views, routes, and accounting services were not changed.

## 5. Services updated

- `src/services/bankService.js` is the canonical Banking API service.
- `src/services/inventoryService.js` is the canonical Inventory API service.
- Both use the shared API client, which supplies JWT authorization and the selected organisation header.

## 6. Mock data removed

The active Banking and Inventory pages contain no mock, dummy, sample, fake, or placeholder data sources. Legacy post-demo pages and services remain in the repository but are not mounted for the active Banking and Inventory routes, as required by the milestone scope.

## 7. Integration tests executed

- Manual money-out reconciliation verifies debit to the selected expense and credit to bank.
- Safe unreconciliation verifies a reversal journal and retained reconciliation history.
- Internal-transfer matching verifies suggestion discovery, acceptance, reconciliation of both transactions, one shared journal, and balanced debits/credits.
- Inventory adjustment tests verify adjustment-in and adjustment-out journals and derived quantity.
- Inventory tests verify negative-stock rejection, WAC valuation, deterministic issue costing, immutable cost layers, and reversal history.
- The complete Django test suite is also run as final validation.

Customer and supplier payment posting services were inspected and retain the required journal directions: customer payment debits Bank and credits Accounts Receivable; supplier payment debits Accounts Payable and credits Bank.

## 8. Remaining limitations

- There is no standalone backend Cash Coding resource. The supported manual reconciliation endpoint provides the required cash-coding behavior.
- There is no separate internal-transfer creation endpoint. Existing paired bank transactions are detected and accepted as `bank_transfer` reconciliation suggestions.
- Legacy hidden Banking and Inventory modules still contain local/demo implementations, intentionally left untouched because they are not active demo routes.

## 9. Backend validation results

- `python manage.py check`: passed.
- `python -m compileall apps common config`: passed.
- `python manage.py makemigrations --check --dry-run`: passed with no changes.
- Banking and Inventory workflow tests: passed.
- Complete backend test suite: passed.

## 10. Frontend validation results

- Targeted Banking and Inventory ESLint: passed with zero errors and warnings.
- Production build: passed.
- Vite continues to report the pre-existing large-chunk advisory; it does not fail the build.

## 11. Known issues

- The repository-wide frontend lint baseline still contains errors and warnings in unrelated legacy modules. Milestone 4 files are clean under targeted lint.
- Banking transaction search is client-side because the backend currently exposes status, type, and bank-account filters but no search query parameter.

## 12. Demo readiness recommendation

Banking and Inventory are ready for the client demonstration. The active workflows use organisation-scoped backend APIs, mutation controls respect backend permission names, server validation errors are surfaced through `normaliseApiError()`, and accounting/inventory audit behavior is covered by focused integration tests.
