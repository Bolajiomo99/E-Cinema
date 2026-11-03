#!/usr/bin/env bash
# Nightly database copy to Cloudflare R2 (Figma 50:469, copy 4): dump the live Render database,
# restore it into a scratch Postgres to prove the copy works, upload it, then record it.
set -euo pipefail
: "${RENDER_API_KEY:?}" "${RENDER_OWNER_ID:?}" "${CLOUDFLARE_API_TOKEN:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
render() { curl -fsS -H "authorization: Bearer $RENDER_API_KEY" -H "accept: application/json" "https://api.render.com/v1$1"; }
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
db=$(render "/postgres?ownerId=$RENDER_OWNER_ID&name=e-cinema-db&limit=20" | jq -r '[.[].postgres | select(.name == "e-cinema-db")][0].id')
[ -n "$db" ] && [ "$db" != null ] || { echo "database not found"; exit 1; }
ver=$(render "/postgres/$db" | jq -r '.version')
url=$(render "/postgres/$db/connection-info" | jq -r '.externalConnectionString')
echo "dumping Postgres $ver"
key="db/e-cinema-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker run --rm --network host -v "$PWD:/out" "postgres:$ver" pg_dump -Fc --no-owner --no-acl -f /out/backup.dump "$url"
bytes=$(stat -c %s backup.dump)
echo "dump is $bytes bytes; test restore"
docker run -d --name scratch -e POSTGRES_PASSWORD=scratch -p 55432:5432 "postgres:$ver" >/dev/null
for i in $(seq 1 30); do docker exec scratch pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2
docker run --rm --network host -v "$PWD:/out" -e PGPASSWORD=scratch "postgres:$ver" pg_restore --no-owner --no-acl -h 127.0.0.1 -p 55432 -U postgres -d postgres /out/backup.dump
tables=$(docker exec scratch psql -U postgres -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
accounts=$(docker exec scratch psql -U postgres -At -c "SELECT count(*) FROM accounts")
docker rm -f scratch >/dev/null
[ "$tables" -gt 50 ] || { echo "test restore found only $tables tables"; exit 1; }
echo "restore ok: $tables tables, $accounts accounts"
account=$(curl -fsS -H "authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/zones?name=e-cinema.net" | jq -r '.result[0].account.id')
AWS_DEFAULT_REGION=auto aws s3 cp backup.dump "s3://e-cinema-backups/$key" --endpoint-url "https://$account.r2.cloudflarestorage.com" --only-show-errors
echo "uploaded $key"
docker run --rm --network host "postgres:$ver" psql "$url" -v ON_ERROR_STOP=1 -c \
  "INSERT INTO infra_backups (target, object_key, bytes, tables, restored, started_at) VALUES ('r2', '$key', $bytes, $tables, true, '$started')"
rm -f backup.dump
echo "backup ok"
