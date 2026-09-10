# Phase 2 accounting integrity — implementation and verification

Date: 10 September 2026. Scope: the 9 September audit findings C3, H2, H6, H7, H13, M4 and M13. This report records local implementation and verification, not production certification.

## 1. Checkpoint and scope

The initial 58-file Phase 1 working tree was inspected against `docs/PHASE1_SECURITY.md` and checkpointed locally as **7d78029d2147cac61f23eff18505c0089f7f3536**, message **Secure tenant isolation and authentication**. Phase 2 changes remain uncommitted. Nothing was pushed or deployed; no historical production data was changed. Subscriptions, Ghana payroll automation, legal documents and hosting implementation are outside this phase.

Consolidation remains disabled by default: `accounting-backend/config/settings.py` uses `env_bool("ENABLE_CONSOLIDATION", False)`; `src/config/featureFlags.js` defaults `VITE_ENABLE_CONSOLIDATION` to false; `.env.example` explicitly sets it false. Retained consolidation services were corrected without enabling the module.

## 2. Defects fixed and accounting policies

### Ledger, periods and source documents

`common/ledger_integrity.py` establishes one transaction-level PostgreSQL advisory lock per organisation. Financial services acquire it before source-row locks; journal posting, period changes and database triggers use the same key. This serialises financial writes within an organisation, trading some throughput for deterministic close/post ordering. Separate organisations have separate locks.

Posting requires exactly one explicit open accounting period. Missing periods fail; overlapping periods fail validation and a PostgreSQL exclusion constraint. Start and end dates are inclusive. Closed/locked periods and closed financial years reject postings. Reopening requires the applicable permission and a nonblank reason, with actor/time/reason history. Posted journal financial headers, lines, source identities and reversal relationships are protected at model, queryset/bulk and PostgreSQL boundaries. Database triggers also cover admin and raw SQL. Closing waits for an in-flight posting; later posting sees the closed period and fails. Reopening deliberately permits subsequent changes to that period's reports.

Original and reversal journals remain additive ledger events. A reversal cannot predate its original and must post into an open period. The generic reversal allowlist contains only `manual`. Source corrections must update the source and ledger atomically; deferred database guards reject incompatible source states. Audit records are immutable.

### Historical receivables, payables, balances and statements

`apps/finance/services/aging/historical.py` derives balances from posted document journals and dated allocation, credit, write-off, refund and reversal events. It does not use today's accumulated paid/credited totals for a past cutoff. Original and reversal dates determine whether a source was effective at the cutoff, including sources now void or reversed. Customer/supplier statements likewise use ledger-effective events.

The due date itself is current; overdue begins the following day. Buckets are current, 1–30, 31–60, 61–90 and 91+ days. Draft/awaiting approval documents are excluded. Unallocated receipts/payments and credits are separate from gross document balances. Transaction amounts are grouped by currency; aggregate amounts explicitly identify the organisation's base currency.

Base carrying amounts come from original control-account postings. Allocation records retain the document carrying slice and payment/credit source slice; final allocation consumes the actual remaining rounded balance. Dated realised FX journals account for differences. Manual, opening and revaluation control movements are shown separately; the reconciliation difference is computed against the actual AR/AP ledger, not forced to zero. Unattributed control movements must be reviewed rather than assigned to a customer without evidence.

Legacy allocations without a trustworthy effective date fail closed: no invented dates or automatic historical backfill. New carrying-value columns are nullable to preserve existing rows. Production legacy rows require a separately reviewed migration/remediation plan before historical balances can be signed off. Temporary AR/AP revaluations must be reversed before settlement in the affected currency.

### Payment retry and concurrency policy

`common/idempotency.py` requires a UUID `Idempotency-Key` for customer and supplier payment creation. Database uniqueness is `(organisation, operation, key)`. A validated canonical payload hash treats equivalent decimal representations consistently. Same key/payload returns the stored original response; changed payload returns HTTP 409. Payment, allocation, journal and stored result commit together. Posting failure rolls everything back. The frontend retains a key across a failed logical submission, rejects an in-flight duplicate, changes the key when the payload changes and clears it after success.

### Bank imports

