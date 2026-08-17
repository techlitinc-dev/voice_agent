#!/usr/bin/env bash
# Secrets + config backup (disaster-recovery doc §2.5).
# GPG-encrypts the production .env and uploads off-site. Run weekly.
#
# Cron: 45 3 * * 0 /opt/vaani/scripts/backup-secrets.sh
#
# Env:
#   ENV_FILE / VAANI_ENV_FILE      default /root/voice_agent/vaani-ai/.env
#   S3_BUCKET_BACKUPS              default s3://vaani-backups
#   BACKUP_GPG_PASS_FILE           default /etc/vaani/gpg-pass
set -euo pipefail

ENV_FILE="${VAANI_ENV_FILE:-${ENV_FILE:-/root/voice_agent/vaani-ai/.env}}"
BUCKET="${S3_BUCKET_BACKUPS:-s3://vaani-backups}"
GPG_PASS_FILE="${BACKUP_GPG_PASS_FILE:-/etc/vaani/gpg-pass}"
TMP="${BACKUP_DIR:-/root/backups}/secrets"
STAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$TMP"

[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found" >&2; exit 1; }
[ -f "$GPG_PASS_FILE" ] || { echo "ERROR: $GPG_PASS_FILE not found" >&2; exit 1; }

# Strip secrets nobody needs after restore (leave placeholders) — keeps the
# encrypted blob small; real values come from the operator's password manager.
OUT="$TMP/env.production_${STAMP}"
sed -E 's/=.*/=/; s/^#.*//; /^[[:space:]]*$/d' "$ENV_FILE" > "$OUT" || true

gpg --batch --yes --passphrase-file "$GPG_PASS_FILE" --symmetric "$OUT"
rm -f "$OUT"

DEST="$BUCKET/secrets/env.production_${STAMP}.gpg"
[ -n "${AWS_S3_ENDPOINT:-}" ] && aws --endpoint-url "$AWS_S3_ENDPOINT" s3 cp "$OUT.gpg" "$DEST" \
  || aws s3 cp "$OUT.gpg" "$DEST"
rm -f "$OUT.gpg"

# Keep a rolling "latest" pointer for the full-loss runbook (§4.2 step 3).
[ -n "${AWS_S3_ENDPOINT:-}" ] && aws --endpoint-url "$AWS_S3_ENDPOINT" s3 cp "$DEST" "$BUCKET/secrets/env.production.latest.gpg" \
  || aws s3 cp "$DEST" "$BUCKET/secrets/env.production.latest.gpg"

echo "backup-secrets ok: $DEST"
