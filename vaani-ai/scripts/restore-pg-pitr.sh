#!/usr/bin/env bash
# PostgreSQL point-in-time recovery (disaster-recovery doc §4.1).
#
# Scenario: bad DELETE at 14:32. Restore the base backup taken before that,
# then replay WAL up to 14:31:59.
#
# Usage:
#   restore-pg-pitr.sh <base-backup-key> <recovery-time-IST> <container>
# Example:
#   restore-pg-pitr.sh s3://vaani-backups/postgres/2026/08/07/vaani_pg_20260807_1425.dump.gpg "2026-08-07 14:31:59 IST" vaani-db-prod
set -euo pipefail

[ $# -ge 3 ] || { echo "usage: $0 <backup-key> <recovery-time> <container>" >&2; exit 1; }
SRC=$1 RECOVERY_TIME=$2 CONTAINER=$3
ENV_FILE="${VAANI_ENV_FILE:-/root/voice_agent/vaani-ai/.env}"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
GPG_PASS_FILE="${BACKUP_GPG_PASS_FILE:-/etc/vaani/gpg-pass}"
TMP="${BACKUP_DIR:-/root/backups}/pitr"
mkdir -p "$TMP"

echo "==> 1/5 stopping app (prevent new writes)"
docker compose -f docker-compose.prod.yml stop web worker || true

echo "==> 2/5 stopping postgres"
docker compose -f docker-compose.prod.yml stop db || true

echo "==> 3/5 restoring base backup from before the incident"
aws s3 cp "$SRC" "$TMP/base.dump.gpg"
gpg --batch --yes --passphrase-file "$GPG_PASS_FILE" --decrypt "$TMP/base.dump.gpg" > "$TMP/base.dump"
docker cp "$TMP/base.dump" "$CONTAINER:/tmp/base.dump"
docker exec "$CONTAINER" pg_restore --clean --if-exists -U vaani -d vaani /tmp/base.dump

echo "==> 4/5 configuring WAL replay up to $RECOVERY_TIME"
docker exec "$CONTAINER" sh -c "cat >> /var/lib/postgresql/data/recovery.signal <<'EOF'
restore_command = 'aws s3 cp s3://vaani-backups/wal/%f -'
recovery_target_time = '$RECOVERY_TIME'
recovery_target_action = 'promote'
EOF"

echo "==> 5/5 starting postgres — it replays WAL and promotes"
docker compose -f docker-compose.prod.yml start db
sleep 5
docker compose -f docker-compose.prod.yml start web worker

echo "PITR complete. Verify: curl https://<domain>/api/health/deep"
