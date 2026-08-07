#!/usr/bin/env bash
# =============================================================================
# PHASE 2 — INTEGRATION TESTS (module-to-module, real interfaces)
# Real (unmocked) Postgres/Redis/MinIO + real HTTP between vaani-ai and dograh.
# Verifies data contracts, serialization, event flow, error propagation.
# =============================================================================
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

phase_begin "2-integration"

# Test dograh listens on DOGRAH_QA_PORT (default 8100) so a production dograh
# on :8000 doesn't conflict. The vaani app below points at the same port.
DOGRAH_QA_PORT="${DOGRAH_QA_PORT:-8100}"

# 1. Start dograh API against real postgres/redis/minio (test_db)
(
  cd "$REPO_ROOT/dograh"
  .venv/bin/python -m uvicorn api.app:app --host 127.0.0.1 --port "$DOGRAH_QA_PORT" \
    --env-file api/.env.test > "$STATE_DIR/dograh-server.log" 2>&1 &
  echo $! > "$STATE_DIR/dograh-server.pid"
)
DOGRAH_HEALTH_JSON=""
for i in $(seq 1 30); do
  DOGRAH_HEALTH_JSON="$(curl -s -m 3 "http://127.0.0.1:$DOGRAH_QA_PORT/api/v1/health" 2>/dev/null)" || true
  if printf '%s' "$DOGRAH_HEALTH_JSON" | jq -e '.status' >/dev/null 2>&1; then break; fi
  sleep 1
done
if printf '%s' "$DOGRAH_HEALTH_JSON" | jq -e '.status' >/dev/null 2>&1; then
  printf '%s' "$DOGRAH_HEALTH_JSON" > "$STATE_DIR/health-dograh.json"
  pass "dograh-boot" "GET /api/v1/health reachable"
else
  blocked "dograh-boot" "dograh API failed to boot — see $STATE_DIR/dograh-server.log"
  phase_end; exit 2
fi
expect_json "dograh-health" "health.status == ok" "$DOGRAH_HEALTH_JSON" ".status" "ok"

# 1b. Register the vaani app's DOGRAH_API_KEY in the test dograh so the app's
#     X-API-Key auth works against it (idempotent).
if (cd "$REPO_ROOT/dograh" && .venv/bin/python "$QA_DIR/scripts/dograh-key-bootstrap.py" \
    >> "$STATE_DIR/dograh-key-bootstrap.log" 2>&1); then
  pass "dograh-key-bootstrap" "vaani API key registered in test dograh"
else
  fail "dograh-key-bootstrap" "see $STATE_DIR/dograh-key-bootstrap.log"
fi

# 2. Start vaani-ai on :3000 (needs DOGRAH_BASE_URL -> localhost:$DOGRAH_QA_PORT,
#    and the dev MinIO secret so the health check's s3.listBuckets() succeeds)
(
  cd "$REPO_ROOT/vaani-ai"
  S3_SECRET_KEY="${E2E_S3_SECRET_KEY:-vaani_dev_minio_password}" \
  DOGRAH_BASE_URL="http://127.0.0.1:$DOGRAH_QA_PORT" npm run start > "$STATE_DIR/vaani-server.log" 2>&1 &
  echo $! > "$STATE_DIR/vaani-server.pid"
)
HEALTH_JSON=""
for i in $(seq 1 45); do
  HEALTH_JSON="$(curl -s -m 3 "http://127.0.0.1:3000/api/health" 2>/dev/null)" || true
  if printf '%s' "$HEALTH_JSON" | jq -e '.status' >/dev/null 2>&1; then break; fi
  sleep 2
done
if printf '%s' "$HEALTH_JSON" | jq -e '.status' >/dev/null 2>&1; then
  printf '%s' "$HEALTH_JSON" > "$STATE_DIR/health-vaani.json"
  pass "vaani-boot" "GET /api/health reachable"
else
  blocked "vaani-boot" "vaani failed to boot — see $STATE_DIR/vaani-server.log"
  phase_end; exit 2
fi
expect_json "vaani-health" "health.status ok" "$HEALTH_JSON" ".status" "ok"
expect_json "vaani-health-dograh" "dograh check ok" "$HEALTH_JSON" ".checks.dograh" "true"

# 3. Cross-service contract: vaani -> dograh create user + agent
#    Uses the same-origin proxy route pattern the browser uses.
DOGRAH_URL="http://127.0.0.1:$DOGRAH_QA_PORT"
ADMIN_TOKEN="test-admin-token"
ORG_ID=""
RESP="$(curl -s -X POST "$DOGRAH_URL/api/v1/auth/signup" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"integ.$(date +%s)@vaani.example.com\",\"password\":\"TestPass123!\",\"name\":\"Integ Tester\"}")"
TOKEN="$(printf '%s' "$RESP" | jq -r '.token // empty' 2>/dev/null)"
if [[ -n "$TOKEN" ]]; then
  pass "dograh-signup" "POST /api/v1/auth/signup issued token"
else
  fail "dograh-signup" "signup failed: $RESP"
fi

# 4. Auth guard: protected route without token -> 401
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$DOGRAH_URL/api/v1/workflow/count")"
assert_status "dograh-authz" "workflow count without token -> 401" "401" "$CODE"

# 5. Create a workflow (agent) with the token — validates serialization contract
WF="$(curl -s -X POST "$DOGRAH_URL/api/v1/workflow/create/definition" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Integ Test Agent","workflow_definition":{"nodes":[]}}')"
WF_ID="$(printf '%s' "$WF" | jq -r '.id // empty' 2>/dev/null)"
if [[ -n "$WF_ID" ]]; then
  pass "dograh-workflow-create" "workflow created id=$WF_ID"
else
  fail "dograh-workflow-create" "workflow create failed: $WF"
fi

# 6. dograh SDK healthcheck from vaani-ai lib (real HTTP, mocked key)
(cd "$REPO_ROOT/vaani-ai" && DOGRAH_BASE_URL="$DOGRAH_URL" \
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
# kill_tree <pidfile> — kills the recorded pid AND its children (npm start/tsx
# wrappers orphan their node children). For uvicorn, kill the exact PID only:
# a broad pkill -f "uvicorn.*PORT" can kill the NEXT phase's dograh if it boots
# during the teardown window.
kill_tree() {
  local pidfile="$1"
  if [[ -f "$pidfile" ]]; then
    local pid
    pid="$(cat "$pidfile")"
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
  fi
}
if [[ -f "$STATE_DIR/vaani-server.pid" ]]; then
  kill_tree "$STATE_DIR/vaani-server.pid"
fi
if [[ -f "$STATE_DIR/dograh-server.pid" ]]; then
  kill_tree "$STATE_DIR/dograh-server.pid"
fi
sleep 1

phase_end
exit $?
