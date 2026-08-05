#!/usr/bin/env bash
# Vaani AI — voice-stack / SIP-trunk health check (readme §12).
# Cron:  */5 * * * * /root/vaani-ai/scripts/check-trunk.sh >> /var/log/vaani-trunk.log 2>&1
# Exit 0 = all green; exit 1 = at least one check failed (cron mail/alert fires).
set -u
cd /root/vaani-ai
# .env may contain shell-breaking chars (e.g. SMTP_FROM angle brackets), so load
# only the keys this script needs instead of sourcing the whole file.
export DOGRAH_BASE_URL=$(grep "^DOGRAH_BASE_URL=" .env | head -1 | sed "s/^DOGRAH_BASE_URL=//" | sed "s/ *#.*//" | tr -d ' "')
export DOGRAH_API_KEY=$(grep "^DOGRAH_API_KEY=" .env | head -1 | sed "s/^DOGRAH_API_KEY=//" | sed "s/ *#.*//" | tr -d ' "')
export VOBIZ_API_BASE=$(grep "^VOBIZ_API_BASE=" .env | head -1 | sed "s/^VOBIZ_API_BASE=//" | sed "s/ *#.*//" | tr -d ' "')
export VOBIZ_ACCOUNT_PATH=$(grep "^VOBIZ_ACCOUNT_PATH=" .env | head -1 | sed "s/^VOBIZ_ACCOUNT_PATH=//" | sed "s/ *#.*//" | tr -d ' "')
export VOBIZ_AUTH_ID=$(grep "^VOBIZ_AUTH_ID=" .env | head -1 | sed "s/^VOBIZ_AUTH_ID=//" | sed "s/ *#.*//" | tr -d ' "')
export VOBIZ_AUTH_TOKEN=$(grep "^VOBIZ_AUTH_TOKEN=" .env | head -1 | sed "s/^VOBIZ_AUTH_TOKEN=//" | sed "s/ *#.*//" | tr -d ' "')
FAIL=0
ts() { date -Is; }

# 1. Dograh process health
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${DOGRAH_BASE_URL}/api/v1/health" || echo 000)
if [ "$CODE" = "200" ]; then echo "$(ts) dograh-health OK (http 200)";
else echo "$(ts) dograh-health FAIL (http $CODE)"; FAIL=1; fi

# 2. Dograh auth + telephony configs reachable (trunk config still valid server-side)
CODE=$(curl -s -o /tmp/telephony-configs.json -w "%{http_code}" --max-time 10 \
  -H "X-API-Key: ${DOGRAH_API_KEY}" \
  "${DOGRAH_BASE_URL}/api/v1/organizations/telephony-configs" || echo 000)
if [ "$CODE" = "200" ]; then
  N=$(grep -o '"id"' /tmp/telephony-configs.json | wc -l)
  echo "$(ts) dograh-telephony OK ($N config(s))"
else echo "$(ts) dograh-telephony FAIL (http $CODE)"; FAIL=1; fi

# 3. Vobiz REST API reachability + credentials
#    OPERATOR GATE: if Vobiz documents a different account-info path, set
#    VOBIZ_ACCOUNT_PATH in .env. 404 = wrong path (WARN), 401/403 = bad creds (FAIL).
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  -u "${VOBIZ_AUTH_ID:-}:${VOBIZ_AUTH_TOKEN:-}" \
  "${VOBIZ_API_BASE:-https://api.vobiz.ai}${VOBIZ_ACCOUNT_PATH:-/v1/account}" || echo 000)
case "$CODE" in
  200)    echo "$(ts) vobiz-api OK (http 200)";;
  401|403) echo "$(ts) vobiz-api FAIL auth (http $CODE)"; FAIL=1;;
  404)    echo "$(ts) vobiz-api WARN path 404 — confirm VOBIZ_ACCOUNT_PATH with Vobiz docs";;
  *)      echo "$(ts) vobiz-api FAIL (http $CODE)"; FAIL=1;;
esac

exit $FAIL
