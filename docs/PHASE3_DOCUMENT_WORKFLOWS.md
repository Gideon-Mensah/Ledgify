# Phase 3: customer documents, printing, email and essential actions

Local implementation and verification completed on 12 September 2026. **This is not a public-launch approval.** Real SMTP delivery, staging acceptance and the earlier audit's commercial/operational requirements remain outstanding. No production data was used or changed.

## 1. Phase 2 checkpoint

Checkpoint: **`bd289f05a6782e06083cd22c1f59cc9798ff75b7`** — **Protect accounting integrity and transaction concurrency**.

Before committing, the Phase 2 diff's 124-file inventory was compared with `docs/PHASE2_ACCOUNTING_INTEGRITY.md`; no missing or extra paths were found. Key accounting, model-guard, concurrency and import changes were inspected and `git diff --check` passed. Phase 1 checkpoint remains `7d78029d2147cac61f23eff18505c0089f7f3536`. Phase 3 changes remain uncommitted. Nothing was pushed or deployed.

## 2. Customer-facing defects repaired

- Routed invoice and bill details now use authorised Django data and actions. Legacy browser-storage Email/Reverse handlers and dead “More actions” were removed.
- Invoice email attaches a server-generated PDF, records a durable attempt and reports **Accepted for delivery** only after the configured transport accepts it. Rejection/failure never marks the invoice sent or paid.
- Shared document views use saved organisation identity and persisted financial values; browser-supplied company details, totals and PDF content are not trusted by the email API.
- Print rules formerly hiding all document content are scoped to their owning pages. Shared screen minimum heights no longer create a blank final page. Report tables remain visible after other modules load their print CSS.
- Invoice/bill source reversals and payment reversals use their source APIs, with confirmation, reason, date, backend validation, reload and audit display.
- Missing identity/data, stale document versions and failed PDF preparation produce errors instead of empty downloads or fictitious defaults.
- Report export menus support Escape/outside dismissal; financial reports, ledger and bank reconciliation have bounded export/print paths.

## 3. Legacy storage inventory

The dependency-graph regression starts at `src/main.jsx` and follows local static/dynamic imports. The only reachable modules containing `localStorage` are `src/services/authStorage.js` (session/organisation selection) and `src/utils/organisationCurrency.js` (display context). Neither is accounting storage or a server tenant boundary. Phase 1 membership/header checks remain authoritative.

`InvoiceDetailsPage.jsx` and `BillDetailsPage.jsx` no longer import legacy invoice/bill/journal financial services. Four old PDF utilities now delegate to authenticated server downloads. Unrouted prototype code is retained rather than deleting unrelated work. The following storage services still exist **outside the routed dependency graph**:

`accountService.js`, `supplierService.js`, `bankAccountService.js`, `customerService.js`, `invoiceInventoryService.js`, `stockAdjustmentService.js`, `yearEndCloseService.js`, `periodLockService.js`, `creditNoteService.js`, `purchaseOrderService.js`, `bankTransactionServices.js`, `invoiceService.js`, `reconciliationServices.js`, `bankRuleServices.js`, `billInventoryService.js`, `quoteService.js`, `journalService.js`, `fixedAssetService.js`, `billService.js`, `productService.js` (all under `src/services/`).

Do not reconnect these prototypes to routes. Run the graph regression whenever routing changes. Unrouted placeholder text is not claimed to have been deleted repository-wide; rendered document checks and the active graph establish the customer-facing boundary.

## 4. Email architecture and status meaning

Implementation: `accounting-backend/apps/sales/services/documents/email_invoice.py`, invoice actions in `apps/sales/views.py`, `InvoiceEmailAttempt` in `apps/sales/models.py`, and `src/components/invoices/EmailInvoiceModal.jsx`.

`POST /api/v1/invoices/<id>/email/` requires authenticated active-organisation membership and `create_invoice`; foreign IDs return a safe scoped response. Allowed states: approved, sent, partly paid, paid. `GET .../email-attempts/` exposes the latest 50 scoped safe attempt summaries to the same permission.

