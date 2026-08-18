# Commercial Workflows API

All routes use `/api/v1/`, JWT authentication, and the organisation header used by Ledgify.

## Quotes

- `GET/POST quotes/`
- `GET/PATCH/DELETE quotes/{id}/` (changes/deletion are draft-only)
- `POST quotes/{id}/accept/`
- `POST quotes/{id}/convert-to-invoice/`

Create lines use `description`, `quantity`, `unit_price`, zero `tax_rate`, optional `product_id`, and `revenue_account_id`. Conversion request:

```json
{"document_number":"INV-100","issue_date":"2026-08-13","due_date":"2026-09-12"}
```

Quotes create no journals, inventory movements, or receivables.

## Sales orders

- `GET/POST sales-orders/`
- `POST sales-orders/{id}/approve/`
- `POST sales-orders/{id}/fulfil/`
- `POST sales-orders/{id}/convert-to-invoice/`

Fulfilment request:

```json
{"line_id":"uuid","warehouse_id":"uuid","quantity":"2.0000","transaction_date":"2026-08-13"}
```

Fulfilment uses perpetual WAC and posts COGS/Inventory. Invoice conversion creates a draft invoice; revenue and AR post only when that invoice is approved.

## Purchase orders

- `GET/POST purchase-orders/`
- `POST purchase-orders/{id}/approve/`
- `POST purchase-orders/{id}/receive/`
- `POST purchase-orders/{id}/convert-to-bill/`

Receipt request:

```json
{"line_id":"uuid","warehouse_id":"uuid","quantity":"2.0000","transaction_date":"2026-08-13","grni_account_id":"uuid"}
```

Receipt posts Dr Inventory / Cr the supplied GRNI account. Bill conversion links received inventory transactions so bill approval posts Dr GRNI / Cr AP without debiting inventory again. Non-inventory lines retain expense/asset bill behavior.

## Credits and refunds

Existing routes remain canonical:

- `customer-credit-notes/` with `approve/` and `apply/`
- `customer-refunds/`
- `supplier-credits/` with `approve/` and `apply/`
- `supplier-refunds/`

Available-credit checks, allocation limits, accounting journals, organisation isolation, and period locking remain in their existing services.

## Returns

Physical customer and supplier returns remain inventory transactions under `inventory-transactions/customer-returns/` and `inventory-transactions/supplier-returns/`. Financial credit documents remain separate to prevent duplicate stock and AR/AP effects.
