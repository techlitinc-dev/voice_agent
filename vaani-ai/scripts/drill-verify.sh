#!/usr/bin/env bash
# DR drill verification (disaster-recovery doc §5) — asserts the environment is
# fully functional end-to-end. Used as the final gate of every quarterly drill.
#
# Usage: drill-verify.sh [base-url] [api-key]
set -uo pipefail

BASE="${1:-https://app.vaani.ai}"
API_KEY="${2:-}"
PASS=0
FAIL=0

check() {
  local name=$1 ok=$2 detail=$3
  if [ "$ok" = "ok" ]; then
    PASS=$((PASS+1)); echo "PASS  $name"
  else
    FAIL=$((FAIL+1)); echo "FAIL  $name — $detail"
  fi
}

echo "==> drill verification against $BASE"

# 1. Liveness
OUT=$(curl -s -m 10 "$BASE/api/health" 2>/dev/null || echo '{"status":"down"}')
check "liveness /api/health" "$(echo "$OUT" | grep -q '"status":"ok"' && echo ok || echo fail)" "$OUT"

# 2. Readiness
OUT=$(curl -s -m 10 "$BASE/api/health/ready" 2>/dev/null || echo '{"status":"not_ready"}')
check "readiness /api/health/ready" "$(echo "$OUT" | grep -q '"status":"ready"' && echo ok || echo fail)" "$OUT"

# 3. Deep health (secrets + migrations + MinIO + Dograh)
OUT=$(curl -s -m 15 "$BASE/api/health/deep" 2>/dev/null || echo '{"status":"degraded"}')
check "deep /api/health/deep" "$(echo "$OUT" | grep -q '"status":"ok"' && echo ok || echo fail)" "$OUT"

# 4. Authenticated API round-trip (proves DB reads + auth work after restore)
if [ -n "$API_KEY" ]; then
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 10 -H "Authorization: Bearer $API_KEY" "$BASE/api/v1/me")
  check "authenticated API (api/v1/me)" "$([ "$CODE" = "200" ] && echo ok || echo fail)" "HTTP $CODE"
else
  echo "SKIP  authenticated API — pass API_KEY as arg 2"
fi

# 5. Login page renders (Next.js app up)
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$BASE/login")
check "login page" "$([ "$CODE" = "200" ] && echo ok || echo fail)" "HTTP $CODE"

echo
echo "==> drill result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
