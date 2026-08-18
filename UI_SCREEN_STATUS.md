# Ledgify UI screen status

Audit date: 14 August 2026

The audit covers 45 React page implementation files and every active, non-redirect route registered by the application. `READY` means the screen uses the restored shared UI system and has no code-level layout blocker. `NEEDS_MINOR_POLISH` identifies an interaction that still relies on a native browser dialog; it does not indicate a broken workflow. Legacy redirect routes are intentionally excluded because they do not render a screen.

| Module | Screens and routes audited | Status | Notes |
| --- | --- | --- | --- |
| Authentication | Login, organisation selection | READY | Auth shell, validation, focus and compact layouts retained |
| Application shell | Header, sidebar, content wrapper, error boundary, not-found | READY | Responsive navigation, bounded content width and recovery state verified |
| Dashboard | Dashboard and recent activity | READY | Cards, activity table, pagination, loading and empty states use shared rhythm |
| Sales contacts | Customers, new/edit customer, customer detail, customer statement | NEEDS_MINOR_POLISH | Layout is ready; customer-detail delete/void actions still use native confirmation |
| Sales documents | Invoices, new/edit/detail invoice, quotes, orders, credit notes | NEEDS_MINOR_POLISH | Tables and forms are ready; a small number of detail actions still use native confirmation |
| Purchase contacts | Suppliers, new/edit supplier, supplier detail | NEEDS_MINOR_POLISH | Responsive form/table styling is ready; some destructive actions still use native confirmation |
| Purchase documents | Bills, new/edit/detail bill, purchase orders, supplier credits | NEEDS_MINOR_POLISH | Workflow UI is consistent; purchase-order detail retains one dynamic inline progress width and native confirmations |
| Banking | Accounts, transactions, reconciliation, rules, imports, cash coding | READY | Wide tables scroll safely and workflow actions use consistent controls |
| Inventory | Products/detail, receipts, issues, adjustments, counts, valuation and movement reports | READY | Shared cards, forms, badges, tables and small-screen overflow verified |
| Manufacturing | Dashboard, BOMs/detail, production orders/detail, reports | READY | Specialist layout preserved under shared tokens and responsive rules |
| Accounting setup | Chart of Accounts, account details, fiscal periods | READY | Search/filter/modal/table hierarchy and account drill-down verified |
| Journals | Journal list, new journal, journal detail | READY | Entry grid, action hierarchy, details and pagination verified |
| Financial reports | General Ledger, Trial Balance, P&L, Balance Sheet, Cash Flow, breakdown, aged reports | READY | Tabular numbers, report actions, drill-down and overflow handling verified |
| Reports centre | Report navigation | READY | Report cards and responsive navigation hierarchy verified |
| Fixed Assets | Register, asset detail, depreciation run | READY | Discoverable navigation, summaries, status chips and modal presentation verified |
| Tax | VAT returns and tax settings | READY | Tables/forms/actions conform to shared UI layer |
| Payroll | Payroll workspace | READY | Summary, controls and report presentation verified |
| Foreign exchange | FX workspace | READY | Controls, cards and result presentation verified |
| Consolidation | Consolidation workspace | NEEDS_MINOR_POLISH | Core layout is ready; final report content remains the existing generic structured rendering |
| AI assistant | Conversations, prompt workspace, insights and proposals | READY | Three-panel responsive behaviour and clear system feedback retained |
| Settings | Company settings | READY | Form sections, actions, field states and responsive layout verified |

## Remaining interaction debt

- 42 native `window.alert`, `window.confirm` or `window.prompt` calls remain across legacy commercial detail and administration workflows. They work, but replacing them with the shared modal/toast pattern needs workflow-specific state and copy rather than a CSS-only substitution.
- One inline style remains in Purchase Order Details. It represents a data-driven completion percentage; moving it to a static stylesheet would lose the dynamic value. A CSS custom property would be the appropriate later cleanup.
- Authenticated visual regression testing still needs a seeded browser session. Route coverage, CSS resolution, lint and production compilation are code-verified in this pass.

No active screen is blocked and no unimplemented destination was added.
