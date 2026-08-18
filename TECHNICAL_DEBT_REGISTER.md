# Ledgify technical debt register

## Accounting Integrity

- Add automated non-zero reconciliation fixtures for AR, AP, inventory, tax, fixed assets, payroll liabilities, and WIP.
- Add settlement-after-revaluation coverage and decide next-period FX roll-forward policy. Duplicate prevention and explicit reversal were completed in 14F.
- Review GRNI reconciliation independently from AP and inventory control accounts.

## Security

- Add parameterised cross-organisation UUID injection tests for every related field and custom action.
- Create fail-closed production settings and deployment checks for secret, debug, hosts, CORS, TLS, cookies, and database.
- Decide whether report export requires a server-enforced permission boundary.

## Backend Architecture

- Format compact one-line modules and replace wildcard imports; do this in isolated, test-backed refactors.
- Give finance reports the same reusable report permission naming used by other domains if roles later diverge.
- Remove orphaned serializer/model surfaces only after route consumers are confirmed.

## Frontend Architecture

- Active accounting localStorage paths were retired in 14G; continue preventing new browser-authoritative finance stores.
- Continue code-splitting and component consolidation after the AI-readiness gate; lint is clean.
- Add route metadata for permissions instead of bespoke guards.
- Code-split heavy PDF/chart pages; the main production chunk exceeds 500 kB.

## Performance

- Profile production lists with query-count tests.
- Consider compound indexes for production order organisation/status/due date, production costs by order/date, payroll runs by organisation/status/date, and fixed assets by organisation/status.
- Paginate backend and frontend lists before large tenants are onboarded.

## Testing

- Expand beyond the current 45 backend tests with API contract, role matrix, concurrent transition, and reconciliation suites.
- Add frontend tests for protected navigation, forms, errors, and all financial workflows.
- Enforce the now-clean build/lint/backend-test gates in CI.

## Tax/Jurisdiction

- Implement the tax file/lock workflow using `FILE_TAX_RETURN`.
- Add jurisdiction adapters and compliance tests without embedding country rules in the core ledger.

## Payroll/Jurisdiction

- Add statutory adapters and jurisdiction-specific golden tests.
- Encrypt or tokenize employee bank details and define data-retention/access policies.

## Consolidation

- Complete add/edit frontend forms and API contract tests for the group members, consolidation accounts/mappings, and elimination endpoints exposed in 14F.
- Implement average-rate policy, CTA, ownership methods beyond supported FULL/100%, and version/reopen semantics.

## Manufacturing

- Add API-level workflow tests and concurrency tests for completion and cost allocation.
- Add scale indexes after measuring production report workloads.
- Add server-generated exports if export permission must be enforced beyond UI visibility.

## UX

- Replace legacy browser prompts/alerts on active older pages with project modals and error banners.
- Consolidate one-off table/modal/loader/badge patterns without redesigning the interface.
- Resolve 72 ESLint errors and 52 warnings, prioritising active routes.

## Deployment

- Supply production environment variables and fail startup when they are absent.
- Replace SQLite for production, add backups, observability, structured audit logging, and disaster-recovery drills.
- Add dependency/security scanning and CSP/security headers.
- Enable the prepared TLS/HSTS/cookie environment variables only after the production proxy and domains are known.
