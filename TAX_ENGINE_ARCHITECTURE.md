# Ledgify indirect-tax engine

The tax app is country-agnostic. An organisation opts into tax, defines effective-dated `TaxRate` records, and maps each rate to its own input and/or output control account. No rates, account codes, filing boxes, or jurisdiction rules are built into core logic.

Document lines keep both a nullable configured-rate relationship and the numeric percentage/amount snapshots. Draft creation calculates each line with `Decimal` and `ROUND_HALF_UP` to two currency decimals; document totals are sums of rounded lines. Posted documents and tax transactions are not recalculated when a configured rate changes.

Posting behavior:

- Sales invoice: debit receivables gross, credit revenue net, credit configured output tax.
- Customer credit: debit revenue and output tax, credit receivables gross.
- Supplier bill: debit expense/asset net, debit configured recoverable input tax, credit payables gross.
- Supplier credit reverses the original purchase treatment.
- Non-recoverable purchase tax is added to the line expense/asset debit and is excluded from recoverable input-tax totals.
- Inventory receipts remain net. Recoverable tax is recognized at supplier bill. Non-recoverable tax is included in the bill-side asset/cost amount; automated WAC capitalization of a later bill-only tax adjustment remains a future workflow.

`TaxTransaction` is an immutable reporting subledger created only after successful journal posting, grouped by document and rate. The general ledger remains authoritative. Tax periods are separate from accounting periods; filed/locked tax dates reject new qualifying postings and corrections must use later adjustment documents.

Generic reports expose sales net, output tax, purchase net, input tax, credit adjustments, net position, transaction detail and GL reconciliation. `TaxJurisdictionAdapter` defines validation, mapping and payload hooks. Production electronic filing and jurisdiction-specific mappings are intentionally not implemented.

API roots: `tax-rates/`, `tax-transactions/`, `tax-periods/`, `tax/reports/summary/`, `tax/reports/liability/`, and `tax/reports/returns/preview/`.

## Operational UI and filing boundary

The Tax Settings screen edits organisation registration data and manages effective-dated tax rates with real chart-of-account selectors. Invoice and bill editors load active, correctly scoped rates, filter them by document date, and send the selected rate identifier to the backend. Both exclusive and inclusive presentation modes use the same backend calculation service as final authority. Tax navigation exposes settings, rates, periods, summaries, transactions and return previews. Filing controls are intentionally absent.

The core VAT/GST/sales-tax engine and operational UI are implemented. `TaxJurisdictionAdapter` is the only current adapter foundation. Electronic filing adapters are not production enabled; each jurisdiction needs a separately researched validation, return-mapping and transport package.

## Bounded inventory limitation

Recoverable purchase tax never enters WAC. For a supplier bill matched after receipt, fully capitalizing later non-recoverable tax would be wrong when some units have already been issued: the amount must be split deterministically between remaining inventory and COGS. The current immutable cost-layer model does not retain the receipt-to-issued-unit attribution needed for a reliable split. Consequently bill-side non-recoverable tax is posted to the selected cost/asset account, but no automatic WAC layer is appended. A future costing enhancement must introduce an explicit capitalization transaction and allocation policy; historical receipt layers will not be edited.
