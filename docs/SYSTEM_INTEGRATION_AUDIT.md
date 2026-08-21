# Ledgify full-system integration audit

Audit date: 2026-08-13. Scope: backend `accounting-backend/` and the frontend at the Ledgify repository root. This audit made only narrow security, configuration, permission, and duplicate-route fixes. It did not change accounting treatment.

## Executive result

The central journal, reporting, inventory/WAC, manufacturing, AR/AP, tax, payroll, and fixed-asset paths are internally coherent under the current automated tests and database reconciliation. The platform is not yet production-ready as a whole because active legacy frontend routes still depend on browser-local accounting stores, full lint has substantial debt, production settings require deployment configuration, and consolidation is intentionally incomplete.

## Validation evidence

- Django system check: passed, zero issues.
- Python compilation (`apps common config`): passed.
- Migration drift check: passed; no changes detected.
- Migration inventory: all migrations shown as applied; `audit` and `finance` intentionally have no model migrations.
- Full backend suite: 45 tests, 45 passed, 0 failed, 0 errors, 0 skipped before fixes.
- Post-fix backend result is recorded in the final section below.
- Frontend production build: passed during the audit baseline.
- Targeted manufacturing lint: passed.
- Full frontend lint: 124 findings: 72 errors and 52 warnings.
- Django deployment check: blocked by the development console mail backend, with seven expected security warnings while production environment/security settings are absent (HSTS, SSL redirect, secret strength, secure cookies, debug, and allowed hosts).

## Registration and routes

All implemented Django apps are registered once: accounts, organisations, contacts, accounting, sales, purchases, finance, banking, inventory, tax, payroll, fixed assets, FX, consolidation, and manufacturing. The audit found no duplicate DRF basenames.

API route groups:

- Identity: `auth`, `organisations`, `organisation-members`, `contacts`.
- Ledger: `accounts`, `journals`, `accounting-periods`, `financial-years`, `reports`, `finance`.
- Commercial: `invoices`, `customer-payments`, customer credits/refunds/write-offs, `bills`, supplier payments/credits/refunds, quotes, sales orders, and purchase orders.
- Banking: bank accounts, transactions, imports, and rules.
- Inventory: products, warehouses, movements, transactions, adjustments, counts, valuation, and reports.
- Specialist domains: tax, payroll, fixed assets, FX, consolidation, BOMs, production orders, and manufacturing reports.

Two duplicate React routes (`inventory/products/:productId` and `accounting/period-locks`) were removed. Stable URLs were not renamed.

## Findings

### CRITICAL

No confirmed current accounting imbalance or cross-organisation data disclosure was reproduced. No critical accounting treatment was changed.

### HIGH

1. **Frontend architecture — active browser-local accounting stores**
   - Files: `src/services/journalService.js`, `periodLockService.js`, `yearEndCloseService.js`, `openingBalanceService.js`, `recurringJournalService.js`, `journalImportService.js`, and several older sales/purchase/inventory/fixed-asset services.
   - Issue: active routes such as opening balances, recurring journals, journal import, year-end close, budget, and audit-related legacy pages can use localStorage-backed state rather than the authoritative API.
   - Impact: users can see or manipulate browser-local records that are not ledger records, creating a serious consistency and UX risk.
   - Fixed: no. This needs route-by-route migration, not a safe audit patch.
   - Recommendation: replace or hide every active local-store route until backed by an audited API; retain prototypes only outside the production route tree.
   - Complexity: LARGE.

2. **Deployment security — development defaults**
   - File: `accounting-backend/config/settings.py`.
   - Issue: the prior source contained a literal Django secret and unconditional `DEBUG=True`.
   - Impact: unsafe production deployment and secret reuse risk.
   - Fixed: partially. Settings now read `DJANGO_SECRET_KEY`, `DJANGO_DEBUG`, and `DJANGO_ALLOWED_HOSTS` from the environment. Deliberately unsafe development fallbacks remain for local execution.
   - Recommendation: deployment must set a strong secret, `DJANGO_DEBUG=false`, explicit hosts, production database, HTTPS/security headers, and production CORS origins. Add a separate production settings profile that fails closed.
   - Complexity: MEDIUM.

3. **Consolidation — incomplete operational surface**
   - Files: `apps/consolidation/models.py`, `serializers.py`, `views.py`, `services.py`.
   - Issue: group and period APIs exist, but member, account mapping, and elimination journal CRUD/posting APIs are not exposed. The service correctly limits production consolidation to FULL/100%, reports unmapped accounts, and does not modify subsidiaries.
   - Impact: consolidation cannot be configured and operated fully through the supported frontend/API.
   - Fixed: no; this is an explicit structural/product gap from Milestone 13.
   - Recommendation: complete audited member/mapping/elimination workflows and CTA/average-rate policy before production consolidation.
   - Complexity: LARGE.

### MEDIUM

