# Ledgify RC1 Product Feature Matrix

Legend: Yes = evidence present; Partial = implemented with stated limits; No = not release-verified.

| Feature | Backend | Frontend | Tests | Demo Ready | Staging Ready | Production Ready | Limitations |
|---|---|---|---|---|---|---|---|
| Authentication and organisations | Yes | Yes | Yes | Partial | No | No | External deployment/session testing pending |
| Sales and AR | Yes | Yes | Yes | Yes | No | No | Deployment QA pending |
| Purchases and AP | Yes | Yes | Yes | Yes | No | No | Deployment QA pending |
| Banking and reconciliation | Yes | Yes | Yes | Yes | No | No | Control-account and reversal-reporting regressions covered |
| Manual journals and ledger | Yes | Yes | Yes | Yes | No | No | Browser workflow QA pending |
| Financial reports and drill-down | Yes | Yes | Yes | Yes | No | No | Depends on clean/configured accounting data |
| Financial ratios | Yes | Yes | Yes | Partial | No | No | Some ratios require available source values |
| Inventory and WAC | Yes | Yes | Yes | Yes | No | No | Production-scale concurrency not load-tested |
| Manufacturing and WIP | Yes | Yes | Yes | Partial | No | No | Demo fixture coverage incomplete |
| Fixed assets | Yes | Yes | Yes | Partial | No | No | Demo fixture coverage incomplete; accounting depreciation only |
| Payroll | Yes | Yes | Yes | Partial | No | No | Jurisdiction-specific limits |
| Tax | Yes | Yes | Yes | Partial | No | No | No electronic filing |
| FX | Yes | Yes | Yes | Partial | No | No | External market-rate feed not included |
| Consolidation | Yes | Yes | Yes | Partial | No | No | Advanced methods unsupported |
| AI assistant | Yes | Yes | Yes | Partial | No | No | Provider configuration required for live AI |
| Settings and roles | Yes | Yes | Yes | Partial | No | No | Full browser role matrix pending |
| Deployment operations | Partial | N/A | Partial | N/A | No | No | Staging services and recovery evidence missing |
