# Ledgify RC1 Release Candidate Status

Date: 18 August 2026

## Release classification

RC1 is **Demo Ready**. The accounting-health blocker is resolved without changing historical journal data.

### Blocker remediation investigation

The confirmed cause was reporting semantics, not a missing customer payment. `JE-000021` had already been safely reversed: the original status was `reversed` and `REV-JE-000021` was posted. Posted-only report queries excluded the original while including its reversal, creating an artificial £375 AR debit. Ledger-effective reporting now centrally includes both `posted` and `reversed` originals, so original and reversal net to zero. The same correction covers JE-000018 and JE-000020 and their reversal journals.

## Baseline

- Git status, branch, and commit: unavailable because this workspace contains no `.git` metadata.
- Django system check: passed, 0 issues.
- Backend tests: passed, 68 tests before remediation.
- Migration drift: none.
- Frontend lint: passed, 0 errors.
- Frontend build: passed; Vite emitted a non-blocking large-chunk advisory.
- Accounting health: all checks pass, including AR vs GL difference `0.00`.

## Remediation verification

- Added an AR/AP control-account guard to bank cash coding.
- Added the same guard to bank-rule validation.
- Removed AR/AP control accounts from the Cash Coding and Bank Rules selectors.
- Centralised ledger-effective statuses as `posted` and `reversed`.
- General Ledger now returns journal status and reversal identity for audit presentation.
- Reporting, bank balances, accounting health, tax reconciliation, year-end sourcing, consolidation sourcing, and financial anomaly queries use the shared semantics.
- Reversal regression tests prove original and reversal remain visible and net correctly in GL, Trial Balance, P&L, and control accounts.
- Django check, compilation, migration drift, and frontend lint passed after the change.

## Route inventory

The router contains 97 route declarations, including redirects, guards, the fallback route, and the shared layout routes. Active screens are grouped as follows:

- Authentication: login, organisation selection.
- Dashboard: `/`.
- Sales: customers, statements, invoices, quotes, orders, credit notes and details/edit/create routes where supported.
- Purchases: suppliers, statements, bills, orders, supplier credits and details/edit/create routes where supported.
- Banking: accounts, transactions, reconciliation, import, rules, cash coding.
- Inventory: products, product details, adjustments, receipts, issues, transfers, returns, counts, reports.
- Accounting: Chart of Accounts, account details, journals, journal details, financial year, period locks.
- Reports: General Ledger, Trial Balance, P&L, Balance Sheet, Cash Flow and breakdown, aged AR/AP, Reports Centre, Financial Analysis.
- Fixed Assets: register, detail, depreciation.
- Manufacturing: dashboard, BOMs, BOM details, orders, order details, reports.
- Payroll, Tax, FX, Consolidation, AI, Settings.

All route imports compile. ProtectedRoute requires authentication and an organisation. Manufacturing and Fixed Assets include feature permission guards. Action permissions remain backend-authoritative.

## QA evidence and limits

Static route/action/CSS review and automated suites were completed. A real multi-browser session, email delivery, live bank feed, external AI provider, production PostgreSQL, TLS, backups, and monitoring were not available in this local workspace. These are not represented as verified.

Demo seeding was executed twice against the existing demo owner. Counts stayed unchanged: contacts 11, invoices 4, customer payments 3, bills 4, supplier payments 3, bank accounts 1, bank transactions 2, products 5, warehouses 1, stock movements 4. The production safety guard remains enabled.
