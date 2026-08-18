# Ledgify RC1 Release Notes

Ledgify RC1 brings the integrated accounting application together for final QA. It includes organisation-scoped double-entry accounting, customer and supplier workflows, banking and safe reconciliation, perpetual weighted-average inventory, manufacturing/WIP accounting, fixed assets, payroll, tax, FX, consolidation, financial reports and ratios, controlled AI assistance, and the Settings control centre.

## Highlights

- Accounting: journals, posting/reversal, period controls, year-end close, account drill-down, Trial Balance, P&L, Balance Sheet, Cash Flow, aged AR/AP, and exports.
- Sales and purchases: commercial documents, invoices/bills, credits, partial payments, refunds, statements, and document detail workflows.
- Banking: linked ledger accounts, statement import, reconciliation suggestions, rules, cash coding, transfers, and unreconcile history.
- Inventory and manufacturing: WAC layers, valuation, movement/adjustment workspaces, stock counts, BOMs, production orders, WIP allocation, completion, and variance.
- Fixed assets: register, categories, activation, depreciation, disposal, and reports.
- Analysis: backend-authoritative financial ratios, methodology, drill-down, comparison, and exports.
- AI: organisation-scoped financial context, anomaly review, conversation history, and controlled action proposals without autonomous posting.
- UI: shared design language, responsive tables/forms, pagination, detail views, status badges, polished banking and inventory screens.

## RC1 safety correction

Cash coding and Bank Rules can no longer post directly to Accounts Receivable or Accounts Payable control accounts. Users must match customer/supplier payments so subledgers stay reconciled.

The RC1 regression suite also proves that matching a bank receipt to an existing canonical CustomerPayment reuses its journal and does not create a duplicate payment or posting. The clean, twice-seeded test database runs the full accounting health command.

Journal reversal reporting now treats both posted and subsequently reversed original journals as ledger-effective. Separate posted reversal journals remain additive entries. This restores correct historical audit visibility and resolves the £375 AR health-check difference without modifying JE-000018, JE-000020, JE-000021, or their reversals.

## Release status

Automated code gates and accounting health pass. RC1 is Demo Ready. Staging and Production readiness still require the infrastructure evidence listed in `KNOWN_LIMITATIONS.md`.
