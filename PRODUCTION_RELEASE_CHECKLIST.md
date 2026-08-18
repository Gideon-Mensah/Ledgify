# Production release checklist

- [ ] Strong secrets delivered; `DEBUG=false`; no secrets in frontend variables
- [ ] Production PostgreSQL, TLS, DNS and proxy configured
- [ ] CORS/CSRF exact origins configured
- [ ] SMTP sender verified and delivery tested
- [ ] Object storage and retention configured
- [ ] Database/media backup completed and restore test current
- [ ] Migrations reviewed; expand/contract safety assessed
- [ ] Backend check/tests/compile and migration drift pass
- [ ] Frontend lint/build pass
- [ ] Dependency audits reviewed; critical/high findings resolved or risk accepted
- [ ] Images build and run as non-root where applicable
- [ ] `/health/`, `/ready/`, login and organisation selection pass
- [ ] `accounting_health_check` and reconciliation smoke checks pass
- [ ] HTTPS redirect, HSTS and secure cookies verified
- [ ] Monitoring, Sentry alerts, structured logs and request IDs verified
- [ ] AI provider/settings/rate limits reviewed; disabled if unused
- [ ] Rollback image, incident owner and maintenance communication ready
