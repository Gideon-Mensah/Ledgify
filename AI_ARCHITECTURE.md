# Ledgify AI architecture

Ledgify AI is a dedicated `apps.ai` boundary. Deterministic intent routing selects a minimal organisation-scoped tool context; tools call existing reports and domain queries rather than rebuilding financial statements. Fresh data is retrieved for each analytical request. Provider generation is abstracted behind `AIProvider`; the default disabled provider falls back to deterministic accounting summaries, so core Ledgify never depends on an external AI service.

Conversations store only visible user/assistant messages and structured metadata—never hidden chain-of-thought. Responses include sources, period/data freshness, confidence and limitations. Database text is treated as untrusted data and cannot choose tools, URLs, SQL or policy. Context limits and per-user hourly request limits are environment-controlled. Payroll tools expose aggregate run totals only; passwords, tokens, credentials and employee bank details are excluded.

Anomaly detection is deterministic: current checks cover duplicate-looking bills and unusually large manual journals. Future detectors can be added without changing provider policy. Management commentary is constrained to retrieved figures and must label inference.

Actions use strict serializers and `Decimal`. The initial allowlist contains only draft manual journals. Account IDs must resolve to active accounts in the same organisation; proposals are balanced but non-mutating. Execution locks the audit row, rechecks user, organisation, status, permission and accounts, then calls `create_journal_entry`. The result remains draft for the normal review/posting workflow.

Frontend route: `/ai`, requiring `use_ai_assistant`. It provides chat history, sources, suggested questions, anomalies and action previews. Provider failure displays a safe unavailable message while all accounting routes continue to function.