The request carries an `Idempotency-Key` UUID, optional recipient override (otherwise the saved customer email), subject, short message and optional document version. Recipient/subject header injection is rejected before trimming. Both escaped HTML and plain-text bodies are sent. The attachment is generated from the trusted contract; a deterministic renderer test establishes byte equality with the direct PDF for the same contract.

A transaction and organisation lock create one pending attempt before SMTP runs outside the transaction. Unique `(organisation, key)` prevents concurrent duplicate attempts. Same-key/same-payload retries return the recorded attempt; a changed payload returns HTTP 409. Redis atomic counters enforce default limits of 20 attempts/user/hour and 100/organisation/hour across processes; cache failure rejects sending. Rate limits are configurable through `INVOICE_EMAIL_USER_RATE` and `INVOICE_EMAIL_ORGANISATION_RATE`.

Attempts record organisation, invoice, actor, recipient, subject, timestamps, hashes, UUID, status, application Message-ID and safe failure category. No SMTP credentials or raw provider responses are stored. The Message-ID is generated before sending, so an interrupted attempt can be investigated.

- **Pending:** an attempt exists; acceptance is not established. Do not automatically resend after a crash.
- **Sent / Accepted for delivery:** Django transport returned one accepted message. This does **not** establish inbox delivery, reading or absence of a later bounce.
- **Failed:** a safe failure category is recorded. Transport timeout/unknown outcome may still have reached the provider; inspect the Message-ID before intentionally creating a new send.

This is durable at-most-once submission per key, not a claim of exactly-once SMTP delivery. No background retry worker or delivery webhook is introduced. A new logical send needs a new key. Accepted modal submissions cannot accidentally repeat on reopening the same component.

With `DEBUG=false`, only the SMTP backend with a configured host and valid non-local sender is accepted. Console/file/dummy backends cannot produce invoice-email success; in-memory transport is allowed only in debug/test configuration. The project's development email default remains console, but the invoice-email service rejects it. `EMAIL_TIMEOUT` defaults to 20 seconds. Real provider delivery was **not** tested.

## 5. Organisation fields and migrations

Existing legal/trading name, address, country, phone, email, website, registration number, tax number and base currency are reused. Added only:

- `ghana_post_gps` (30 characters).
- `payment_instructions` (2,000 characters; bank/mobile-money instructions entered by the organisation).
- `logo_data` (private canonical PNG data, validated from uploaded PNG/JPEG).

Settings saves use existing organisation-management permission. Logos reject external URLs/SVG, oversized text and images over four megapixels; Pillow decodes/re-encodes, resizes to at most 600×300 and bounds stored output. The UI accepts PNG/JPEG up to 250 KB. Logos live in the database and are served in authenticated contracts, not a public file URL. Only explicit document identity fields are included, not confidential organisation configuration.

Migrations:

- `accounting-backend/apps/organisations/migrations/0007_organisation_ghana_post_gps_organisation_logo_data_and_more.py`
- `accounting-backend/apps/sales/migrations/0014_invoiceemailattempt.py`

No historical accounting backfill or production migration was performed. Missing optional identity fields are omitted; missing name requires organisation setup. No company, registration, address or bank defaults are invented. Ghana and UK fixtures were independently verified.

## 6. Print/PDF and document contracts

`common/documents.py` owns versioned contracts and ReportLab A4 PDFs; `common/document_views.py` exposes authenticated JSON and PDF endpoints. `DocumentView.jsx`, `SavedDocument.jsx` and `SourceDocumentPage.jsx` consume those values. PDF responses are private/no-store with safe filenames; stale version requests reject with HTTP 409. Read paths are organisation scoped and use Phase 2 ledger locking for consistent contracts.

