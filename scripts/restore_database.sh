#!/bin/sh
set -eu
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL must identify a separate restore-test database}"
: "${BACKUP_FILE:?BACKUP_FILE is required}"
case "$RESTORE_DATABASE_URL" in *production*|*prod*) echo "Refusing a restore target whose URL appears to be production." >&2; exit 2;; esac
pg_restore --dbname="$RESTORE_DATABASE_URL" --clean --if-exists --no-owner --no-acl "$BACKUP_FILE"
echo "Restore completed. Run checks and accounting_health_check against RESTORE_DATABASE_URL."
