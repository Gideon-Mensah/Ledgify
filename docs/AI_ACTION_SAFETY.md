# AI action safety

Read-only capabilities include financial reports, AR/AP aging, banking summaries, inventory, manufacturing, payroll totals, tax totals, fixed assets and supported consolidation reports.

Draft capabilities are limited to manual journal drafts and text-only customer/supplier communication drafts. A journal proposal never creates a journal. Approval calls the audited execution endpoint, revalidates real account IDs and permissions, and uses the existing journal service. Stale, foreign, malformed, already-executed or permission-invalid proposals fail without mutation.

Autonomous posting, payments, refunds, reconciliation, period/year close, tax filing, payroll payment, depreciation, disposal, FX revaluation, elimination posting, production completion, deletion and permission changes are centrally blocked. Normal workflow permissions always remain authoritative. Every execution records user, organisation, proposal, executed payload, result and timestamp.

AI output is advisory. Tax outputs are accounting summaries, not legal or filing-compliance advice. Unsupported consolidation methods and forecasts must not be represented as complete.
