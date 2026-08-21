# Inventory Accounting Completion

## Implemented workflows

- Purchase receipts create a posted stock movement, append a perpetual WAC layer, and post Dr Inventory Asset / Cr the supplied GRNI or offset account.
- Sales issues are explicitly posted against an approved invoice. They use current WAC and post Dr COGS / Cr Inventory Asset.
- Transfers create linked transfer-out and transfer-in movements at identical WAC with no journal. Both warehouses and the transaction date are validated.
- Customer returns link to an original posted sale issue, use its issue cost, cap cumulative returns, and post Dr Inventory Asset / Cr COGS.
- Supplier returns optionally link to an original posted receipt, cap cumulative linked returns, use current WAC, and post Dr the supplied GRNI/AP/offset account / Cr Inventory Asset.
- Stock counts follow draft, counting, and posted states. Expected quantities are captured as of the count date; posting creates adjustments only for non-zero variances.

## Weighted-average costing

Receipts add quantity and cost, then divide total cost by total quantity. Issues multiply issued quantity by current average cost. An issue retains average cost unless stock reaches zero. Costing uses `Decimal`, rejects negative stock and back-dated layers, and appends immutable cost layers.

Example: 10 units at £20 plus 10 units at £30 produces 20 units valued at £500 and WAC £25. Issuing 4 units records £100 COGS and leaves 16 units valued at £400 at WAC £25.

## API and frontend

The router exposes products, warehouses, stock movements, stock adjustments, inventory transactions and their workflow actions, stock counts, valuation, and inventory reports. The frontend inventory service provides receipt, issue, transfer, customer return, supplier return, transaction, count, stock-on-hand, valuation, and reorder methods. Existing Ledgify page styles and shared components are reused.

## Reports

- Stock on hand by product and warehouse
- Perpetual WAC inventory valuation
- Movement history
- Negative stock audit
- Reorder report with explicit reorder quantity or calculated quantity toward maximum
- Slow- and fast-moving operational views

Reports are organisation-scoped. Reorder output includes product and preferred-supplier summaries and does not create purchase orders.

## Controls

- `VIEW_INVENTORY`, `MANAGE_PRODUCTS`, `MANAGE_WAREHOUSES`, and `ADJUST_STOCK` are reused to avoid unnecessary permission proliferation.
- Products, warehouses, accounts, source documents, and movements are organisation-validated.
- Journal posting and stock-count adjustments use the accounting period lock. Non-journal transfers explicitly validate the period too.
- Posted movements, inventory transactions, and cost layers cannot be edited or deleted through model or generic API paths.
- Journal source types distinguish receipt, issue, customer return, supplier return, stock count, and general inventory adjustment. Transfers create no journal.

## Tests

Coverage includes WAC receipts/issues, negative-stock rejection, transfer quantity/value preservation, supplier returns, stock-count variances and zero variances, as-of count snapshots, reorder recommendations, locked-period transfers, and historical immutability.

## Limitations and later work

- Purchase-order receipt linkage is supported through a generic source document UUID; no new purchase-order design was introduced.
- Invoice approval and inventory fulfilment remain separate actions.
- Supplier receipt linkage is optional for standalone returns; the settlement account is always explicit.
- No manufacturing, VAT/GST, FIFO, automatic purchase-order creation, or Milestone 7 functionality is included.
