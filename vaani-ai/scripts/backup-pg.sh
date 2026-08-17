#!/usr/bin/env bash
# PostgreSQL logical dump backup (disaster-recovery doc §2.1).
# - pg_dump custom-format, gzip-compressed
# - GPG-encrypted before leaving the host (passphrase in /etc/vaani/gpg-pass)
# - uploaded to off-site S3 (or B2) under s3://vaani-backups/postgres/YYYY/MM/DD/
# - local retention: keep last 3 encrypted dumps
#
# Cron: */5 * * * * /opt/vaani/scripts/backup-pg.sh   (5-min base backups)
# Cron: 30 2 * * *  /opt/vaani/scripts/backup-pg.sh   (daily logical dump)
#
# Env (in /root/voice_agent/vaani-ai/.env or exported):
#   DATABASE_URL          postgres connection string (or PGDUMP_TARGET for docker exec)
#   S3_BUCKET_BACKUPS     e.g. s3://vaani-backups
#   BACKUP_GPG_PASS_FILE  default /etc/vaani/gpg-pass
#   BACKUP_DIR            local staging dir, default /root/backups/pg
set -euo pipefail

ENV_FILE="${VAANI_ENV_FILE:-/root/voice_agent/vaani-ai/.env}"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

BUCKET="${S3_BUCKET_BACKUPS:-s3://vaani-backups}"
GPG_PASS_FILE="${BACKUP_GPG_PASS_FILE:-/etc/vaani/gpg-pass}"
DIR="${BACKUP_DIR:-/root/backups/pg}"
STAMP=$(date +%Y%m%d_%H%M%S)
DUMP="$DIR/vaani_pg_${STAMP}.dump"
DEST="$BUCKET/postgres/$(date +%Y/%m/%d)/vaani_pg_${STAMP}.dump.gpg"

mkdir -p "$DIR"

# 1. Dump. If DATABASE_URL points at a local container we use docker exec
#    (pg_dump inside the container avoids version mismatch); otherwise pg_dump.
if [ -n "${PGDUMP_CONTAINER:-}" ]; then
  docker exec "$PGDUMP_CONTAINER" pg_dump -U vaani -d vaani --format=custom --compress=9 -f "/tmp/vaani_${STAMP}.dump"
  docker cp "$PGDUMP_CONTAINER:/tmp/vaani_${STAMP}.dump" "$DUMP"
  docker exec "$PGDUMP_CONTAINER" rm -f "/tmp/vaani_${STAMP}.dump"
else
  pg_dump "$DATABASE_URL" --format=custom --compress=9 --file="$DUMP"
fi

# 2. Encrypt (GPG symmetric) — the dump never leaves the host unencrypted.
if [ ! -f "$GPG_PASS_FILE" ]; then
  echo "ERROR: GPG passphrase file $GPG_PASS_FILE missing — aborting before upload" >&2
  rm -f "$DUMP"
  exit 1
fi
gpg --batch --yes --passphrase-file "$GPG_PASS_FILE" --symmetric "$DUMP"
rm -f "$DUMP" # plaintext is gone; only .gpg remains

# 3. Upload off-site (aws cli, or mc for MinIO-compatible endpoints).
ENCRYPTED="$DUMP.gpg"
if [ -n "${AWS_S3_ENDPOINT:-}" ]; then
  aws --endpoint-url "$AWS_S3_ENDPOINT" s3 cp "$ENCRYPTED" "$DEST"
else
  aws s3 cp "$ENCRYPTED" "$DEST"
fi

# 4. Local retention: keep the newest 3 encrypted dumps.
ls -t "$DIR"/vaani_pg_*.dump.gpg 2>/dev/null | tail -n +4 | xargs -r rm -f

echo "backup-pg ok: $DEST ($(du -h "$ENCRYPTED" | cut -f1))"
