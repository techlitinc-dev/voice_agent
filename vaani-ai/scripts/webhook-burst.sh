#!/usr/bin/env bash
# Webhook burst: 20 concurrent signed Dograh events must all get HTTP 200.
#   Usage: BASE_URL=http://localhost:3000 ./scripts/webhook-burst.sh
#   Prod:  BASE_URL=https://vaani.example.com ./scripts/webhook-burst.sh
set -u
BASE="${BASE_URL:-http://localhost:3000}"
cd "$(dirname "$0")/.."
SECRET=$(grep '^DOGRAH_WEBHOOK_SECRET=' .env | cut -d= -f2)
if [ -z "$SECRET" ]; then echo "DOGRAH_WEBHOOK_SECRET unset — cannot sign"; exit 1; fi
BODY='{"event":"call.ended","data":{"call_id":"burst_test","duration_seconds":10,"transcript":"x"}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
seq 1 20 | xargs -P 20 -I{} curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "$BASE/api/webhooks/dograh" -H "Content-Type: application/json" \
  -H "x-dograh-signature: $SIG" -d "$BODY" | sort | uniq -c
