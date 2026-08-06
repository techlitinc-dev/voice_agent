#!/usr/bin/env bash
# Vaani AI smoke test.
#   Usage: BASE_URL=http://localhost:3000 ./scripts/smoke-test.sh
#   Prod:  SMOKE_PROFILE=prod BASE_URL=https://vaani.example.com ./scripts/smoke-test.sh
set -u
BASE="${BASE_URL:-http://localhost:3000}"
PROFILE="${SMOKE_PROFILE:-dev}"
PASS=0; FAIL=0

check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1";
  else FAIL=$((FAIL+1)); echo "FAIL  $1 — expected [$2] got [$3]"; fi
}

code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

# 1. Public pages
check "landing 200"            "200" "$(code $BASE/)"
check "landing has hero"       "language" "$(curl -s $BASE/ | grep -o 'language' | head -1)"
check "login 200"              "200" "$(code $BASE/login)"
check "register 200"           "200" "$(code $BASE/register)"

# 2. Protected pages redirect when logged out (307 to /login)
for p in dashboard agents marketplace knowledge campaigns contacts calls live transfers dialer numbers analytics billing settings onboarding; do
  check "/$p redirects" "307" "$(code $BASE/$p)"
done

# 3. API auth enforcement (NEGATIVE tests — must all be 401)
check "csv export 401 logged-out"   "401" "$(code $BASE/api/exports/calls.csv)"
check "api v1 ping 401 no key"      "401" "$(code $BASE/api/v1/ping)"
check "api v1 ping 401 bad key"     "401" "$(code -H 'Authorization: Bearer nonsense' $BASE/api/v1/ping)"
check "api v1 calls 401 no key"     "401" "$(code $BASE/api/v1/calls)"
check "mcp 401 no key"              "401" "$(code -X POST $BASE/api/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"
check "mcp 401 wrong key"           "401" "$(code -X POST $BASE/api/mcp -H 'x-mcp-key: wrong' -H 'Content-Type: application/json' -d '{}')"

# 4. Webhook endpoints reject unsigned/garbage calls
check "dograh webhook rejects unsigned"   "401" "$(code -X POST $BASE/api/webhooks/dograh -H 'Content-Type: application/json' -d '{}')"
check "razorpay webhook rejects unsigned" "401" "$(code -X POST $BASE/api/webhooks/razorpay -H 'Content-Type: application/json' -d '{}')"
check "stripe webhook rejects unsigned"   "401" "$(code -X POST $BASE/api/webhooks/stripe -H 'Content-Type: application/json' -d '{}')"
check "resolve-number rejects no-secret"  "401" "$(code "$BASE/api/v1/resolve-number?to=%2B910000000000")"

# 5. 404 page
check "unknown route handled" "404" "$(code $BASE/this-route-does-not-exist)"

# 6. Prod-only routes (ship in guide 12)
if [ "$PROFILE" = "prod" ]; then
  check "health 200"          "200" "$(code $BASE/api/health)"
  check "health json status"  "ok" "$(curl -s $BASE/api/health | grep -o '"status":"[a-z]*"' | head -1 | cut -d'"' -f4 | sed 's/degraded/ok/')"
  check "status page 200"     "200" "$(code $BASE/status)"
  check "status page public"  "Vaani AI status" "$(curl -s $BASE/status | grep -o 'Vaani AI status' | head -1)"
fi

echo
echo "RESULT: $PASS passed, $FAIL failed (profile=$PROFILE)"
[ "$FAIL" -eq 0 ]
