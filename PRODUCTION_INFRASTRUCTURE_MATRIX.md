# Production infrastructure verification matrix

| Control | Code Ready | Infrastructure Configured | Verified | Blocking | Evidence / notes |
|---|---|---|---|---|---|
| Docker | Yes | No | No | Yes | Dockerfiles/Compose ready; Docker unavailable locally |
| PostgreSQL | Yes | No | No | Yes | Fail-closed `DATABASE_URL`; checklist supplied |
| Database TLS | Yes | No | No | Yes | sslmode supported; provider CA evidence required |
| Database backup | Yes | No | No | Yes | `scripts/backup_database.sh`; no database provisioned |
| PITR | N/A provider | No | No | Yes | Provider capability and recovery exercise required |
| Restore test | Yes procedure | No | No | Yes | Restore script targets a separate DB; not exercised |
| HTTPS | Yes | No | No | Yes | Environment switches and guide ready |
| DNS | N/A provider | No | No | Yes | Final domains unknown |
| Reverse proxy | Yes | No | No | Yes | nginx config exists; runtime `nginx -t` unavailable |
| Secure cookies | Yes | No | No | Yes | Must be exercised behind HTTPS |
| HSTS | Yes | No | No | Yes | Must be exercised after full HTTPS verification |
| SMTP | Yes | No | No | Conditional | Explicit test command reports not configured |
| Object storage | Interface | No | No | Yes for uploads | Test command supplied; backend/provider package required |
| Monitoring | Yes endpoints | No | No | Yes | External uptime/latency/database monitors required |
| Sentry | Yes optional | No | No | Yes | No DSN configured |
| Secret management | Yes env contract | No | No | Yes | Provider secret store required |
| File upload security | Yes | Local validation | Yes (automated) | No | CSV size/type/signature/row limits; malicious/oversized tests pass |
| CI | Yes | Workflow supplied | Locally equivalent | No | GitHub-hosted run not observed |
| Penetration test | Scope ready | No | No | Yes | Formal test or authorised risk acceptance required |

Verification date: 2026-08-13. Installed host nginx configuration passed `nginx -t`; the Ledgify container nginx configuration remains unexecuted because Docker is unavailable. SMTP and persistent-storage test commands both correctly reported `NOT CONFIGURED`. Production-like `check --deploy` passes with all HTTPS security variables enabled, but this proves settings wiring only—not live TLS.