Commit rechecks fingerprints under transaction locking, with database uniqueness on organisation/bank/fingerprint. Fingerprints include transaction details and an occurrence number, so repeated identical rows within a legitimate statement are preserved. Previously imported occurrences are skipped and reported as duplicates; retry is safe. PostgreSQL tests cover two independently previewed files, concurrent commits, repeated rows and partial overlap.

Old previews must be recreated. Legacy imported transactions without current fingerprints block further imports pending reviewed reconciliation. Without an external stable bank transaction identifier, identical indistinguishable transactions across different statements remain ambiguous; the occurrence policy is not proof of identity in every bank export format. Review representative Ghana bank files before rollout.

### Opening balances

A partial unique constraint permits only one posted opening balance per organisation/effective date. Draft save, submit, post and reverse share the organisation ledger lock. Posting retry returns the existing result; posting failure leaves no partial journal. A replacement cannot be posted at an earlier opening date when the previous opening's reversal is effective later, which would otherwise double the intervening historical balance.

The read-only `audit_accounting_integrity` command detects duplicate posted opening dates, overlapping periods, unsupported organisation base currencies and undated allocations. Migration 0019 refuses ambiguous opening/period data instead of deleting or merging history.

### Currency and rounding

`common/currency_metadata.json` is shared with frontend formatting. Supported currencies are AED, AUD, CAD, CHF, CNY, EUR, GBP, GHS, HKD, INR, KES, NGN, NOK, NZD, SEK, SGD, USD, ZAR and ZMW; all have two decimal places. JPY and three-decimal currencies such as BHD are deliberately unavailable for this release. Existing unsupported-currency organisations need review; no balances are converted automatically.

Authoritative financial calculations use Decimal and ROUND_HALF_UP. Transaction lines/taxes round to two decimals; tax values group by rate/account before base conversion, consistent with tax-register amounts. FX uses explicit effective rates; final settlements consume residual carrying value. A legitimate bounded conversion residual becomes an explicit balanced posting to the organisation's validated FX gain/loss account. Missing accounts, unsupported currencies, non-finite amounts or unexplained imbalances fail instead of being discarded. Frontend previews do not replace server-side accounting validation.

### Consolidation

The newest valid policy-version-2 snapshot per organisation/period is selected deterministically. Income and expense activity uses both selected-period boundaries; prior nominal results transfer to the mapped retained-earnings presentation instead of contaminating current profit. Balance-sheet balances use closing rates; nominal activity uses a calendar-day weighted average of effective rates throughout the selected period. Missing start coverage or closing rates blocks preparation; no closing-rate fallback is called an average. Translation differences use a validated equity CTA account.

Current support remains full consolidation of eligible 100%-owned members. Missing/material mappings fail. Posted eliminations and reversals are additive; reversal restores the exact prior balance. Finalised periods block snapshots/elimination mutations through services and PostgreSQL triggers. An authorised, reasoned reopen creates history before editing resumes. Independently calculated tests cover changing snapshot versions, two periods, current/prior nominal activity, multiple currencies, CTA, missing rates and finalisation.

## 3. Source-document reversal matrix

| Source | Approved correction boundary | Integrity/control treatment |
| --- | --- | --- |
| Manual journal | Generic permission-checked reversal | Exact opposite lines; original immutable |
| Invoice/bill | Source reverse action | Requires unsettled source without dependent credit/write-off; source becomes void; AR/AP and dated tax follow reversal |
| Customer/supplier payment | Source reverse action, or bank unreconciliation for reconciled payments | Dated allocation/FX reversal, document totals and payment status updated atomically; AR/AP/bank retained |
| Payment allocation | Source unallocate action | Receipt retained; dated unallocation and realised-FX correction; AR/AP carrying value restored |
| Opening balance | Opening-balance reversal service | Linked source state and ledger correction; guarded replacement date |
| Stock movement | Existing source stock-reversal service | Opposite movement and journal; rejects a changed outgoing valuation that cannot restore original cost |
| Bank reconciliation/internal transfer | Existing bank-domain correction | Linked bank/source correction; generic journal route blocked |
| FX revaluation | Revaluation reversal service | Linked posted reversal required; temporary revaluation reversed before affected settlement |
| Financial-year close | Authorised year reopen workflow | Reasoned history and closing-entry reversal |
| Credit notes, refunds, write-offs | No new reversal workflow in this phase | Generic and unsupported database reversal blocked; dependent documents must not be bypassed |
| Payroll/fixed assets | Existing source lifecycle only | Generic reversal blocked; posted source amounts/lines protected; no new general cancellation workflow |

