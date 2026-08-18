# Professional Banking Completion

Ledgify Banking now supports auditable UTF-8 CSV preview and commit, configurable column mapping, signed or debit/credit amount formats, deterministic duplicate detection, import history, deterministic bank rules, rule suggestions, explicit rule application, atomic bulk cash coding, reconciliation queue data, and server-side search/filtering.

Imports are bank-feed evidence only and create no journal. Manual coding and rule application reuse the existing reconciliation service, so period locking, balanced journals, permissions, reconciliation history, and unreconciliation reversal behavior remain centralized. Raw files are not persisted.

The active frontend includes statement import/preview/history, real bank-rule creation/listing, and real bulk cash coding using existing Ledgify styles. Existing reconciliation pages continue to use suggestion acceptance and unreconciliation APIs.

Limitations: OFX/QFX was not added because no maintained parser dependency exists in the project; CSV heading mapping currently uses the import screen's common default headings while the API supports arbitrary mappings; rule application is explicit rather than automatic; no live Open Banking, FX reconciliation, or AI categorisation is included.
