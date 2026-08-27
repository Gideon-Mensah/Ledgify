# Cash Flow Statement accounting policy

Ledgify produces an organisation-scoped **direct-method** Cash Flow Statement from ledger-effective journal lines. It does not use accrued Profit and Loss amounts as a substitute for cash movements.

## Ledger scope

- Only journals in the canonical ledger-effective statuses (`posted` and `reversed`) are included.
- A reversed original remains effective alongside its posted reversal, so the two entries net correctly.
- Journal dates are inclusive of the selected start and end dates.
- Every query is restricted to the selected organisation.

## Cash and cash equivalents

An account is treated as cash when any established metadata identifies it as such:

1. `cash_flow_category` is `cash`;
2. `account_class` is `bank`; or
3. the ledger account has an organisation-owned Banking account profile.

Account names, descriptions and hard-coded account codes are not used.

## Direct-method allocation

For each balanced journal containing recognised cash lines:

- Cash movement is debit minus credit on all recognised cash lines.
- Pure transfers between recognised cash accounts are excluded because their net organisation-wide cash movement is zero.
- Each non-cash counterpart contributes `credit - debit` to cash flow. Signed counterpart contributions must add exactly to the journal's net cash movement.
- Compound journals therefore retain their exact counterpart allocation without absolute-value weighting or duplication.
- Journals without a recognised cash account are non-cash and excluded.

## Classification policy

An account's explicit `cash_flow_category` (`operating`, `investing` or `financing`) takes precedence. Otherwise the account class supplies the fallback:

- **Investing:** fixed assets.
- **Financing:** equity, retained earnings and long-term liabilities.
- **Operating:** current assets, receivables, current liabilities, payables, sales, other income, cost of sales and operating/other expenses.
- Any remaining non-equity counterpart defaults to operating; remaining equity defaults to financing.

This makes owner capital and borrowing cash movements financing activities while retaining an explicit override for organisation-specific policies such as interest or tax classification.

## Balances and reconciliation

- Opening Cash Balance is the ledger-effective balance of all recognised cash accounts strictly before the start date.
- Net Change in Cash is the sum of classified cash movements from the start date through the end date, inclusive.
- Closing Cash Balance is Opening Cash Balance plus Net Change in Cash.
- The report separately calculates the cash-ledger balance at the end date and returns the difference and balanced status. A mismatch is displayed; it is never hidden or forced to zero.

Cash Flow closing cash should reconcile to the sum of the same recognised cash and cash-equivalent accounts in the Balance Sheet at the same date.
