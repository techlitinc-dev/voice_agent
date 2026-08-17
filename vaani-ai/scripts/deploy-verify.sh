#!/usr/bin/env bash
# Post-deploy verification (deployment runbook §6.1). Run immediately after
# every deploy. Exits non-zero on any failed check.
#
# Usage: deploy-verify.sh [base-url] [api-key]
set -uo pipefail

BASE="${1:-http://localhost:3000}"
API_KEY="${2:-}"
PASS=0; FAIL=0

check() {
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1";
  else FAIL=$((FAIL+1)); echo "FAIL  $1 — expected [$2] got [$3]"; fi
}
code() { curl -s -o /dev/null -w "%{http_code}" -m 10 "$@"; }

echo "==> deploy verification against $BASE"

check "liveness /api/health"      "200" "$(code $BASE/api/health)"
check "readiness /api/health/ready" "200" "$(code $BASE/api/health/ready)"
check "deep /api/health/deep"     "200" "$(code $BASE/api/health/deep)"
check "login page"                "200" "$(code $BASE/login)"
check "register page"             "200" "$(code $BASE/register)"
check "status page"               "200" "$(code $BASE/status)"

# Negative: API requires a key (docs §6.1 — /api/v1/calls with API key works).
check "api v1 calls 401 no key"   "401" "$(code $BASE/api/v1/calls)"
if [ -n "$API_KEY" ]; then
  check "api v1 calls with key"   "200" "$(code -H "Authorization: Bearer $API_KEY" "$BASE/api/v1/calls")"
fi

# Full smoke test (public pages, auth redirects, webhook signature rejection).
BASE_URL="$BASE" SMOKE_PROFILE=prod ./scripts/smoke-test.sh >/tmp/vaani-smoke.out 2>&1
if grep -q "FAIL" /tmp/vaani-smoke.out; then
  FAIL=$((FAIL+1)); echo "FAIL  smoke-test.sh — see /tmp/vaani-smoke.out"
else
  PASS=$((PASS+1)); echo "PASS  smoke-test.sh"
fi

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