| Documents | Presentation / source |
|---|---|
| Invoice, bill, customer/supplier credit | Persisted source lines and totals → contract → screen, browser print and server PDF; invoice email uses identical PDF renderer |
| Customer/supplier statement | Phase 2 historical statement → base-currency contract with opening/closing balances and dated ledger rows |
| Manual journal, opening balance | Saved accounting lines → base-currency contract; no export of an unsaved opening-balance form |
| Customer/supplier payment confirmation | Saved payment → authenticated contract/document/PDF |
| Quote, sales order, purchase order | Same shared contract route additionally exposed from existing detail pages |
| P&L, Balance Sheet, Trial Balance, Cash Flow, Aging, Account Details | Existing Phase 2 API report values; shared export menu and saved identity, existing scoped financial screen print |
| General Ledger | All supplied account opening balances, transactions and closing balances flattened without recalculating decimals; private IDs omitted |
| Bank reconciliation | Existing backend transaction/summary results; shared report exports and metadata |

Document PDFs use transaction currency where appropriate, base currency for accounting/statement totals, escaped paragraphs, repeated table headings, wrapping, A4 margins, black text and numbered pages. Totals are kept together. Statement description columns are wider to avoid unnecessary splits. Standard fonts were visually verified for the English GHS/GBP fixtures; all international writing systems are not claimed tested.

Server generation limits: 1,000 document/statement rows, bounded cell text, 1 MB contract, bounded notes/reference, 10 MB resulting PDF. Reports reject missing/empty input and more than 10,000 rows. Production worker timeouts and load testing remain operational requirements; row limits are not a measured execution-time guarantee.

Client report CSV/Excel/PDF uses the existing Phase 2 results rather than new accounting calculations. CSV formula prefixes (including leading whitespace) are escaped. Printable report iframes use DOM text nodes, their own CSS and awaited fonts/images. Source/saved-document Print refreshes data and waits for layout/fonts/images; source and iframe printing check organisation selection again immediately before printing. Phase 1 request invalidation/keyed organisation layout remains in place.

## 7. Reversals and essential actions

`SourceDocumentPage.jsx` calls invoice/bill `/reverse/` or the matching customer/supplier-payment `/reverse/`, never generic journal reversal. The backend owns period, settlement, dependent-credit, reconciliation and repeat-reversal checks. The UI requires reason/date/explicit confirmation, waits for success and reloads the document contract and payments; subsequent reports load authoritative ledger data. It displays the correction reference, actor, reason and date. Generic journal reversal is offered only for manual posted journals without a previous reversal.

No unsupported credit, refund, payroll, asset or consolidation reversal shortcut was added. Existing Phase 2 restrictions and immutability/concurrency tests remain passing.

## 8. Action/state/permission matrix

See **[PHASE3_ACTION_MATRIX.md](PHASE3_ACTION_MATRIX.md)** for document actions, states, permission strings, role mapping and verification boundaries.

## 9. Tests and exact results

All commands below were local. Backend commands ran from `accounting-backend` with `PYTHONDONTWRITEBYTECODE=1`; PostgreSQL was version 16 on loopback port 15432 and shared Redis on 16379. No SQLite substitution or concurrency-test skip was used.