The complete suite includes inventory, tax, payroll, fixed-asset, banking and FX lifecycle tests. The seeded accounting health check reported zero differences for trial balance, balance sheet, AR, AP, inventory, tax, fixed assets, payroll and WIP. This is fixture-based evidence, not reconciliation of production records or a claim that every possible business correction is supported.

## 4. Migrations and database requirements

| Migration | Purpose |
| --- | --- |
| accounting/0019_phase2_integrity | Read-only ambiguity preflight; PaymentRequest; unique payment key and posted opening date |
| accounting/0020_postgres_ledger_guards | Journal/line immutability, posting validation, common locking and period-history protection |
| accounting/0021_payment_correction_audit | Durable source correction records |
| accounting/0022_source_and_period_guards | `btree_gist` inclusive period exclusion; source/line/allocation and financial-year guards; deferred source/control checks; immutable FX rates/history |
| banking/0005_phase2_integrity | Import fingerprint and scoped uniqueness |
| sales/0012_phase2_allocation_dates | Historical allocation/reversal effective dates |
| sales/0013_allocation_carrying_values | Document/source base carrying amounts |
| purchases/0013_phase2_allocation_dates | Historical allocation/reversal effective dates |
| purchases/0014_allocation_carrying_values | Document/source base carrying amounts |
| consolidation/0003_finalised_guards | Finalised-period, elimination, snapshot and reporting-identity protection |

PostgreSQL is required for the database guarantees claimed here. SQLite does not supply advisory locks, the exclusion constraint or these PostgreSQL triggers. The migration role must be able to install `btree_gist` (or an operator must provision it). Migrations were applied to disposable PostgreSQL test databases; production migrations were not run.

## 5. Tests and exact final results

PostgreSQL test commands below ran from `accounting-backend`, with `DATABASE_URL=postgresql://phase1@127.0.0.1:15432/phase1`, `DJANGO_CACHE_URL=redis://127.0.0.1:16379/0`, and `PYTHONDONTWRITEBYTECODE=1`. These are disposable local services. No production connection was used.

| Command | Final result |
| --- | --- |
| `venv/bin/python manage.py test --noinput` | **195 tests, 68.887s, OK**, zero skips; `/tmp/ledgify-phase2-full-final.log` |
| `venv/bin/python manage.py test apps.accounting.test_phase2_integrity apps.accounting.test_phase2_history apps.accounting.test_phase2_rounding apps.consolidation.test_phase2_accuracy --noinput` | **22 tests, 5.436s, OK**, zero skips; `/tmp/ledgify-phase2-focused-complete.log` |
| `venv/bin/python manage.py test apps.accounting.test_phase2_concurrency --noinput` | **10 tests, 4.106s, OK**, zero skips; `/tmp/ledgify-phase2-concurrency-complete.log` |
| `npm test` (repository root) | **56 passed, 0 failed, 0 skipped, 176.192166ms**; `/tmp/ledgify-phase2-frontend-final.log` |
| `npm run lint` | **Passed**, no ESLint findings; `/tmp/ledgify-phase2-lint-final.log` |
| `npm run build` | **Passed**, 253ms; existing bundle-size warning above 500 kB; `/tmp/ledgify-phase2-build-final.log` |
| `PYTHONDONTWRITEBYTECODE=1 accounting-backend/venv/bin/python accounting-backend/manage.py makemigrations --check --dry-run` | **No changes detected** |
| `PYTHONDONTWRITEBYTECODE=1 accounting-backend/venv/bin/python /tmp/ledgify-phase1-deploy-check.py` | Synthetic secure production settings: **System check identified no issues (0 silenced)**; deployment check fails at WARNING level |
| `git diff --check` | **Passed**, no output |

