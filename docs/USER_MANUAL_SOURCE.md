# Ledgify User Manual Source

This guide describes the screens and workflows implemented in RC1. Available actions depend on your organisation role and the status of each document.

## Accounting basics

Every posted accounting entry has equal debits and credits. Debits normally increase assets and expenses; credits normally increase liabilities, equity, and revenue. Use the Chart of Accounts to organise these balances. Use journals only for genuine accounting entries, and reverse posted mistakes rather than editing history.

## Chart of Accounts and journals

Open **Accounting → Chart of Accounts** to search, filter, view, and—where allowed—edit accounts. Account Details shows posted activity and its balance. Control accounts are protected because invoices, bills, payments, stock, assets, tax, and payroll update their own subledgers.

Open **Accounting → Journals → New Journal** for a manual entry. Select at least two active eligible accounts, enter one-sided debit or credit amounts, and make totals equal. Draft entries can be reviewed; posted entries affect reports. Locked periods reject posting. Journal Details shows source, users, lines, totals, reversals, and source-document links.

## Receivables and payables

Accounts Receivable is money customers owe from approved invoices. Accounts Payable is money owed to suppliers from approved bills. Partial payments reduce the outstanding amount without closing the document. Credit notes reduce balances; refunds return available credit; bad-debt write-offs use the controlled sales workflow. Customer and supplier statements show the underlying activity.

## Quotes, orders, invoices, and bills

Quotes and sales orders manage the commercial process and do not recognise revenue merely by existing. Use supported conversion actions to create the next document. Draft invoices and bills can be edited. Approval posts their accounting. Record payments from the detail page or eligible row action until the amount due reaches zero. Posted/approved financial documents cannot be deleted or freely edited.

## Banking

Each bank account links to one bank-class ledger account. **Book Balance** comes from posted accounting. **Statement Balance** comes from imported bank transactions. Their difference represents activity still requiring reconciliation.

Import CSV statements through preview and duplicate checks. Reconciliation matches a bank row to existing accounting without creating a second payment or journal. Cash Coding creates accounting for genuine fees, income, or other unmatched activity. AR/AP control accounts are unavailable for cash coding; match customer or supplier payments instead. Bank Rules provide deterministic suggestions and do not silently auto-post. Unreconcile preserves history and reverses accounting where required.

## Financial reports

- Trial Balance shows cumulative account debits and credits as of a date and must balance.
- Profit & Loss shows revenue, expenses, and profit for a period.
- Balance Sheet shows assets, liabilities, and equity as of a date and must satisfy the accounting equation.
- Cash Flow classifies posted cash-account movements using configured categories.
- General Ledger shows opening balance, detailed postings, running balance, and journal links.
- Aged Receivables and Payables group open balances by age after payments and credits.

Use account links for drill-down. CSV, spreadsheet, and PDF exports are available on supported report screens.

## Financial ratios

Financial Analysis requests ratios from the backend using Balance Sheet, P&L, inventory, and AR/AP sources. It may show liquidity, profitability, efficiency, leverage, and working-capital measures when the required inputs exist. Open methodology to understand each formula; use comparison periods and drill-down rather than treating a single ratio as advice.

## Inventory and WAC

Products marked as inventory-tracked hold quantity by warehouse. Ledgify uses perpetual weighted-average cost (WAC): receipts add quantity and cost, then calculate a new average; issues use the current average. Historical cost layers are not rewritten. Products, Stock Movements, Stock Adjustments, transfers, returns, counts, valuation, and reorder reports use the backend inventory engine. An issue that would create negative stock is rejected.

## Fixed assets

The Fixed Asset register stores cost, residual value, useful life, method, and configured accounts. Activation posts the acquisition entry. Depreciation posts expense against accumulated depreciation and respects period locks. Disposal records sale, scrap, or write-off and calculates book value and gain/loss. RC1 implements accounting depreciation, not tax depreciation.

## Manufacturing

Bills of Materials define finished products and versioned components. Production Orders progress through release, material issue/return, labour, overhead, subcontract, partial/final completion, variance, and close where permitted. Material and other production costs accumulate in Work in Progress, then transfer to finished goods. The backend inventory, WAC, and journal engines remain authoritative.

## Tax, payroll, FX, and consolidation

Tax settings configure neutral tax rates, periods, transactions, and reports; electronic jurisdiction filing is not included. Payroll configures employees, components, runs, payslips, reports, and accounting posting, subject to jurisdiction limitations. FX stores dated rates and supports foreign documents, settlements, and controlled revaluation. Consolidation supports configured groups, mappings, eliminations, and full consolidation for 100%-owned subsidiaries; advanced consolidation methods are documented as unsupported.

## AI Assistant

The assistant receives limited organisation-scoped context and uses deterministic financial tools. It can explain reports, highlight anomalies, and prepare controlled proposals. Generated text cannot autonomously post high-risk accounting actions. Review sources and obtain professional advice for material decisions.

## Security, organisations, and settings

Select the correct organisation before working. Switching organisations clears and reloads organisation-scoped context. Owners/Admins manage settings, users, and roles; Accountants/Bookkeepers perform permitted accounting workflows; Viewers receive read-only access according to configured permissions. Backend permissions are authoritative even when the frontend hides an action.