| Check | Command | Final result / evidence |
|---|---|---|
| Focused document/email/concurrency | `DATABASE_URL=postgresql://phase1@127.0.0.1:15432/phase1 DJANGO_CACHE_URL=redis://127.0.0.1:16379/0 venv/bin/python manage.py test apps.sales.test_documents --noinput` | **16 passed, 5.399s**, `/tmp/ledgify-phase3-focused-final.log` |
| Complete Django | Same environment, `venv/bin/python manage.py test --noinput` | **211 passed, 78.021s**, no skips, `/tmp/ledgify-phase3-full-final.log`; all nine seeded accounting health differences zero |
| Frontend | `npm test` | **61 passed, 0 failed, 0 skipped, 202.845625ms**, `/tmp/ledgify-phase3-frontend-final.log` |
| Lint | `npm run lint` | Exit 0, `/tmp/ledgify-phase3-lint-final.log` |
| Production build | `npm run build` | Exit 0, **315ms**, `/tmp/ledgify-phase3-build-final.log`; existing >500 KB chunk warning remains |
| Migration consistency | `DATABASE_URL=postgresql://phase1@127.0.0.1:15432/ledgify_phase3 DJANGO_CACHE_URL=redis://127.0.0.1:16379/1 venv/bin/python manage.py makemigrations --check --dry-run` | **No changes detected**, `/tmp/ledgify-phase3-migrations.log` |
| Synthetic secure production | From root: `PYTHONDONTWRITEBYTECODE=1 accounting-backend/venv/bin/python /tmp/ledgify-phase1-deploy-check.py` | **System check identified no issues (0 silenced)**, `/tmp/ledgify-phase3-deploy.log`; synthetic secure environment, not hosting verification |
| Chromium regression | `node scripts/verify-document-print.mjs` | **7 recorded checks passed** plus disabled-route assertions; `/tmp/ledgify-phase3-browser-final.log` |
| Extended Chromium | `node /tmp/ledgify-phase3-browser-extended.mjs` | **7 checks passed**, source reversal/reload, actual live switch, financial reports/menu; `/tmp/ledgify-phase3-browser-extended-fourth.log` |
| Ledger pagination refinement | `node /tmp/ledgify-phase3-ledger-print.mjs` | Exit 0, 12-page ledger, `/tmp/ledgify-phase3-ledger-print.log` |
| Direct PDF generation | `node /tmp/ledgify-phase3-downloads.mjs` | Six authenticated GHS/GBP server PDFs generated |
| Render/inspect PDFs | `PYTHONDONTWRITEBYTECODE=1 accounting-backend/venv/bin/python scripts/inspect-document-pdfs.py` | **75 non-empty pages in 19 PDFs, zero out-of-bounds text**; every final page visually inspected |
| Whitespace | `git diff --check` | Exit 0 |

The tests cover cross-organisation IDs/headers, spoofed payload fields, all defined role permissions for document JSON/PDF/email, GHS/GBP, transaction currency differing from base, optional/essential identity, logo validation, header injection, HTML/plain text, provider rejection/unknown failure, stale versions, both Redis limits, and simultaneous PostgreSQL submissions producing one attempt/transport call. Source reversal success, locked-period rejection and settled rejection are exercised. Frontend tests cover invoice/bill action truth tables, safe downloads, identity changes, routed storage and scoped print styles.

Intermediate failures were resolved: test-only DEBUG/transport configuration; concurrency-test connection cleanup; FX/period fixture API mistakes; obsolete jsPDF/global-hide assertions; import-graph handling of JSON paths; browser script selectors/waits; and the actual print defects (selector specificity, minimum page height, statement/ledger column widths). An initial migration check pointed at the test-only `phase1` name and warned that it did not exist; rerunning against the migrated disposable `ledgify_phase3` database passed cleanly. These are not reported as unresolved failures.

## 10. Browser screenshots and every-page inspection

Artifacts: **`/tmp/ledgify-phase3-artifacts/`**. These are synthetic local fixtures, not customer files. Logs and temporary fixtures are not source-controlled; the token-bearing fixture is intentionally not embedded in this report.

- `desktop.png`, `mobile.png`: actual UI at 1440px and 390px; no horizontal viewport overflow in the tested invoice workflow.
- `browser-results.json`, `extended-browser-results.json`: executed checks.
- `pdf-inspection.json`: each PDF page, text count, bounds result and rendered PNG path.
- `final-inspection-1.png` through `final-inspection-7.png`: contact sheets inspected during review. The corrected `server-statement-GHS-page-1.png` through `-3.png` and final `statement-final-inspection.png` supersede earlier statement pages in those sheets.

| Final PDF files | Pages |
|---|---:|
| `invoice-desktop`, `invoice-mobile`, `after-accounts`, `after-journals`, `after-profit-and-loss` | 6 each |
| `gbp-invoice` | 1 |
| `profit-and-loss`, `trial-balance`, `balance-sheet`, `cash-flow` | 3 / 5 / 1 / 1 |
| `general-ledger` | 12 |
| `multipage-statement`, `statement` | 5 each |
| `server-invoice-GHS`, `server-invoice-GBP` | 5 / 1 |
| `server-journal-GHS`, `server-journal-GBP` | 1 each |
| `server-statement-GHS`, `server-statement-GBP` | 3 / 1 |