The synthetic deployment helper generates a secret internally and supplies DEBUG=false, HTTPS/secure cookies/HSTS, explicit hosts/origins and local PostgreSQL/Redis settings. Its result does not verify Render/Vercel environment values. Temporary logs/helper are local evidence, not repository deployment tooling.

Five initial regression tests failed before the core fixes (`/tmp/ledgify-phase2-before.log`) and passed after them. Intermediate full runs exposed implicit-period fixtures and source-state issues, which were corrected. Final results above supersede those failures. No final tests were skipped; the concurrency class would skip on non-PostgreSQL databases, but did run on PostgreSQL here.

New regression modules cover model/raw-SQL immutability, direct SQL period overlaps, close/post races, customer/supplier idempotency races, imports, opening races and failure rollback, historical event cutoffs, fractional carrying values, tax/FX residuals and independent consolidation calculations. `tests/paymentSubmission.test.mjs` covers retained retry keys, changed payloads, double submission and successful completion. Existing financial fixtures now create explicit periods and real balanced journals rather than bypassing posting rules.

## 6. Remaining risks and manual rollout requirements

1. Take and restore-test a backup into isolated PostgreSQL staging. Run `python manage.py audit_accounting_integrity` before migrating; stop on findings. Obtain a reviewed remediation plan for ambiguous history, especially legacy allocation dates/base carrying values. This work intentionally did not alter that history.
2. Rehearse all migrations on the restored copy with the intended database role, including `btree_gist`; inspect constraint/trigger installation and repeat PostgreSQL concurrency tests. Test rollback/restore procedures rather than treating reverse migrations as a financial-data rollback.
3. Review legacy import records/fingerprints and bank-specific identifiers before allowing further imports. Preview and commit representative statements twice; verify duplicate counts and genuine repeated rows against bank statements.
4. Explicitly provision accounting periods, supported currencies and valid FX/CTA mappings. Verify missing/closed periods reject posting and authorised reasoned reopening works. Rate coverage is required; historical imports must not silently invent rates.
5. Deploy backend and frontend together because payment creation now requires the UUID header. Verify retry, HTTP 409, network-failure retry and both payment modals against staging. Preserve Phase 1 Redis/auth/security configuration.
6. Keep `ENABLE_CONSOLIDATION=false` and `VITE_ENABLE_CONSOLIDATION=false`. Confirm direct customer routes/API remain inaccessible with those values. Test retained calculations only in an explicitly enabled isolated test environment.
7. Reconcile a representative migrated organisation's AR/AP, bank, tax, stock, payroll and assets to its ledger. Investigate nonzero reconciliation differences and unassigned manual/revaluation control balances. Accounting policies here require business acceptance before commercial use.
8. Run real mobile/desktop browser acceptance testing in staging. The recorded frontend verification is unit tests, lint and build; this phase does not claim a completed browser or live deployment audit.
9. The shared organisation lock can limit high-volume throughput. Load-test concurrent postings and observe lock waits before deciding on narrower locking. Raw database superusers can disable triggers; restrict production database privileges operationally.
10. Reversal numbers/descriptions prepend text to bounded database fields. Maximum-length imported references/descriptions can therefore cause a reversal to reject and roll back; add a bounded numbering/description policy before accepting such imports. No posted history should be edited to work around this.
11. General credit/refund/write-off/payroll/asset cancellation is intentionally unavailable through generic reversal. Use only supported source workflows; do not enable an unsafe shortcut to satisfy a correction request.
12. The frontend build retains a large-chunk warning. Measure actual mobile performance and split bundles as a later UX task. This phase does not resolve the audit's separate commercial, legal or hosting launch blockers.

Phase 2's exercised accounting/concurrency checks pass. Public launch remains conditional on legacy-data review, staging acceptance and the other audit phases; no production-readiness verdict is implied by these local results.

## 7. Changed-file inventory

Paths are relative to the repository root. Existing test changes principally replace implicit periods or direct posted-state mutations with valid workflow fixtures.

