#!/usr/bin/env bash
# Cron every 2 min: page when the public health endpoint is not "ok".
set -uo pipefail
DOMAIN=$(grep '^DOMAIN=' /root/vaani-ai/.env | cut -d= -f2-)
URL="https://${DOMAIN}/api/health"
OUT=$(curl -s -m 10 "$URL" 2>/dev/null || echo '{"status":"down","checks":{}}')
if echo "$OUT" | grep -q '"status":"ok"'; then
  exit 0
fi
/root/vaani-ai/scripts/alert.sh "health check FAILED ($URL): $OUT" || true
