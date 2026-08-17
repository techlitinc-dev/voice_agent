#!/usr/bin/env bash
# Restore secrets from off-site backup (disaster-recovery doc §4.2 step 3).
# Usage: restore-secrets.sh [backup-key]
#   default: s3://vaani-backups/secrets/env.production.latest.gpg → .env
set -euo pipefail

ENV_FILE="${VAANI_ENV_FILE:-/root/voice_agent/vaani-ai/.env}"
BUCKET="${S3_BUCKET_BACKUPS:-s3://vaani-backups}"
GPG_PASS_FILE="${BACKUP_GPG_PASS_FILE:-/etc/vaani/gpg-pass}"
TMP="${BACKUP_DIR:-/root/backups}/secrets"
SRC="${1:-$BUCKET/secrets/env.production.latest.gpg}"
mkdir -p "$TMP"

[ -f "$GPG_PASS_FILE" ] || { echo "ERROR: $GPG_PASS_FILE missing" >&2; exit 1; }

[ -n "${AWS_S3_ENDPOINT:-}" ] && aws --endpoint-url "$AWS_S3_ENDPOINT" s3 cp "$SRC" "$TMP/env.gpg" \
  || aws s3 cp "$SRC" "$TMP/env.gpg"

gpg --batch --yes --passphrase-file "$GPG_PASS_FILE" --decrypt "$TMP/env.gpg" > "$ENV_FILE"
chmod 600 "$ENV_FILE"
rm -f "$TMP/env.gpg"

echo "secrets restored to $ENV_FILE. Review it, then start services."
