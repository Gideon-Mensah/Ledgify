# Penetration-test scope

Professional testing should cover JWT login/refresh and brute-force controls; role escalation; cross-organisation IDOR on every resource/action/export; posted-record mutation/deletion; SQL injection and malformed JSON; stored/reflected XSS; CSRF/CORS/proxy trust; upload MIME, size, binary/polyglot and CSV cases; report/export data leakage; throttling/API abuse; admin exposure; sensitive payroll/bank data; secret/log disclosure; dependency/container scanning; and AI prompt injection, tool-policy bypass, foreign account IDs and replay/stale actions.

Use isolated synthetic staging data, agreed traffic limits and escalation contacts. Exclude destructive availability testing unless separately authorised. Findings require severity, reproducible evidence, affected tenant boundary, remediation and retest. This repository work is preparation—not a completed penetration test.
