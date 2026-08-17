#!/usr/bin/env bash
# Redis RDB snapshot backup (disaster-recovery doc §2.3).
# Triggers BGSAVE, waits for it to finish, uploads dump.rdb off-site.
# Redis holds only queues/cache — RPO is minutes, acceptable per the doc.
#
# Cron: 15 * * * * /opt/vaani/scripts/backup-redis.sh   (hourly)
#
# Env:
#   REDIS_HOST / REDIS_PORT       default 127.0.0.1 / 6379 (or REDIS_CONTAINER)
#   S3_BUCKET_BACKUPS             default s3://vaani-backups
#   REDIS_RDB_PATH                default /var/lib/redis/dump.rdb
set -euo pipefail

ENV_FILE="${VAANI_ENV_FILE:-/root/voice_agent/vaani-ai/.env}"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

BUCKET="${S3_BUCKET_BACKUPS:-s3://vaani-backups}"
RDB_PATH="${REDIS_RDB_PATH:-/var/lib/redis/dump.rdb}"
TMP="${BACKUP_DIR:-/root/backups}/redis"
STAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$TMP"

redis_cli() {
  if [ -n "${REDIS_CONTAINER:-}" ]; then
    docker exec "$REDIS_CONTAINER" redis-cli "$@"
  else
    redis-cli -h "${REDIS_HOST:-127.0.0.1}" -p "${REDIS_PORT:-6379}" "$@"
  fi
}

# 1. Trigger BGSAVE and capture the pre-save LASTSAVE as the watermark.
START=$(redis_cli LASTSAVE)
redis_cli BGSAVE >/dev/null

# 2. Wait for the snapshot to complete (LASTSAVE advances past the watermark).
for _ in $(seq 1 120); do
  NOW=$(redis_cli LASTSAVE)
  [ "$NOW" -gt "$START" ] && break
  sleep 1
done

# 3. Copy the RDB out of the container/host and upload.
if [ -n "${REDIS_CONTAINER:-}" ]; then
  docker cp "$REDIS_CONTAINER:$RDB_PATH" "$TMP/dump_${STAMP}.rdb"
else
  cp "$RDB_PATH" "$TMP/dump_${STAMP}.rdb"
fi

DEST="$BUCKET/redis/dump_${STAMP}.rdb"
[ -n "${AWS_S3_ENDPOINT:-}" ] && aws --endpoint-url "$AWS_S3_ENDPOINT" s3 cp "$TMP/dump_${STAMP}.rdb" "$DEST" \
  || aws s3 cp "$TMP/dump_${STAMP}.rdb" "$DEST"

# Local retention: keep last 24 hourly snapshots.
ls -t "$TMP"/dump_*.rdb 2>/dev/null | tail -n +25 | xargs -r rm -f
echo "backup-redis ok: $DEST ($(du -h "$TMP/dump_${STAMP}.rdb" | cut -f1))"
