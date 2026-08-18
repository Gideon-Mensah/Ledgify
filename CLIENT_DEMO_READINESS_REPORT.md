# Client Demo Readiness Report

## 1. Demo-ready modules

Dashboard; Customers and Invoices; Suppliers and Bills; Bank Accounts, Transactions and Reconciliation; Products, Warehouses, Adjustments and Valuation; Chart of Accounts, Journals, Financial Years and Periods; General Ledger, Trial Balance, Profit & Loss, Balance Sheet, Cash Flow, Aged Receivables and Aged Payables; Customer and Supplier Statements; stable Settings entry points.

## 2. Hidden/post-demo modules

Quotes, Credit Notes, Purchase Orders, Bank Rules, standalone legacy Cash Coding, Opening Balances, Fixed Assets, Depreciation, Journal Import, Recurring Journals, Budgets, Year-End Close, Audit Trail, VAT and other advanced modules remain routable where previously implemented but are removed from primary demo navigation. Their source was not deleted.

## 3. Demo user and organisation preparation

The command creates or reuses **Ledgify Demo Ltd** and assigns the requested user an active Owner membership. It reuses a user by email. A new user requires `--password` or `LEDGIFY_DEMO_PASSWORD`; no password is stored in source.

## 4. Seed command

Run `python manage.py seed_demo_data --email YOUR_EMAIL`. The command is transaction-wrapped and idempotent. Two consecutive validation runs produced unchanged record counts. No destructive reset option is provided.

## 5. Dashboard status

The dashboard uses live Profit & Loss, Balance Sheet, aged AR/AP, invoices, bills, bank transactions and stock movements. KPIs show cash, receivables, payables and current-financial-year net profit. Aging and recent activity use real records. Fabricated charts and local-storage values were removed.

## 6. Sales workflow status

Customers, zero-tax invoice creation, approval, partial/final customer payments, operational balances and journals use backend services. Seeded records include paid, partly-paid and open states across useful aging dates.

## 7. Purchases workflow status

Suppliers, zero-tax bill creation, approval, partial/final supplier payments, operational balances and journals use backend services. Seeded records include paid, partly-paid and open states.

## 8. Banking workflow status

Accounts, transaction creation/filter/search/detail, suggestions, internal-transfer acceptance, manual coding and safe unreconciliation are integrated. Manual coding creates a posted journal. Unreconciliation creates a reversal and retains reconciliation history.

## 9. Inventory workflow status

Products, warehouses, stock summaries, movements, adjustments and perpetual WAC valuation are integrated. Automated tests verify increases, decreases, negative-stock prevention, deterministic WAC, valuation and immutable cost layers.

## 10. Accounting and report status

Reports use posted ledger services. Nested account objects are rendered as readable code/name labels, headings are presentation-friendly, and unbalanced reports show a visible warning. The Reports landing page links to every supported report.

## 11. Permission status

Active mutation controls use `auth.hasPermission(...)`; backend organisation and action permissions remain authoritative. The shared API client supplies JWT and `X-Organisation-ID` headers.

## 12. Known limitations

- Banking search is client-side because the backend has no search query parameter.
- Cash coding is provided through manual reconciliation rather than a standalone backend resource.
- Internal transfers match paired bank transactions rather than using a transfer-creation endpoint.
- Rare Accounting administration actions retain browser prompts, as allowed for low-risk demo administration.

## 13. Known non-blocking issues

- Vite reports a large main-bundle advisory after successful builds.
- Hidden legacy modules retain repository-wide lint findings and local/demo implementations.
- No full browser-automation harness exists; workflow validation is service/API integration plus production compilation.

## 14. Targeted lint result

All active demo pages, routes and canonical Banking/Inventory/report services pass ESLint with zero errors and warnings.

## 15. Full lint result

The informational repository-wide lint remains non-zero in hidden legacy modules: 124 findings across the repository (72 errors and 52 warnings). The active demo target is clean.

## 16. Frontend build result

Production Vite build passes. The chunk-size advisory is non-blocking.

## 17. Backend check result

`python manage.py check` and compilation of `apps`, `common`, and `config` pass.

## 18. Migration consistency result

`python manage.py makemigrations --check --dry-run` reports no changes.

## 19. End-to-end test results

The complete backend suite passes 14 tests. Coverage includes seeded Sales/Purchases payment states, Banking manual reconciliation/internal transfers/unreconciliation, Inventory adjustments/WAC/negative stock, Trial Balance, Balance Sheet, and AR/AP operational reconciliation. The seed is also executed twice inside an isolated test database.

## 20. Live demonstration risks

Select Ledgify Demo Ltd before presenting, avoid closing the current period, and use zero tax. Prefer existing seeded documents if live form entry is interrupted. Re-run the seed command before the session. There are no identified blocking accounting-integrity or production-build issues.