1. **Organisation relationship injection gaps**
   - Files: fixed-assets, payroll, and consolidation views/serializers.
   - Issue: scoped parent querysets existed, but selected related accounts/categories/groups could be replaced during updates or creation with raw UUIDs from another organisation.
   - Impact: cross-organisation references and downstream financial posting failures.
   - Fixed: yes. Draft-only update validation and organisation checks were added; consolidation parent organisation is read-only and periods validate group ownership.
   - Complexity: SMALL.

2. **Finance reports lacked the permission matrix**
   - File: `apps/finance/views.py`.
   - Issue: organisation membership was checked, but actions used only `IsAuthenticated` instead of `OrganisationActionPermission`.
   - Impact: employee-role members could access AR/AP balances and statements without `view_accounting`.
   - Fixed: yes; every finance report action now requires `VIEW_ACCOUNTING`.
   - Complexity: SMALL.

3. **Frontend lint debt**
   - Files: predominantly legacy modal/page effects and old local services.
   - Issue: full lint reports 72 errors and 52 warnings, mainly synchronous state changes in effects, dependency issues, unused code, and lost exception causes.
   - Impact: maintainability and possible stale/cascading render behaviour; production build still succeeds.
   - Fixed: no broad cleanup was attempted under the safe-fix policy. Manufacturing-targeted lint is clean.
   - Complexity: LARGE.

4. **Insufficient cross-organisation regression coverage**
   - Files: application test suites.
   - Issue: secure scoping is broadly present and inventory has an explicit cross-organisation test, but every related UUID field is not covered by an injection test.
   - Impact: future serializer/view changes could regress tenant isolation unnoticed.
   - Fixed: runtime gaps found in this audit were fixed; systematic coverage remains.
   - Recommendation: add parameterised API tests for every organisation-owned relationship and action.
   - Complexity: MEDIUM.

5. **FX revaluation lifecycle**
   - Files: `apps/fx/models.py`, `services/revaluation_service.py`.
   - Issue: dated rates are immutable and entries are balanced, but revaluations have no explicit duplicate prevention or automatic next-period reversal/roll-forward.
   - Impact: repeated runs can double-count unrealised FX if operators do not control the workflow.
   - Fixed: no; treatment changes require a designed migration and workflow.
   - Complexity: MEDIUM.

6. **Tax period workflow incomplete**
   - Files: `apps/tax/views.py`, `apps/organisations/permissions.py`.
   - Issue: `FILE_TAX_RETURN` is defined but no file/lock action uses it. Tax reports and immutable posted transactions work, but filing is not operationally enforced.
   - Impact: tax return lifecycle is partial.
   - Fixed: no feature was added.
   - Complexity: MEDIUM.

7. **Report export permission is frontend-only in manufacturing**
   - Files: `src/pages/manufacturing/ManufacturingPages.jsx`; reporting APIs.
   - Issue: exports are produced client-side from viewable report data. `EXPORT_REPORTS` hides controls but is not a server export operation.
   - Impact: technically capable users with report access can still copy data; this permission is a UI workflow control, not data-loss prevention.
   - Fixed: documented.
   - Complexity: MEDIUM if server-governed exports are required.

### LOW

1. **Duplicate service aliases**
   - File: `src/services/inventoryService.js` and older domain services.
   - Issue: unused aliases duplicate active API methods; old local services coexist with new API services.
   - Impact: developer confusion and contract drift.
   - Fixed: not deleted because hidden prototypes may still depend on them.
   - Complexity: MEDIUM.

2. **Index coverage gaps in newer compact models**
   - Files: manufacturing, payroll, fixed-assets, and tax models.
   - Issue: core ledger/commercial/inventory/banking indexes are good, but production order status/due-date, production transaction order/date, payroll run status/date, and fixed-asset status lack explicit compound indexes.
   - Impact: future list/report performance at scale.
   - Fixed: no; workload evidence and migrations should precede index additions.
   - Complexity: SMALL.

3. **Global currency catalogue uses authentication only**
   - File: `apps/fx/views.py`.
   - Issue: currencies are intentionally global, so organisation scoping is not appropriate.
   - Impact: low; catalogue is read-only.
   - Fixed: not required.
   - Complexity: SMALL.

### INFORMATIONAL

- Only the approved journal creation and reversal services directly create `JournalEntry`/`JournalLine` records. No domain service bypass was found.
- Central posting validates at least two lines, positive one-sided amounts, active same-organisation accounts, exact debit/credit equality, manual-journal restrictions, permissions, and open periods.
- Posted/reversed journals and lines reject instance edits/deletes; reversals append a new opposite journal.
- Ledger reports query posted journal lines. P&L excludes year-end-close journals so historical operating performance remains meaningful.
- Cash flow derives cash movements from posted journals, excludes cash-only transfers, and reports its reconciliation difference.
- StockMovement is the quantity source of truth; only posted movements are used by stock reporting. Product has no competing on-hand field.
- WAC uses Decimal, locked product/warehouse scopes, deterministic layer ordering, immutable layers, negative-stock prevention, and append-only manufacturing completion receipts.
- Manufacturing accounting is correct in covered tests: material issue Dr WIP/Cr Inventory; completion Dr Finished Goods/Cr WIP; variance uses the configured account; material issue does not post COGS; batches are atomic.
- Tax transactions snapshot rates, are immutable, and reconcile through tax accounts. Jurisdiction adapters remain intentionally separate.
- Payroll gross/deductions/net and posting/payment journals are covered; statutory correctness depends on jurisdiction adapters.
- Fixed assets enforce one depreciation schedule per asset/period, period locks, NBV, and gain/loss disposal journals.
- Consolidation reads subsidiary posted journals into snapshots and never mutates subsidiary ledgers.

