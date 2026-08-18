# Load-test foundation

Use a staging-only tool such as k6 or Locust with synthetic tenants. Cover token login, dashboard requests, invoice/bank lists, Trial Balance and readiness. Ramp gradually, include `X-Organisation-ID`, avoid write endpoints, set test-user limits, and monitor database queries, p95 latency, errors and memory. Never stress production or reuse customer data without written approval.
