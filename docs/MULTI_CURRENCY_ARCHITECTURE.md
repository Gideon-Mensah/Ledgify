# Ledgify multi-currency architecture

Each organisation has one functional `base_currency` and an optional presentation `reporting_currency`. The base currency becomes immutable when journals exist. Transactions may use any active configured `Currency`.

`ExchangeRate` stores immutable dated observations. Rates express transaction/base conversion as `transaction amount × rate = base amount`; the service also supports inversion. Selection uses the latest observation on or before the accounting date, and all calculation uses `Decimal` with currency rounding.

Invoices, bills, credits, and payments retain their transaction currency, exchange-rate snapshot, and base amount. Journals are posted exclusively in functional currency while retaining transaction metadata. Changing or adding rates never recalculates historical documents.

Foreign settlement compares the document-rate base value settled with the payment-date base value. Customer and supplier payment journals post the difference to configured organisation FX gain/loss accounts. Bank ledger accounts must use the payment currency.

Receivable, payable, and foreign-bank revaluations append a posted journal and `FXRevaluation` audit record. They never alter original documents. Reports expose dated rates, realised settlement differences, unrealised revaluations, and foreign invoice/bill exposure.

Current enhancements left for later include automated market-rate feeds, batch selection of all open subledger items, automatic reversal of prior-period revaluations, triangulation through a third currency, consolidated group reporting, and hedge accounting.
