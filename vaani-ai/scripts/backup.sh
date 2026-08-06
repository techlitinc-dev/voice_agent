#!/usr/bin/env bash
# Daily backup: Postgres dump + MinIO bucket mirror. Keeps 14 days. Run via cron.
set -euo pipefail
DIR=/root/backups
mkdir -p "$DIR/minio"
STAMP=$(date +%Y%m%d-%H%M%S)

# 1. Postgres
docker exec vaani-db-prod pg_dump -U vaani -d vaani --format=custom -f "/tmp/vaani-$STAMP.dump"
docker cp "vaani-db-prod:/tmp/vaani-$STAMP.dump" "$DIR/vaani-$STAMP.dump"
docker exec vaani-db-prod rm "/tmp/vaani-$STAMP.dump"
find "$DIR" -name "vaani-*.dump" -mtime +14 -delete
echo "backup ok: $DIR/vaani-$STAMP.dump ($(du -h "$DIR/vaani-$STAMP.dump" | cut -f1))"

# 2. MinIO (recordings, knowledge docs, KYC, branding) → mirror to /root/backups/minio
MINIO_PW=$(grep '^MINIO_PASSWORD=' /root/voice_agent/vaani-ai/.env | cut -d= -f2-)
NETWORK=$(docker inspect vaani-minio-prod --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
docker run --rm --network "$NETWORK" \
  -v "$DIR/minio:/backup" \
  -e "MC_HOST_vaani=http://vaani:${MINIO_PW}@minio:9000" \
  minio/mc:latest mirror --overwrite vaani /backup
echo "minio backup ok: $(du -sh "$DIR/minio" | cut -f1) across $(find "$DIR/minio" -type f | wc -l) objects"
