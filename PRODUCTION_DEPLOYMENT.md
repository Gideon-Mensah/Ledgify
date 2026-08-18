# Production deployment

Build immutable backend/frontend images from the supplied Dockerfiles. Production requires all variables in `PRODUCTION_CONFIGURATION.md`, a PostgreSQL `DATABASE_URL`, explicit HTTPS CORS/CSRF origins, SMTP credentials, managed object storage configuration, and optional server-side AI/Sentry credentials. `VITE_API_BASE_URL` is public and must contain no secret.

Release sequence: confirm backup and rollback image; review migrations; deploy to staging; run backend tests, frontend lint/build and dependency scans; build images; take production backup; run `python manage.py migrate`; run `collectstatic`; restart Gunicorn; verify `/health/`, `/ready/`, login/organisation selection and `python manage.py accounting_health_check`; then perform invoice/journal/report smoke tests. Roll back application image first; restore database only when migrations/data require it and with incident approval.

Self-hosted nginx proxies `/api`, `/health` and `/ready` and serves the SPA. TLS certificates belong to the ingress/provider, not this repository. Staging must have separate database, storage, email sandbox, AI key and secrets and must never contain production accounting data.

Large future migrations use expand/migrate/contract: add backward-compatible schema, backfill separately, deploy readers, then remove old schema in a later reviewed release. Background candidates include exports, email, AI scans, bank imports, depreciation, payroll, manufacturing/consolidation reports and scheduled FX. No Redis/Celery is introduced until workload requires it.
