# Performance readiness

The frontend build separates React, charts and PDF libraries into vendor chunks. Major opportunities remain route-level lazy loading and PDF-on-demand loading. Current lists are acceptable for demo scale; pagination must be introduced with frontend contract updates before large tenants.

Backend reports primarily use database aggregation and scoped querysets. High-traffic lists already use select/prefetch patterns in many domains; production query-count baselines are still required for dashboard, invoices, bills, banking, inventory, payroll, manufacturing and consolidation. Add indexes only from measured plans. Future opportunities include short-lived report caching, background exports and CDN static delivery; never cache across organisations.
