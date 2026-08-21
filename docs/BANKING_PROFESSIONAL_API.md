# Professional Banking API

All endpoints use `/api/v1/`, JWT authentication, and Ledgify's organisation header.

## CSV imports

- `POST bank-imports/preview/` — multipart fields: `bank_account_id`, UTF-8 `file`, JSON `mapping`, optional Python-style `date_format`.
- `POST bank-imports/{id}/commit/` — imports READY rows atomically.
- `GET bank-imports/` and `GET bank-imports/{id}/` — batch statistics and auditable rows.

Map `transaction_date`, `description`, and either signed `amount` or debit/credit columns. Optional mappings are `reference`, `currency`, and `external_id`. Preview never creates bank transactions. Deterministic SHA-256 fingerprints prefer external IDs; otherwise they use organisation, bank account, date, amount, direction, and normalized reference. Duplicates within a batch and against previously imported rows are skipped.

## Bank rules

- `GET/POST bank-rules/`
- `GET/PATCH/DELETE bank-rules/{id}/`
- `POST bank-transactions/{id}/apply-rule/` with `{"rule_id":"uuid"}`.

Rules are evaluated by priority then UUID. Every configured direction, bank account, text, and amount condition must match. Rules add 100-confidence suggestions but never reconcile automatically. Explicit application calls the existing manual reconciliation service.

## Cash coding and reconciliation

- `POST bank-transactions/{id}/reconcile/`
- `POST bank-transactions/bulk-reconcile/` with transaction UUIDs and one target account UUID.
- `GET bank-transactions/queue/`
- `GET bank-transactions/{id}/suggestions/`
- `POST bank-transactions/{id}/accept-suggestion/`
- `POST bank-transactions/{id}/unreconcile/`

Bulk reconciliation is all-or-nothing. Supported list filters include bank account, status, type, dates, amount range, reference, and description/reference search. Exact existing accounting matches retain priority over rule suggestions.
