# Privacy and security architecture

Ledgify processes organisation, contact, financial, banking, inventory, payroll and audit data. Tenant membership scopes every organisation API. TLS and provider encryption must protect data in transit and at rest; do not build proprietary encryption. Employee bank details, tokens, passwords, SMTP/database credentials and AI keys are sensitive and must not enter logs or AI context. Payroll AI tools expose totals only.

AI sharing is disabled/provider-neutral by default, minimal and request-scoped when enabled, and audited for actions. Conversations may be archived but financial records and AI action audits must follow approved retention/legal policies; no automatic statutory-record deletion exists. Bank uploads require controlled retention and object storage. This document is an engineering foundation, not legal advice or a final privacy notice.
