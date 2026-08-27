# Ledgify Manual Implementation Gaps

**Review date:** 26 August 2026  
**Classification:** Private implementation review — not customer-facing

## Review basis

The manual was checked against the React route/navigation configuration, active pages and forms, API services, Django URLs, models, serializers, permission services, accounting workflow services, tests and RC1 product/status documentation. The active codebase is `/Users/gideonowusu/Ledgify`. Legacy localStorage services remain in source but active integrated routes use backend APIs.

## Material gaps and mismatches

| Area | Frontend state | Backend state | Manual treatment / required follow-up |
| --- | --- | --- | --- |
| Self-registration | No active screen | No verified public workflow | Marked **Not currently available**. |
| Forgotten/password change | Login has no verified recovery workflow | Password change/reset API not verified | Marked **Not currently available**; administrator process required. |
| Two-factor authentication | No UI | No verified API | Marked **Not currently available**. |
| Notifications | Bell panel exists and says delivery is not configured | No preference/delivery model | Marked **Not currently available**; do not document mark-as-read or links. |
| User invitation/profile administration | Membership role/status management is partial | Membership API exists | Manual avoids claiming a complete email invite workflow. Add safe invitation and expanded profile flow. |
| Custom roles | Readable role catalogue/fixed permissions | Fixed backend role mapping | Marked unsupported. |
| Document numbering settings | No settings UI | No configuration API | Marked not implemented. System-generated numbering remains authoritative. |
| Sales/purchase global defaults | Per-document workflows only | No dedicated defaults model | Marked not implemented. |
| Banking global preferences | Linked account/rule workspaces | Bank APIs | Documented as per-bank/per-rule, not global. |
| Live bank feeds | No configured feed | CSV import supported | Manual documents CSV as the verified method. |
| Attachments | No general-purpose verified UI | No verified general attachment store | Marked not currently available. |
| Tax electronic filing | Preview/report UI exists | Country-neutral engine; no filing adapter | Manual warns that electronic filing is unsupported. |
| Payroll statutory calculations | Payroll engine/UI exists | Adapter architecture only | Manual requires jurisdiction adapter and professional validation. |
| FX market-rate feed | FX workbench exists | Dated rate storage/revaluation exists | Manual states rates are not automatically sourced. |
| Consolidation | UI/backend support full consolidation and eliminations | Advanced methods absent | NCI, equity method, proportionate consolidation, full CTA and consolidated Cash Flow marked unsupported. |
| AI provider | UI/backend tool and safety architecture exist | Live provider configuration environment-dependent | Manual marks live AI configuration-dependent and prohibits autonomous high-risk posting. |
| Accounting settings | Settings links to domain workbenches | No single central accounting-defaults model | Manual documents linked controls rather than invented settings fields. |
| Recurring journals | Source/UI remnants are not sufficient evidence of active end-user route | No release-verified workflow found | Manual does not claim availability. |
| Warehouses navigation | “Warehouses” sidebar item points to `/inventory/products` | Warehouses API exists | Manual explains that warehouse management is in the Products workspace. Consider a dedicated route or clearer label. |
| Quote/PO create/edit routes | Dedicated new/edit paths redirect to list workspaces | Commercial APIs support workflows | Manual explains integrated list-workspace creation/editing. Consider dedicated route consistency. |
| Production deployment | Frontend/backend foundations exist | External infrastructure evidence absent | Customer manual avoids production claims. Staging PostgreSQL/PITR, TLS, SMTP, object storage, monitoring and restore evidence remain external blockers. |

## Status and accounting checks

- Invoices and bills: Draft, Awaiting approval, Approved, Partly paid, Paid and Void/Reversed treatment documented from models/workflows.
- Journals: Draft, Posted and Reversed; posted reversal history preserved.
- Bank transactions: Unreconciled, Reconciled and Ignored. Statement import and row statuses documented.
- Purchase orders: Draft, Approved, Partly received, Received, Billed and Cancelled.
- Payroll runs: Draft, Calculated, Approved, Posted and Paid.
- Accounts: Active, Inactive and Archived; periods Open/Locked.
- AR/AP control-account protection in cash coding and bank rules is explicitly documented.
- Inventory is documented as perpetual weighted-average cost with negative stock prevention.
- Fixed Assets is documented as accounting depreciation, not tax depreciation.

## Screenshot gap

An authentic, sanitised Login screenshot was captured from the locally running frontend. Authenticated screenshots could not be captured without a seeded authorised session. The manual contains clearly labelled placeholders for Figures 2–17 rather than invented UI. Before public release:

1. Create a sanitised demo organisation with fictional GBP data.
2. Capture the Dashboard, invoice, bill, reconciliation, accounts, journals, inventory, fixed-assets, manufacturing, reports, specialist, settings, AI and header screens.
3. Replace each matching placeholder while keeping its caption and figure number.
4. Re-render and visually inspect all pages.

## Recommended implementation priorities

1. Implement password reset/change and optional 2FA.
2. Implement notification persistence, delivery, read state and preferences—or remove the inactive bell affordance.
3. Complete secure user invitation/profile management.
4. Add configurable document sequences and carefully scoped sales/purchase defaults.
5. Add a general attachment service with malware scanning, access control and retention.
6. Resolve remaining native browser prompt/confirm interactions with accessible shared dialogs.
7. Complete browser workflow and accessibility testing with seeded organisations.
8. Supply and verify external production infrastructure and recovery evidence.

## Manual release checks

- [x] Exact navigation labels and active route destinations compared.
- [x] Frontend-only or absent functions labelled.
- [x] Backend-connected core workflows distinguished.
- [x] Statuses and accounting effects cross-checked.
- [x] No credentials, tokens, API keys or personal data included.
- [x] British English and consistent fictional UK/GBP examples used.
- [x] Frontend production build completed successfully (`npm run build`).
- [x] Frontend lint completed successfully (`npm run lint`).
- [x] The 48-page PDF was rendered to page images and inspected in four contact sheets; no clipping, broken tables, missing captions or page overflow was found.
- [ ] Backend automated tests were not executable in the supplied environment because the Django dependency is not installed; install `accounting-backend/requirements.txt` in an isolated environment before the release test run.
- [ ] Authenticated screenshots require a sanitised seeded session.
