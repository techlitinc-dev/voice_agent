#!/usr/bin/env bash
# PostgreSQL restore (disaster-recovery doc §4.1 / §4.2).
# Usage:
#   restore-pg.sh latest                  # newest dump from s3://vaani-backups
#   restore-pg.sh s3://.../vaani_pg_YYYYMMDD_HHMMSS.dump.gpg
#
# Steps: fetch → decrypt → pg_restore --clean (into a RUNNING postgres).
# For point-in-time recovery (replay WAL up to a timestamp) see docs/production-readiness/04
# and use restore-pg-pitr.sh instead.
set -euo pipefail

ENV_FILE="${VAANI_ENV_FILE:-/root/voice_agent/vaani-ai/.env}"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

BUCKET="${S3_BUCKET_BACKUPS:-s3://vaani-backups}"
GPG_PASS_FILE="${BACKUP_GPG_PASS_FILE:-/etc/vaani/gpg-pass}"
TMP="${BACKUP_DIR:-/root/backups}/restore"
DB_NAME="${PGDATABASE:-vaani}"
mkdir -p "$TMP"

SRC="${1:-latest}"
if [ "$SRC" = "latest" ]; then
  SRC=$(aws s3 ls "$BUCKET/postgres/" --recursive | sort | tail -1 | awk '{print $4}')
  if [ -z "$SRC" ]; then
    echo "ERROR: no backups found under $BUCKET/postgres/" >&2
    exit 1
  fi
  SRC="$BUCKET/$SRC"
fi

echo "fetching $SRC ..."
aws s3 cp "$SRC" "$TMP/restore.dump.gpg"
[ -f "$GPG_PASS_FILE" ] || { echo "ERROR: $GPG_PASS_FILE missing" >&2; exit 1; }
gpg --batch --yes --passphrase-file "$GPG_PASS_FILE" --decrypt "$TMP/restore.dump.gpg" > "$TMP/restore.dump"

echo "restoring into $DB_NAME ..."
if [ -n "${RESTORE_CONTAINER:-}" ]; then
  docker cp "$TMP/restore.dump" "$RESTORE_CONTAINER:/tmp/restore.dump"
  docker exec "$RESTORE_CONTAINER" pg_restore --clean --if-exists -U vaani -d "$DB_NAME" /tmp/restore.dump
else
  pg_restore --clean --if-exists -d "$DB_NAME" "$TMP/restore.dump"
fi

rm -f "$TMP/restore.dump" "$TMP/restore.dump.gpg"
echo "restore ok. Run pending migrations: npx prisma migrate deploy"