All 75 final pages contain document text. Render/bounds checks and visual review found no blank pages, clipped text or overlapping content in these fixtures. The invoice's final page carries totals/payment instructions, not an empty trailing sheet. Black text was checked with print background graphics disabled. Fresh navigation and SPA navigation from journals, reports and banking were exercised. Broader browser/printer compatibility is a staging acceptance task, not implied by Chromium results.

Reusable `scripts/verify-document-print.mjs` accepts `DOCUMENT_APP_URL`, `DOCUMENT_CDP_URL`, `DOCUMENT_FIXTURE_FILE`, `DOCUMENT_ARTIFACT_DIR`, defaults to the local Phase 3 services and refuses non-loopback service hosts. It requires a pre-seeded synthetic fixture containing tokens plus two `fixtures` entries (`organisation`, `invoice`, `customer`, `journal`); use an in-memory Django email backend. It intentionally submits one synthetic invoice email. `scripts/inspect-document-pdfs.py [artifact-directory]` renders every PDF and fails for empty/out-of-bounds pages; human visual review is still required for overlap. Do not run these mutation checks against production or copy fixture tokens into source control.

## 11. Manual SMTP, storage and deployment requirements

1. **SMTP:** Configure `EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`, `DEFAULT_FROM_EMAIL`, `EMAIL_TIMEOUT` through server secret management. Verify the sender domain/provider requirements and appropriate TLS. Test a consenting staging mailbox: acceptance, actual receipt, attachment, bounce, rejection and timeout. Check Message-ID against provider logs; do not equate acceptance with delivery.
2. **Redis:** Use shared authenticated production Redis for all workers, retain Phase 1 security settings, choose appropriate invoice limits and monitor 429/503 rates. Verify concurrent workers respect one user/organisation budget and fail closed during a controlled cache outage.
3. **Database and migrations:** Restore-test a backup, perform the Phase 2 legacy integrity review, rehearse both new migrations with the actual restricted role in PostgreSQL staging, and verify existing invoices/amounts are unchanged. Back up logo data and email-attempt history with the database. Test restoration, retention and authorised deletion policy; do not use migration rollback as financial-data recovery.
4. **Deployment:** Install pinned runtime requirements (ReportLab/Pillow) and test requirements separately. Release matching frontend/backend versions only after approval in a later phase. Verify real Vercel/Render environment separation, HTTPS/CORS/cookies, database/Redis access and sender configuration. This task did not inspect or change live hosting state.
5. **Operations:** Configure worker/request timeouts, error/uptime monitoring and alerts for failing/pending sends. Review interrupted attempts using Message-ID before resending. Do not log full email payloads or credentials. Load-test long document generation and simultaneous sends; SMTP is synchronous and occupies a request worker until accepted/failed/timeout.
6. **Documents and UI:** Save each organisation's real identity, GhanaPost GPS where applicable, tax ID and payment instructions; test logo upload and two unrelated organisations. Repeat desktop/mobile print, source correction and dependency rejection using representative staging history. Verify supported languages/fonts and intended physical printers.

## 12. Remaining launch blockers and ordered verification

Public launch remains blocked on unresolved work outside this phase: Phase 2 legacy-data reconciliation/migration rehearsal; real SMTP configuration and end-to-end delivery acceptance; staging/production operational verification; backup/restore and monitoring/alerting; pricing/trials/subscriptions/renewals/cancellation/failed-payment receipts/suspension; privacy/terms/consent/deletion policies and functionality; and the remainder of the original production audit. This phase did not implement subscriptions, public registration, Ghana payroll automation or hosting.

Recommended order: (1) reconcile and restore-test historical data; (2) rehearse migrations and secure SMTP/Redis setup; (3) execute the action matrix and document/email acceptance in staging; (4) complete the separate commercial/legal/operational launch work; (5) obtain go-live approval only after the checklist below is evidenced. Retain the earlier Phase 2 limitations, including bounded imported reversal references, bank-file ambiguity and organisation-lock throughput. The large frontend chunks remain a measured-mobile-performance follow-up.

## 13. AI and consolidation

