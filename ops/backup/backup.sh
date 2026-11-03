#!/usr/bin/env bash
# Dump the live database, restore it into a scratch Postgres in this container to prove the copy
# works, upload it to the private R2 bucket, then record it for the Infrastructure page.
set -euo pipefail
: "${DATABASE_URL:?}" "${R2_ENDPOINT:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
BUCKET="${BACKUP_BUCKET:-e-cinema-backups}"
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
key="db/e-cinema-$(date -u +%Y%m%dT%H%M%SZ).dump"
work=$(mktemp -d)
cd "$work"
pg_dump -Fc --no-owner --no-acl -f backup.dump "$DATABASE_URL"
bytes=$(stat -c %s backup.dump)
echo "dump is $bytes bytes; test restore"
initdb -D "$work/scratch" -U postgres --auth=trust >/dev/null
pg_ctl -D "$work/scratch" -o "-p 55432 -k $work -c listen_addresses=''" -w start >/dev/null
pg_restore --no-owner --no-acl -h "$work" -p 55432 -U postgres -d postgres backup.dump
tables=$(psql -h "$work" -p 55432 -U postgres -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
pg_ctl -D "$work/scratch" -w stop >/dev/null
[ "$tables" -gt 50 ] || { echo "test restore found only $tables tables"; exit 1; }
echo "restore ok: $tables tables"
AWS_DEFAULT_REGION=auto aws s3 cp backup.dump "s3://$BUCKET/$key" --endpoint-url "$R2_ENDPOINT" --only-show-errors
echo "uploaded $key"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
  "INSERT INTO infra_backups (target, object_key, bytes, tables, restored, started_at) VALUES ('r2', '$key', $bytes, $tables, true, '$started')"
rm -rf "$work"
echo "backup ok"