- `accounting-backend/apps/accounting/management/__init__.py`
- `accounting-backend/apps/accounting/management/commands/__init__.py`
- `accounting-backend/apps/accounting/management/commands/audit_accounting_integrity.py`
- `accounting-backend/apps/accounting/migrations/0019_phase2_integrity.py`
- `accounting-backend/apps/accounting/migrations/0020_postgres_ledger_guards.py`
- `accounting-backend/apps/accounting/migrations/0021_payment_correction_audit.py`
- `accounting-backend/apps/accounting/migrations/0022_source_and_period_guards.py`
- `accounting-backend/apps/accounting/models.py`
- `accounting-backend/apps/accounting/services/account_imports.py`
- `accounting-backend/apps/accounting/services/journals/create_journal.py`
- `accounting-backend/apps/accounting/services/journals/journal_number.py`
- `accounting-backend/apps/accounting/services/journals/post_journal.py`
- `accounting-backend/apps/accounting/services/journals/reverse_journal.py`
- `accounting-backend/apps/accounting/services/opening_balances.py`
- `accounting-backend/apps/accounting/services/periods/period_service.py`
- `accounting-backend/apps/accounting/services/periods/year_end_close.py`
- `accounting-backend/apps/accounting/test_journal_pagination.py`
- `accounting-backend/apps/accounting/test_opening_balances.py`
- `accounting-backend/apps/accounting/test_phase2_concurrency.py`
- `accounting-backend/apps/accounting/test_phase2_history.py`
- `accounting-backend/apps/accounting/test_phase2_integrity.py`
- `accounting-backend/apps/accounting/test_phase2_rounding.py`
- `accounting-backend/apps/accounting/tests.py`
- `accounting-backend/apps/ai/tests.py`
- `accounting-backend/apps/banking/migrations/0005_phase2_integrity.py`
- `accounting-backend/apps/banking/models.py`
- `accounting-backend/apps/banking/services/imports/csv_import.py`
- `accounting-backend/apps/banking/services/reconciliation/reconcile.py`
- `accounting-backend/apps/banking/services/reconciliation/unreconcile.py`
- `accounting-backend/apps/banking/services/transactions/create_transaction.py`
- `accounting-backend/apps/banking/services/transactions/reconcile_to_account.py`
- `accounting-backend/apps/banking/tests.py`
- `accounting-backend/apps/consolidation/migrations/0003_finalised_guards.py`
- `accounting-backend/apps/consolidation/services.py`
- `accounting-backend/apps/consolidation/test_phase2_accuracy.py`
- `accounting-backend/apps/consolidation/tests.py`
- `accounting-backend/apps/consolidation/views.py`
- `accounting-backend/apps/finance/serializers.py`
- `accounting-backend/apps/finance/services/aging/historical.py`
- `accounting-backend/apps/finance/services/aging/payables.py`
- `accounting-backend/apps/finance/services/aging/receivables.py`
- `accounting-backend/apps/finance/services/allocations/auto_allocate.py`
- `accounting-backend/apps/finance/services/allocations/carrying.py`
- `accounting-backend/apps/finance/services/allocations/customer_allocation.py`
- `accounting-backend/apps/finance/services/allocations/reverse_payment.py`
- `accounting-backend/apps/finance/services/allocations/supplier_allocation.py`
- `accounting-backend/apps/finance/services/allocations/unallocate_payment.py`
- `accounting-backend/apps/finance/services/balances/customer_balances.py`
- `accounting-backend/apps/finance/services/balances/supplier_balances.py`
- `accounting-backend/apps/finance/services/corrections/reverse_document.py`
- `accounting-backend/apps/finance/services/statements/customer_statement.py`
- `accounting-backend/apps/finance/services/statements/historical.py`
- `accounting-backend/apps/finance/services/statements/supplier_statement.py`
- `accounting-backend/apps/finance/views.py`
- `accounting-backend/apps/fixed_assets/tests.py`
- `accounting-backend/apps/fx/services/exchange_rate_service.py`
- `accounting-backend/apps/fx/services/revaluation_service.py`
- `accounting-backend/apps/fx/tests.py`
- `accounting-backend/apps/fx/views.py`
- `accounting-backend/apps/inventory/services/adjustments/create_adjustment.py`
- `accounting-backend/apps/inventory/services/costing/weighted_average.py`
- `accounting-backend/apps/inventory/services/workflows.py`
- `accounting-backend/apps/inventory/tests.py`
- `accounting-backend/apps/manufacturing/services/bom_service.py`
- `accounting-backend/apps/manufacturing/services/material_issue_service.py`
- `accounting-backend/apps/manufacturing/services/production_completion_service.py`
- `accounting-backend/apps/manufacturing/services/production_order_service.py`
- `accounting-backend/apps/manufacturing/tests.py`
- `accounting-backend/apps/organisations/management/commands/seed_demo_data.py`
- `accounting-backend/apps/organisations/test_currencies.py`
- `accounting-backend/apps/organisations/test_phase1_security.py`
- `accounting-backend/apps/payroll/services/calculation_engine.py`
- `accounting-backend/apps/payroll/services/payroll_service.py`
- `accounting-backend/apps/payroll/tests.py`
- `accounting-backend/apps/purchases/migrations/0013_phase2_allocation_dates.py`
- `accounting-backend/apps/purchases/migrations/0014_allocation_carrying_values.py`
- `accounting-backend/apps/purchases/models.py`
- `accounting-backend/apps/purchases/serializers.py`
- `accounting-backend/apps/purchases/services/bills/approve_bill.py`
- `accounting-backend/apps/purchases/services/bills/create_bill.py`
- `accounting-backend/apps/purchases/services/bills/update_bill.py`
- `accounting-backend/apps/purchases/services/commercial.py`
- `accounting-backend/apps/purchases/services/credits/apply_supplier_credit.py`
- `accounting-backend/apps/purchases/services/credits/approve_supplier_credit.py`
- `accounting-backend/apps/purchases/services/credits/create_supplier_credit.py`
- `accounting-backend/apps/purchases/services/payments/create_supplier_payment.py`
- `accounting-backend/apps/purchases/services/refunds/create_supplier_refund.py`
- `accounting-backend/apps/purchases/tests.py`
- `accounting-backend/apps/purchases/views.py`
- `accounting-backend/apps/sales/migrations/0012_phase2_allocation_dates.py`
- `accounting-backend/apps/sales/migrations/0013_allocation_carrying_values.py`
- `accounting-backend/apps/sales/models.py`
- `accounting-backend/apps/sales/serializers.py`
- `accounting-backend/apps/sales/services/commercial.py`
- `accounting-backend/apps/sales/services/credit_notes/apply_credit_note.py`
- `accounting-backend/apps/sales/services/credit_notes/approve_credit_note.py`
- `accounting-backend/apps/sales/services/credit_notes/create_credit_note.py`
- `accounting-backend/apps/sales/services/invoices/approve_invoice.py`
- `accounting-backend/apps/sales/services/invoices/create_invoice.py`
- `accounting-backend/apps/sales/services/payments/create_customer_payment.py`
- `accounting-backend/apps/sales/services/refunds/create_customer_refund.py`
- `accounting-backend/apps/sales/services/write_offs/create_bad_debt_write_off.py`
- `accounting-backend/apps/sales/tests.py`
- `accounting-backend/apps/sales/views.py`
- `accounting-backend/apps/tax/test_workspace.py`
- `accounting-backend/apps/tax/tests.py`
- `accounting-backend/common/accounting_test_fixtures.py`
- `accounting-backend/common/currencies.py`
- `accounting-backend/common/currency_metadata.json`
- `accounting-backend/common/idempotency.py`
- `accounting-backend/common/ledger_integrity.py`
- `accounting-backend/common/rounding.py`
- `accounting-backend/config/settings.py`
- `docs/PHASE2_ACCOUNTING_INTEGRITY.md`
- `src/components/bills/RecordBillPaymentModal.jsx`
- `src/components/invoices/RecordPaymentModal.jsx`
- `src/pages/sales/InvoiceDetailsPage.jsx`
- `src/services/purchasesApiService.js`
- `src/services/salesApiService.js`
- `src/utils/currency.js`
- `src/utils/paymentSubmission.js`
- `tests/currency.test.mjs`
- `tests/exportWorkbook.test.mjs`
- `tests/paymentSubmission.test.mjs`
