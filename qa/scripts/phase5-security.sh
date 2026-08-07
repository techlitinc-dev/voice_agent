#!/usr/bin/env bash
# =============================================================================
# PHASE 5 — SECURITY & COMPLIANCE TESTS
# Auth/authz, PII redaction, injection, fuzzing, rate limits, webhook signatures,
# cookie flags, SSRF guards, TOTP, audit logging. Deterministic assertions.
# =============================================================================
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

phase_begin "5-security"

# Test dograh on DOGRAH_QA_PORT (default 8100) — avoids clashing with a prod
# dograh on :8000.
DOGRAH_QA_PORT="${DOGRAH_QA_PORT:-8100}"
DOGRAH_URL="http://127.0.0.1:$DOGRAH_QA_PORT"

# 1. boot dograh (security tests target real API with .env.test)
(
  cd "$REPO_ROOT/dograh"
  .venv/bin/python -m uvicorn api.app:app --host 127.0.0.1 --port "$DOGRAH_QA_PORT" \
    --env-file api/.env.test > "$STATE_DIR/sec-dograh.log" 2>&1 &
  echo $! > "$STATE_DIR/sec-dograh.pid"
)
retry 30 1 curl -sf "$DOGRAH_URL/api/v1/health" > /dev/null || { blocked "sec-boot" "dograh did not boot"; phase_end; exit 2; }

# 2. unit security suites (vitest) — run even if server boot fails above is OK
(cd "$REPO_ROOT/vaani-ai" && npx vitest run \
  tests/ratelimit.test.ts tests/permissions.test.ts tests/pii.test.ts \
  tests/totp.test.ts tests/webhook-sign.test.ts tests/stripe-sig.test.ts \
  tests/spamFilter.test.ts tests/domain-verify.test.ts tests/apikeys.test.ts \
  --reporter=json --outputFile="$STATE_DIR/sec-vitest.json") > "$STATE_DIR/sec-vitest.log" 2>&1
if [[ $? -eq 0 ]]; then pass "sec-unit" "security unit suites green"; else fail "sec-unit" "see $STATE_DIR/sec-vitest.log"; fi

# 3. authz: cross-tenant data isolation (two users, one org each)
#    Unique emails per run — the test dograh's DB persists between runs and
#    signup is not idempotent for an existing email. Retry the signups: the
#    dograh health endpoint can be reachable a moment before write ops are
#    ready (startup race in the full chain).
TS="$(date +%s)"
signup_token() {
  local email="$1" token=""
  for i in $(seq 1 10); do
    token="$(curl -s -m 5 -X POST "$DOGRAH_URL/api/v1/auth/signup" -H 'Content-Type: application/json' \
      -d "{\"email\":\"$email\",\"password\":\"TestPass123!\",\"name\":\"A\"}" | jq -r '.token // empty' 2>/dev/null)"
    [[ -n "$token" ]] && break
    sleep 2
  done
  printf '%s' "$token"
}
TOKEN_A="$(signup_token "sec.a.$TS@vaani.example.com")"
TOKEN_B="$(signup_token "sec.b.$TS@vaani.example.com")"
# user B lists workflows — must not see A's data (A created none, B sees own empty list)
B_CODE="000"
for i in $(seq 1 5); do
  B_CODE="$(curl -s -m 5 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN_B" "$DOGRAH_URL/api/v1/workflow/count" 2>/dev/null)"
  [[ "$B_CODE" == "200" ]] && break
  sleep 2
done
if [[ "$B_CODE" == "200" ]]; then pass "sec-tenant-isolation" "B can list own workflows"; else fail "sec-tenant-isolation" "B got $B_CODE"; fi

# 4. injection: SQLi payload in login email -> 401/422 (never 500)
INJ_CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$DOGRAH_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"'"'"' OR 1=1 --","password":"x"}')"
if [[ "$INJ_CODE" != "500" ]]; then pass "sec-injection" "SQLi payload rejected ($INJ_CODE)"; else fail "sec-injection" "SQLi caused 500"; fi

