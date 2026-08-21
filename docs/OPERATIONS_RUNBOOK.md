# Operations runbook

Restart: drain traffic, restart container instances, verify health/readiness and logs, then restore traffic. High error rate: capture request IDs, freeze deployment, inspect application/database/provider metrics and roll back if release-correlated. Database outage: stop writes, use provider failover/restore, then run readiness and accounting health checks.

Failed migration: do not blindly reverse destructive migrations. Stop rollout, preserve database backup, assess whether the previous application is schema-compatible, and follow the migration's reviewed rollback/forward-fix plan. Release rollback uses the previous immutable image; database restore requires incident approval.

AI outage: disable `AI_ENABLED`; deterministic/core accounting remains available. Email outage: queue/manual operational follow-up; never mark unsent mail as delivered. Frontend outage: restore the prior static deployment while API remains protected. Record timeline, impact, recovery point and post-incident actions.