## Current-data reconciliation

| Organisation | AR difference | AP difference | Inventory difference | Tax difference | Fixed-assets difference | Payroll difference | WIP difference |
|---|---:|---:|---:|---:|---:|---:|---:|
| Ledgify Demo Ltd | 0.00 | 0.00 | 0.0000 | 0.00 | 0.00 | 0.00 | 0.00 |
| Test Company Ltd | 0.00 | 0.00 | 0.0000 | 0.00 | 0.00 | 0.00 | 0.00 |

The fixed-assets, payroll, tax, and WIP balances are zero in this database, so those are valid zero-balance reconciliations rather than evidence from populated transactional cases. Automated module tests provide the non-zero lifecycle evidence.

Financial reports for both organisations: Trial Balance balanced with zero difference; Balance Sheet balanced with zero difference. P&L and Cash Flow use posted ledger data.

## Safe fixes applied

- Environment-driven Django secret, debug flag, and allowed hosts.
- Finance reports added to organisation permission enforcement.
- Fixed-asset category/asset update relationship validation and draft-only financial edits.
- Payroll component/run update relationship validation and draft-only run edits.
- Consolidation parent organisation made read-only; period group ownership checked.
- Duplicate React product-detail and period-lock routes removed.

## Final validation

See the Milestone 14E completion response for post-fix command results and remaining blockers.

## Milestone 14F remediation update — 2026-08-13

- Active browser-local accounting routes for opening balances, journal import, recurring journals, budget, year-end close, audit detail, and legacy account transactions were removed from the production route tree. Legacy invoice/bill/supplier detail and edit URLs now redirect to canonical API-backed lists. Product catalogue reads in live invoice/bill creation now use the shared API client.
- Consolidation member, group-account, mapping, unmapped-account, and elimination endpoints are organisation scoped. FULL requires exactly 100% ownership. Mapping validates membership, account ownership, group ownership, and effective-date overlap. Posted eliminations are immutable and reversal is an explicit opposite elimination, never a subsidiary journal.
- Consolidated TB/P&L/Balance Sheet continue to use latest member snapshots plus posted elimination lines. Cash Flow, CTA policy, NCI, equity, and proportionate methods remain unsupported/partial.
- FX revaluation now has exposure/date uniqueness, row-locked duplicate checks, source references, explicit journal reversal, reversal audit fields, and second-reversal rejection.
- Backend check, compilation, migration drift and 46 tests pass. Frontend production build passes.
- Blocking gate remains closed: full ESLint is still 72 errors and 52 warnings, and the consolidation UI currently exposes monitoring/post/reversal but not complete add/edit forms. Settlement after revaluation also needs a dedicated end-to-end clearing test before the realised/unrealised guarantee can be signed off.
- Deployment check with production-like secret/debug/hosts reports four infrastructure-dependent TLS warnings (HSTS, HTTPS redirect, secure session cookie, secure CSRF cookie). All have environment-controlled settings; production must enable them after TLS/proxy configuration.

## Milestone 14G final gate — 2026-08-13

- Full ESLint improved from 72 errors/52 warnings to 0 errors/0 warnings without disabling or weakening rules. The production build passes.
- Import-graph analysis removed unreachable legacy pages/components/services only after confirming canonical live replacements. The only localStorage reachable from `main.jsx` is `authStorage.js` (`AUTH_PERSISTENCE`); `ACCOUNTING_SOURCE_OF_TRUTH = 0`.
- Consolidation now has frontend forms/workflows for groups, 100%-FULL members, group accounts, mappings, unmapped accounts, draft/post/reverse eliminations, and consolidated TB/P&L/Balance Sheet. Backend lifecycle tests cover validation, preparation, eliminations, reversal and reports.
- FX tests cover duplicate rejection, balanced explicit reversal, second-reversal rejection, locked-period atomicity, and invoice recognition → revaluation → reversal → settlement. Recognition remains unchanged, unrealised FX nets to zero after reversal, realised FX is recognised once, AR clears, and bank/base amounts remain correct.
- Full backend suite: 51 passed. Django check and compilation passed; no migration drift. Current-data Trial Balance and Balance Sheet differences remain `0.00` for both organisations.
- Active-source searches found no production route presenting mock/dummy/fake accounting data. Backend demo seed data remains permitted.
- `PRODUCTION_CONFIGURATION.md` records the Milestone 16 infrastructure contract. Deploy check retains only W004/W008/W012/W016 until HTTPS, proxy, HSTS and secure-cookie configuration is activated.
- Unsupported by design: NCI, equity/proportionate consolidation, historical equity rates, automated CTA, and consolidated Cash Flow.
