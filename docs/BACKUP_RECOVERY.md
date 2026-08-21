# Backup, restore and disaster recovery

Use provider-managed encrypted PostgreSQL backups daily, with point-in-time recovery where available. Retain daily backups for at least 35 days and monthly archives according to the organisation's statutory policy. Version and replicate S3-compatible object storage separately. Test restoration quarterly in an isolated environment.

Restore procedure: declare incident and stop writes; identify the recovery point; provision an isolated database; restore and validate provider checks; restore matching media versions; inject environment secrets; deploy the matching application release; run migrations only after review; run `check`, `showmigrations`, `/ready/`, and `accounting_health_check`; verify AR/AP, inventory, tax, payroll, fixed assets and WIP; then switch traffic with approval. Never restore staging into production or overwrite the last viable copy.

Target starting objectives: RPO 24 hours without PITR or provider PITR window when enabled; RTO 4 hours. Database loss uses restore/failover; server/frontend loss uses immutable container redeploy; AI or email outage degrades those features while accounting remains available. Record actual provider guarantees before launch.
