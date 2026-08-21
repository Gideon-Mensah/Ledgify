# Ledgify RC1 Bug Register

## BLOCKER

No unresolved blockers.

## RESOLVED

| Module | Root cause | Resolution | Evidence |
|---|---|---|---|
| Journal reversal reporting / AR | Reversed original journals were excluded from ledger-effective reporting while their posted reversal journals remained included. This created an artificial £375 AR difference for JE-000021. | Added a canonical `posted` + `reversed` ledger-effective definition and applied it to financial/reporting queries. No historical entries were changed. | Accounting health passes with AR difference `0.00`; reversal regression tests cover GL, Trial Balance, P&L, and control-account netting. |

## HIGH

| Module | Description | Impact | Workaround | Recommended fix |
|---|---|---|---|---|
| Demo seed coverage | Seed does not guarantee fixed assets, manufacturing orders, manual journals, completed reconciliation, or ratio fixtures. | Full 20-minute demo lacks dependable fallback records for later modules. | Use existing manually created records where available. | Extend the idempotent seed in a separate, reviewed data-fixture change. |
| Production infrastructure | Staging PostgreSQL, TLS, email, monitoring, object storage, secrets, and backup restore were not evidenced locally. | Staging/Production Ready cannot be granted. | Local demo only. | Complete infrastructure release gate with recorded evidence. |

## MEDIUM

| Module | Description | Impact | Workaround | Recommended fix |
|---|---|---|---|---|
| Frontend source hygiene | Legacy localStorage accounting service modules remain in source although active routes use API services. | Future imports could accidentally reintroduce browser-authoritative financial data. | Use only current API service imports. | Remove or archive legacy modules after a dependency audit. |
| Frontend bundles | Vite reports several chunks above 500 kB. | Initial loading may be slower on weak devices. | Current build remains functional. | Add route-level lazy loading in a later performance pass. |
| Browser QA | Requested viewport/device and assistive-technology matrix was not executable in the terminal-only run. | Visual/accessibility regressions cannot be ruled out completely. | Use responsive CSS and keyboard-capable controls already present. | Execute Playwright/manual browser matrix before staging sign-off. |

## LOW

No additional low-severity release issues were confirmed during this pass.
