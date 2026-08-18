# Ledgify API

Base path: `/api/v1/`. Authenticate with `Authorization: Bearer <access-token>`. Every organisation-owned endpoint also requires `X-Organisation-ID: <uuid>`; membership and action permissions are verified server-side.

Primary domains are auth/organisations, contacts, accounting/journals/reports, sales, purchases, finance, banking, inventory, fixed assets, tax, payroll, FX, consolidation, manufacturing and AI. Router conventions provide list/create at `<resource>/`, detail at `<resource>/<uuid>/`, and named workflow actions below the detail URL.

Standard errors: `400` validation/business rule, `401` missing/invalid JWT, `403` organisation or permission denial, `404` scoped resource absent, `409` where an explicit conflict response is used, `429` throttled, and `500` unexpected server failure. Responses include `X-Request-ID` for support correlation. Never send secrets in query strings.

Health endpoints are `/health/` (process) and `/ready/` (database). They expose no configuration.