Both remain disabled by default: backend `AI_ENABLED=false`, `ENABLE_CONSOLIDATION=false`; frontend `VITE_AI_ENABLED=false`, `VITE_ENABLE_CONSOLIDATION=false`. No enabling change was made. Existing feature guards and full-suite tests remain; Chromium checked customer direct routes. Keep these explicit false values in staging/production. Retained calculation tests do not authorise exposing the features.

## 14. Go-live evidence checklist

- [x] Phase 2 checkpoint created locally; Phase 3 changes reviewable and uncommitted.
- [x] Scoped documents, email and direct PDFs exercised on PostgreSQL/Redis.
- [x] Concurrent email replay creates one attempt and one transport call.
- [x] Frontend tests/lint/build and migration/deployment configuration checks pass.
- [x] Desktop/390px, navigation prints, live organisation switch and source reversal reload exercised.
- [x] Representative PDFs rendered; every final page inspected.
- [ ] Historical production data audited, reconciled and migrations rehearsed on a restored copy.
- [ ] Real SMTP sender/TLS/receipt/bounce/timeout verified in staging.
- [ ] Backup restoration, retention, monitoring, alerts and pending-send procedure proven.
- [ ] Real hosting environment separation and secure configuration reviewed.
- [ ] Action matrix accepted with representative customer/bank dependencies and printers.
- [ ] Commercial, legal/privacy and remaining audit blockers closed.
- [ ] AI/consolidation explicit false values confirmed in actual deployment configuration.
- [ ] Separate deployment approval obtained; nothing in this task was pushed or deployed.

## 15. Changed-file inventory

Paths below are relative to the repository root and describe Phase 3 only (relative to the checkpoint).

```text
accounting-backend/apps/organisations/migrations/0007_organisation_ghana_post_gps_organisation_logo_data_and_more.py
accounting-backend/apps/organisations/models.py
accounting-backend/apps/organisations/serializers.py
accounting-backend/apps/sales/migrations/0014_invoiceemailattempt.py
accounting-backend/apps/sales/models.py
accounting-backend/apps/sales/services/documents/email_invoice.py
accounting-backend/apps/sales/test_documents.py
accounting-backend/apps/sales/views.py
accounting-backend/common/document_views.py
accounting-backend/common/documents.py
accounting-backend/config/settings.py
accounting-backend/config/urls.py
accounting-backend/requirements-test.txt
accounting-backend/requirements.txt
docs/PHASE3_ACTION_MATRIX.md
docs/PHASE3_DOCUMENT_WORKFLOWS.md
scripts/inspect-document-pdfs.py
scripts/verify-document-print.mjs
src/components/banking/ReconciliationWorkspace.jsx
src/components/commercial/CreditNotesWorkspace.jsx
src/components/documents/DocumentView.jsx
src/components/documents/SavedDocument.jsx
src/components/documents/SourceDocumentPage.jsx
src/components/invoices/EmailInvoiceModal.jsx
src/components/reports/ReportExportMenu.jsx
src/pages/accounting/GeneralJournalPage.jsx
src/pages/accounting/JournalDetailsPage.jsx
src/pages/accounting/LiveAccountingPages.jsx
src/pages/accounting/OpeningBalancesPage.jsx
src/pages/commercial/LiveCommercialPages.jsx
src/pages/purchases/BillDetailsPage.jsx
src/pages/sales/InvoiceDetailsPage.jsx
src/pages/settings/CompanySettingsPage.jsx
src/routes/AppRoutes.jsx
src/services/api.js
src/styles/banking.css
src/styles/designSystem.css
src/styles/documents.css
src/styles/journalDetails.css
src/styles/journals.css
src/styles/liveReports.css
src/utils/billPdf.js
src/utils/creditNotePdf.js
src/utils/documentActions.js
src/utils/documentIdentity.js
src/utils/documentPdf.js
src/utils/invoicePdf.js
src/utils/ledgerDocumentRows.js
src/utils/printReport.js
src/utils/quotePdf.js
src/utils/reportExport.js
tests/currency.test.mjs
tests/currencyPdf.test.mjs
tests/documentActions.test.mjs
tests/exportWorkbook.test.mjs
```
