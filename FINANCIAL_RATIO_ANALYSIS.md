# Financial Ratio Analysis

Ledgify calculates ratios from posted-ledger Balance Sheet and Profit & Loss services, finance aging services, and perpetual weighted-average inventory valuation. The frontend only presents structured results returned by the backend.

## Ratio groups and formulas

- Liquidity: working capital, current ratio, quick ratio, and cash ratio.
- Profitability: gross, operating and net profit margins, return on average assets, and return on average equity.
- Efficiency: receivable days, inventory turnover, inventory days, and asset turnover.
- Leverage: debt-to-equity and debt ratio.
- Supporting metrics: total and overdue receivables and payables.

Opening balances are measured on the day before the selected period. Average assets, equity, receivables, and inventory are the arithmetic mean of opening and closing values. Day-based ratios use the inclusive number of days in the selected period.

Current assets use `bank`, `current_asset`, and `receivable` account classifications. Current liabilities use `current_liability` and `payable`. Cash uses the `bank` classification. Quick assets exclude inventory obtained from the inventory valuation service; no account codes or account names are inspected.

Receivable days currently uses revenue as a documented approximation because credit sales are not separately classified. Payable days and interest coverage are unavailable until credit purchases and interest expense have explicit accounting metadata. No values are fabricated.

Zero denominators return `not_available`, never infinity or NaN. Negative results are preserved. Negative equity carries an interpretation limitation. Comparison changes and commentary are deterministic and do not apply universal industry benchmarks.

All source statements use organisation-scoped posted entries and the organisation base/reporting currency. Consolidated ratios are not represented as supported. The read-only AI entry consumes the structured ratio response and must not recalculate figures from documents or raw ledger rows.
