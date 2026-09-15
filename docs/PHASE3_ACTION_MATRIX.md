# Phase 3 document action matrix

Verified locally on 12 September 2026. All entries require authenticated membership of the selected organisation. Backend permissions and source-domain validation remain authoritative. A visible button is never permission to bypass an API check.

## Document states and actions

| Document | Action | Permission | Eligible state / constraint | Behaviour |
|---|---|---|---|---|
| Invoice | View / Print | `view_accounting` | Saved, valid document with lines and organisation identity | Authenticated document contract; fresh data before Print |
| Invoice | Download PDF | `export_reports` | Same; requested version must still match | Server PDF, otherwise clear error / HTTP 409 |
| Invoice | Edit | `create_invoice` | Draft | Existing Django-backed edit form |
| Invoice | Approve | `approve_invoice` | Draft | Backend posting; refresh after success |
| Invoice | Email | `create_invoice` | Approved, sent, partly paid, paid | Recipient/subject/message modal, UUID key; backend acceptance required |
| Invoice | Record payment | `create_customer_payment` | Approved/sent/partly paid/paid and positive amount due | Existing Phase 2 idempotent source workflow |
| Invoice | Reverse document | `reverse_journal` | Posted, no paid/credited amount; server also checks dependencies, write-offs and period | Explicit reason/date/confirmation; invoice source endpoint |
| Bill | View / Print / PDF | `view_accounting` / `export_reports` for PDF | Saved document; valid identity and lines | Same contract/view/PDF implementation as invoice |
| Bill | Edit / Approve | `create_bill` / `approve_bill` | Draft | Backend workflow |
| Bill | Record payment | `create_supplier_payment` | Posted and positive amount due | Existing Phase 2 idempotent source workflow |
| Bill | Reverse document | `reverse_journal` | Unsettled posted bill; dependency and period checks on server | Bill source endpoint; reason/date/confirmation |
| Bill | Email | None | Unsupported | Hidden |
| Customer / supplier credit | View / Print / PDF | `view_accounting` / `export_reports` for PDF | Saved document | Dedicated authenticated document route |
| Customer / supplier credit | Approve | `approve_customer_credit` / `approve_supplier_credit` | Draft | Confirmation and backend posting |
| Customer / supplier credit | Generic reverse / Email | None | Unsupported | No shortcut added |
| Customer / supplier payment | View confirmation / Print / PDF | `view_accounting` / `export_reports` for PDF | Saved payment | Dedicated authenticated receipt/confirmation route |
| Customer / supplier payment | Reverse | `reverse_journal` | Unreversed payment; server validates reconciliation and dependencies | Corresponding payment source endpoint from invoice/bill history; reason/date/confirmation |
| Manual journal | View / Print / PDF | `view_accounting` / `export_reports` for PDF | Saved journal; no empty lines for printing | Existing detail plus shared document route |
| Manual journal | Post | `post_journal` | Draft, balanced, open period | Existing confirmed backend workflow |
| Manual journal | Reverse | `reverse_journal` | Manual, posted, not already reversed | Existing confirmed manual-journal workflow |
| Source-generated journal | Generic reverse | None | Invoice, bill, payment and other sources | Hidden in UI; Phase 2 backend prohibition retained |
| Opening balance | Print / PDF | `view_accounting` / `export_reports` for PDF | Saved record; unsaved/dirty form cannot export a saved summary | Shared document route; existing opening-balance approval lifecycle retained |
| Statements | View / Print / PDF | `view_accounting` / `export_reports` for PDF | Scoped contact, valid date filters | Phase 2 historical statement values in base currency |
| Financial / bank reconciliation reports | Export menu | `export_reports` | Successfully loaded rows; bounded size | Print, CSV, Excel, PDF; fresh saved organisation identity |

Draft, awaiting-approval, void and written-off invoices/bills cannot be emailed or paid. Only draft documents can be edited/approved here. Email is enabled only for the four explicitly listed invoice states. State-ineligible reversal is disabled with an explanation; dependent-credit, locked-period and other server-only facts return the backend's safe explanation. Payment reconciliation rejection is shown after submission; the history does not pretend to know every bank dependency locally.

Invoice/bill “More actions” and legacy placeholder alerts were removed. Native buttons support keyboard/touch. Report menus close on Escape, outside pointer interaction and completed selection. Modal submission and source mutation guards prevent repeated clicks; email and payment creation additionally use server-enforced UUID idempotency. Source reversals retain Phase 2 locking and already-reversed checks.

## Role mapping

Source of truth: `accounting-backend/apps/organisations/permissions.py` (`ROLE_PERMISSIONS`), not hard-coded frontend role names.

| Role | View | PDF / report export | Invoice email | Draft invoice/bill creation and payment | Approve invoice/bill/credit | Source reversal | Edit organisation identity |
|---|---|---|---|---|---|---|---|
| Owner | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Admin | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Accountant | Yes | Yes | Yes | Yes | Yes | Yes | No |
| Bookkeeper | Yes | Yes | Yes | Yes | No | No | No |
| Approver | Yes | Yes | No | No | Yes | No | No |
| Viewer | Yes | Yes | No | No | No | No | No |
| Employee | Yes | No | No | No | No | No | No |

Print remains a view operation; export permission does not prevent an authorised viewer using the browser's own printing facilities.

## Verification

- `tests/documentActions.test.mjs`: invoice/bill state × permission truth tables, settlement restrictions, identity isolation, no routed financial-storage dependencies and manual-only generic reversal UI.
- `apps.sales.test_documents`: every defined role's JSON/PDF/email permissions, foreign IDs/organisation headers, stale versions, approved versus draft email, locked/settled source reversal, rates and concurrent UUID replay.
- Complete Django suite: existing source lifecycle and permission regressions, including credit/payment/manual-journal protections.
- Chromium: invoice actions on desktop and 390px mobile, actual in-memory email acceptance, confirmed invoice reversal followed by reload, live organisation switch, report menu Escape/outside dismissal and multipage printing.

These are the recorded automated cases, not a claim that every possible financial dependency has been exercised through every browser button. Repeat the matrix on representative staging data before public rollout, especially bank-linked payment rejection and each organisation's existing credit dependencies.
