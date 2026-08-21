# Ledgify RC1 Known Limitations

- The former £375 AR/GL blocker is resolved through corrected ledger-effective reversal reporting; no historical journals were modified.
- Production infrastructure is not fully verified. PostgreSQL staging, TLS, secret rotation, object storage, email delivery, monitoring, alerting, and backup restoration need evidence.
- Live bank feeds are not configured; CSV statement import is the verified ingestion path.
- Tax is country-agnostic accounting tax. Jurisdiction-specific electronic filing is not provided.
- Payroll provides an accounting engine and configurable components; jurisdiction-specific statutory calculations require configured jurisdiction support and professional validation.
- Consolidation supports full consolidation for 100%-owned subsidiaries. NCI, equity method, proportionate consolidation, full CTA, and consolidated Cash Flow are unsupported.
- Live AI depends on provider configuration. Fallback mode and deterministic accounting tools remain available; AI cannot autonomously post high-risk accounting actions.
- Cash Flow depends on configured cash-flow categories and posted journal classification; unsupported classifications must be reviewed rather than inferred silently.
- Demo seed coverage does not yet guarantee a fixed asset, production order, manual journal, completed reconciliation, or dedicated ratio-analysis fixture.
- Frontend production build has a non-blocking Vite advisory for chunks larger than 500 kB.
- Browser-level QA at all requested viewports and assistive-technology testing still require a real browser/device matrix.
- Legacy localStorage service files remain in the source tree, but active integrated routes use backend API services. Their removal should be handled separately after dependency confirmation.
