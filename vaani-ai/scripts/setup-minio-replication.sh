#!/usr/bin/env bash
# MinIO bucket replication setup (disaster-recovery doc §2.4).
# Configures cross-region / cross-host replication of the recordings bucket to
# a DR bucket. Run once per bucket; replication then runs continuously.
#
# Usage:
#   setup-minio-replication.sh <primary-endpoint> <primary-alias> <dr-endpoint> <dr-alias>
# Example:
#   setup-minio-replication.sh https://minio.vaani.ai primary https://minio-dr.vaani.ai dr
set -euo pipefail

[ $# -ge 4 ] || { echo "usage: $0 <primary-endpoint> <primary-alias> <dr-endpoint> <dr-alias>" >&2; exit 1; }
PRIMARY_EP=$1 PRIMARY=$2 DR_EP=$3 DR=$4
BUCKET="${MINIO_REPLICATION_BUCKET:-vaani-recordings}"

# Credentials come from env (MINIO_ROOT_USER / MINIO_ROOT_PASSWORD or MC_* aliases
# already configured). Refuse to proceed with empty credentials.
: "${MINIO_ROOT_USER:?set MINIO_ROOT_USER}"
: "${MINIO_ROOT_PASSWORD:?set MINIO_ROOT_PASSWORD}"

mc alias set "$PRIMARY" "$PRIMARY_EP" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc alias set "$DR" "$DR_EP" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

# Remote bucket on the DR side (idempotent).
mc mb --ignore-existing "$DR/$BUCKET-dr" >/dev/null 2>&1 || true

# Enable server-side replication with delete-marker propagation.
mc admin bucket remote add "$PRIMARY/$BUCKET" \
  "$DR/$BUCKET-dr" \
  --replication-policy '{"rule_id":"dr","status":"Enabled","priority":1,"delete_marker_replication":true}'

# List the replication rule to confirm.
mc admin bucket remote ls "$PRIMARY/$BUCKET"

echo "minio replication ok: $PRIMARY/$BUCKET -> $DR/$BUCKET-dr"
echo "DR sync check: mc mirror --overwrite \"$PRIMARY/$BUCKET\" \"$DR/$BUCKET-dr\""
