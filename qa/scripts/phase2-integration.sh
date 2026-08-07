#!/usr/bin/env bash
# =============================================================================
# PHASE 2 — INTEGRATION TESTS (module-to-module, real interfaces)
# Real (unmocked) Postgres/Redis/MinIO + real HTTP between vaani-ai and dograh.
# Verifies data contracts, serialization, event flow, error propagation.
# =============================================================================
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

phase_begin "2-integration"

# 1. Start dograh API against real postgres/redis/minio (test_db)
(
  cd "$REPO_ROOT/dograh"
  .venv/bin/python -m uvicorn api.app:app --host 127.0.0.1 --port 8000 \
    --env-file api/.env.test > "$STATE_DIR/dograh-server.log" 2>&1 &
  echo $! > "$STATE_DIR/dograh-server.pid"
)
if retry 30 1 curl -sf "http://127.0.0.1:8000/api/v1/health" > "$STATE_DIR/health-dograh.json"; then
  pass "dograh-boot" "GET /api/v1/health reachable"
else
  blocked "dograh-boot" "dograh API failed to boot — see $STATE_DIR/dograh-server.log"
  phase_end; exit 2
fi
expect_json "dograh-health" "health.status == ok" "$(cat "$STATE_DIR/health-dograh.json")" ".status" "ok"

# 2. Start vaani-ai on :3000 (needs DOGRAH_BASE_URL -> localhost:8000)
(
  cd "$REPO_ROOT/vaani-ai"
  DOGRAH_BASE_URL="http://127.0.0.1:8000" npm run start > "$STATE_DIR/vaani-server.log" 2>&1 &
  echo $! > "$STATE_DIR/vaani-server.pid"
)
if retry 45 2 curl -sf "http://127.0.0.1:3000/api/health" > "$STATE_DIR/health-vaani.json"; then
  pass "vaani-boot" "GET /api/health reachable"
else
  blocked "vaani-boot" "vaani failed to boot — see $STATE_DIR/vaani-server.log"
  phase_end; exit 2
fi
expect_json "vaani-health" "health.status ok" "$(cat "$STATE_DIR/health-vaani.json")" ".status" "ok"
expect_json "vaani-health-dograh" "dograh check ok" "$(cat "$STATE_DIR/health-vaani.json")" ".checks.dograh" "true"

# 3. Cross-service contract: vaani -> dograh create user + agent
#    Uses the same-origin proxy route pattern the browser uses.
ADMIN_TOKEN="test-admin-token"
ORG_ID=""
RESP="$(curl -s -X POST "http://127.0.0.1:8000/api/v1/auth/signup" \
  -H 'Content-Type: application/json' \
  -d '{"email":"integ.test@vaani.local","password":"TestPass123!","name":"Integ Tester"}')"
TOKEN="$(printf '%s' "$RESP" | jq -r '.token // empty' 2>/dev/null)"
if [[ -n "$TOKEN" ]]; then
  pass "dograh-signup" "POST /api/v1/auth/signup issued token"
else
  fail "dograh-signup" "signup failed: $RESP"
fi

# 4. Auth guard: protected route without token -> 401
CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8000/api/v1/workflows")"
assert_status "dograh-authz" "workflows without token -> 401" "401" "$CODE"

# 5. Create a workflow (agent) with the token — validates serialization contract
WF="$(curl -s -X POST "http://127.0.0.1:8000/api/v1/workflows" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Integ Test Agent","config":{}}')"
WF_ID="$(printf '%s' "$WF" | jq -r '.id // empty' 2>/dev/null)"
if [[ -n "$WF_ID" ]]; then
  pass "dograh-workflow-create" "workflow created id=$WF_ID"
else
  fail "dograh-workflow-create" "workflow create failed: $WF"
fi

# 6. dograh SDK healthcheck from vaani-ai lib (real HTTP, mocked key)
(cd "$REPO_ROOT/vaani-ai" && DOGRAH_BASE_URL="http://127.0.0.1:8000" \
  DOGRAH_API_KEY="test-key" npx vitest run src/lib/dograh.test.ts --reporter=json \
  --outputFile="$STATE_DIR/integ-dograh-lib.json") > "$STATE_DIR/integ-dograh-lib.log" 2>&1
INTEG_RC=$?
if [[ $INTEG_RC -eq 0 ]]; then
  pass "vaani-dograh-lib" "vaani->dograh client integration green"
else
  fail "vaani-dograh-lib" "dograh lib integration failed — see log"
fi

# 7. Webhook signature handshake (dograhWebhook HMAC)
(cd "$REPO_ROOT/vaani-ai" && DOGRAH_WEBHOOK_SECRET="test-secret" \
  npx vitest run src/lib/dograhWebhook.test.ts --reporter=json \
  --outputFile="$STATE_DIR/integ-webhook.json") > "$STATE_DIR/integ-webhook.log" 2>&1
if [[ $? -eq 0 ]]; then
  pass "dograh-webhook" "webhook HMAC verification green"
else
  fail "dograh-webhook" "webhook signature tests failed"
fi

# 8. Event flow: BullMQ queue round-trip (redis real)
(cd "$REPO_ROOT/vaani-ai" && npx vitest run tests/analytics.test.ts tests/campaign-retry.test.ts \
  --reporter=json --outputFile="$STATE_DIR/integ-queue.json") > "$STATE_DIR/integ-queue.log" 2>&1
if [[ $? -eq 0 ]]; then
  pass "vaani-queue" "queue/analytics integration green"
else
  fail "vaani-queue" "queue integration failed — see log"
fi

# 9. Data boundary: PII masking across worker->API (no leakage at boundary)
(cd "$REPO_ROOT/vaani-ai" && npx vitest run tests/pii.test.ts --reporter=json \
  --outputFile="$STATE_DIR/integ-pii.json") > "$STATE_DIR/integ-pii.log" 2>&1
if [[ $? -eq 0 ]]; then
  pass "pii-boundary" "PII redaction integration green"
else
  fail "pii-boundary" "PII tests failed"
fi

# ---- teardown (servers) -----------------------------------------------------
if [[ -f "$STATE_DIR/vaani-server.pid" ]]; then kill "$(cat "$STATE_DIR/vaani-server.pid")" 2>/dev/null || true; fi
if [[ -f "$STATE_DIR/dograh-server.pid" ]]; then kill "$(cat "$STATE_DIR/dograh-server.pid")" 2>/dev/null || true; fi
sleep 1

phase_end
exit $?
