#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
backup_dir="${BACKUP_DIRECTORY:-./backups}"
mkdir -p "$backup_dir"
output="$backup_dir/ledgify-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl --file="$output"
echo "Backup created: $output"
