# Production database checklist

- [ ] Managed PostgreSQL provisioned separately for staging and production
- [ ] `DATABASE_URL` delivered through secret management
- [ ] TLS required with provider CA verification (`sslmode=verify-full` where supported)
- [ ] Least-privilege application/migration roles reviewed
- [ ] Encryption at rest confirmed from provider evidence
- [ ] Daily automated backups enabled and retention approved
- [ ] PITR enabled, recovery window recorded and recovery operation exercised
- [ ] Database metrics/alerts configured for connections, storage, latency and errors
- [ ] `CONN_MAX_AGE` and connection health checks verified behind provider pooler
- [ ] Backup restored into a separate database and `accounting_health_check` passed

PITR is provider-level: select a timestamp before the incident, restore to a new instance, validate migrations and accounting, then switch traffic. Never claim PITR from application settings alone.