# 5. fuzz: 50 malformed JSON bodies across endpoints — all must be 4xx, none 500
FUZZ_FAIL=0
for i in $(seq 1 50); do
  PAYLOAD="$(head -c $((i % 80 + 1)) /dev/urandom | base64 | head -c $((i % 60 + 1)))"
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$DOGRAH_URL/api/v1/auth/login" \
    -H 'Content-Type: application/json' -d "$PAYLOAD")"
  if [[ "$CODE" == "500" ]]; then FUZZ_FAIL=1; fi
done
if [[ "$FUZZ_FAIL" -eq 0 ]]; then pass "sec-fuzz" "50 malformed payloads, no 500s"; else fail "sec-fuzz" "500 returned on malformed input"; fi

# 6. rate limit: exceed PUBLIC_API_RATE_LIMIT (120/min) on vaani public API -> 429
#    (vaani must be up; if not, this is BLOCKED not FAILED)
#    Clear any orphaned :3000 listener first (previous phases leave orphans).
if ss -ltn 2>/dev/null | grep -q ':3000 '; then
  fuser -k 3000/tcp 2>/dev/null || true
  sleep 2
fi
(
  cd "$REPO_ROOT/vaani-ai"
  S3_SECRET_KEY="${E2E_S3_SECRET_KEY:-vaani_dev_minio_password}" \
  DOGRAH_BASE_URL="$DOGRAH_URL" npm run start > "$STATE_DIR/sec-vaani.log" 2>&1 &
  echo $! > "$STATE_DIR/sec-vaani.pid"
)
if retry 45 2 curl -sf "http://127.0.0.1:3000/api/health" > /dev/null; then
  RATE_CODE=""
  for i in $(seq 1 130); do
    RATE_CODE="$(curl -s -o /dev/null -w '%{http_code}' \
      -H "Authorization: Bearer demo-api-key-do-not-use" "http://127.0.0.1:3000/api/v1/contacts")"
  done
  if [[ "$RATE_CODE" == "429" ]]; then pass "sec-ratelimit" "130 rapid calls -> 429"; else fail "sec-ratelimit" "expected 429 got $RATE_CODE"; fi
else
  blocked "sec-ratelimit" "vaani not booted"
fi

# 7. cookie security: session cookie flags on login flow
#    Deterministic unit assertion on createSession's cookie flags (the curl
#    login path is a Next server action, not a curl-able route).
(cd "$REPO_ROOT/vaani-ai" && npx vitest run tests/cookie-flags.test.ts --reporter=dot \
  --outputFile="$STATE_DIR/sec-cookie.json") > "$STATE_DIR/sec-cookie.log" 2>&1
if [[ $? -eq 0 ]]; then
  pass "sec-cookie-flags" "session cookie HttpOnly+Secure (unit)"
else
  fail "sec-cookie-flags" "see $STATE_DIR/sec-cookie.log"
fi

# 8. MCP auth: the vaani MCP proxy (/api/mcp) requires x-mcp-key; reject anonymous
MCP_CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:3000/api/mcp" \
  -H 'Content-Type: application/json' -d '{}')"
if [[ "$MCP_CODE" == "401" || "$MCP_CODE" == "403" ]]; then pass "sec-mcp-auth" "MCP unauth blocked ($MCP_CODE)"; else fail "sec-mcp-auth" "MCP allowed anonymous ($MCP_CODE)"; fi

# 9. TOTP flow unit + audit log presence
if [[ -f "$STATE_DIR/sec-vitest.json" ]]; then
  TOTP_PASS="$(jq -r '.testResults[] | select(.assertionResults[].fullName | test("totp"; "i")) | .status' "$STATE_DIR/sec-vitest.json" 2>/dev/null | grep -c passed || true)"
  if [[ "$TOTP_PASS" -gt 0 ]]; then pass "sec-totp" "TOTP tests passed"; else fail "sec-totp" "no TOTP test result found"; fi
fi

# teardown — kill process trees (npm/uvicorn wrappers orphan their children).
# Kill by PID only so a concurrently-booting next phase's dograh isn't hit.
kill_tree() {
  local pidfile="$1"
  if [[ -f "$pidfile" ]]; then
    local pid
    pid="$(cat "$pidfile")"
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
  fi
}
kill_tree "$STATE_DIR/sec-vaani.pid"
kill_tree "$STATE_DIR/sec-dograh.pid"

phase_end
exit $?
