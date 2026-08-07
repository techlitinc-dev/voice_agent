#!/usr/bin/env bash
# =============================================================================
# PHASE 3 — END-TO-END / WORKFLOW TESTS (Playwright, real browser)
# Full user journeys: auth -> workspace -> agent -> campaign -> call -> analytics.
# Requires the vaani-ai app on :3000 (Phase 2 leaves it down; start fresh here).
# Playwright runs serially (workers=1) because specs share one demo DB.
# =============================================================================
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# lib.sh does not define log(); the orchestrator does. Provide a local fallback
# so this script also works standalone (--phase 3).
command -v log >/dev/null 2>&1 || log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

phase_begin "3-e2e"

# 1. boot the app (prod build) — reuse health wait
# Overrides for the dev QA stack (prod .env values differ):
#   - S3_SECRET_KEY must match the dev MinIO root password (vaani-minio-dev)
#   - DOGRAH_BASE_URL must point at a TEST dograh. The prod .env uses
#     host.docker.internal (Docker-Desktop-only); the QA suite boots its own
#     dograh on DOGRAH_QA_PORT (default 8100) against test_db.
DOGRAH_QA_PORT="${DOGRAH_QA_PORT:-8100}"
DOGRAH_BASE_URL="${E2E_DOGRAH_BASE_URL:-http://127.0.0.1:$DOGRAH_QA_PORT}"

# 1a. Boot the test dograh (the QA chain tears down each phase's dograh, so
#     phase 3 starts its own). The app's agent publish targets this instance.
(
  cd "$REPO_ROOT/dograh"
  .venv/bin/python -m uvicorn api.app:app --host 127.0.0.1 --port "$DOGRAH_QA_PORT" \
    --env-file api/.env.test > "$STATE_DIR/vaani-dograh.log" 2>&1 &
  echo $! > "$STATE_DIR/vaani-dograh.pid"
)
if ! retry 30 1 curl -sf "$DOGRAH_BASE_URL/api/v1/health" > /dev/null; then
  blocked "e2e-dograh-boot" "test dograh did not boot — see $STATE_DIR/vaani-dograh.log"
  phase_end; exit 2
fi
pass "e2e-dograh-boot" "test dograh reachable on :$DOGRAH_QA_PORT"

# The app authenticates to dograh with vaani-ai/.env DOGRAH_API_KEY. Register
# that key in the test dograh (idempotent) so agent publish works in E2E.
(cd "$REPO_ROOT/dograh" && .venv/bin/python "$QA_DIR/scripts/dograh-key-bootstrap.py" \
  >> "$STATE_DIR/dograh-key-bootstrap.log" 2>&1)

(
  cd "$REPO_ROOT/vaani-ai"
  S3_SECRET_KEY="${E2E_S3_SECRET_KEY:-vaani_dev_minio_password}" \
  DOGRAH_BASE_URL="$DOGRAH_BASE_URL" \
  npm run start > "$STATE_DIR/vaani-e2e.log" 2>&1 &
  echo $! > "$STATE_DIR/vaani-e2e.pid"
)
if ! retry 45 2 curl -sf "http://127.0.0.1:3000/api/health" > /dev/null; then
  blocked "e2e-boot" "app did not boot — see $STATE_DIR/vaani-e2e.log"
  phase_end; exit 2
fi
pass "e2e-boot" "app reachable on :3000"

# 1b. Boot the dev worker (BullMQ against the same dev DB/Redis) so campaign
#     dials and GDPR exports actually process during the Playwright run.
(
  cd "$REPO_ROOT/vaani-ai"
  S3_SECRET_KEY="${E2E_S3_SECRET_KEY:-vaani_dev_minio_password}" \
  CAMPAIGN_DRY_RUN=true \
  npx tsx src/worker/index.ts > "$STATE_DIR/vaani-worker.log" 2>&1 &
  echo $! > "$STATE_DIR/vaani-worker.pid"
)
sleep 3
if kill -0 "$(cat "$STATE_DIR/vaani-worker.pid")" 2>/dev/null; then
  pass "e2e-worker-boot" "dev worker running for campaign/GDPR flows"
else
  fail "e2e-worker-boot" "dev worker exited — see $STATE_DIR/vaani-worker.log"
fi

# 1c. Reset the demo workspace's E2E residue: keep exactly ONE demo agent (the
#     seed's "Front Desk — Priya") and archive the rest, so specs like
#     agent-lifecycle can create from a template without hitting the quota.
docker exec vaani-db-dev psql -U vaani -d vaani -q \
  -c "UPDATE \"Agent\" SET status='ARCHIVED' WHERE \"workspaceId\"=(SELECT id FROM \"Workspace\" WHERE slug='demo-clinic') AND status != 'ARCHIVED' AND id NOT IN (SELECT id FROM \"Agent\" WHERE \"workspaceId\"=(SELECT id FROM \"Workspace\" WHERE slug='demo-clinic') ORDER BY \"createdAt\" LIMIT 1);" 2>/dev/null
# The campaign form only offers PUBLISHED agents — publish the kept demo agent.
docker exec vaani-db-dev psql -U vaani -d vaani -q \
  -c "UPDATE \"Agent\" SET status='PUBLISHED' WHERE \"workspaceId\"=(SELECT id FROM \"Workspace\" WHERE slug='demo-clinic') AND status != 'ARCHIVED';" 2>/dev/null
docker exec vaani-db-dev psql -U vaani -d vaani -q \
  -c "DELETE FROM \"WebhookDelivery\" WHERE \"subscriptionId\" IN (SELECT id FROM \"WebhookSubscription\" WHERE url='http://localhost:4777/hook'); DELETE FROM \"WebhookSubscription\" WHERE url='http://localhost:4777/hook';" 2>/dev/null
log "demo workspace reset (1 published agent, webhook subs cleared)"

# 2. run playwright specs (auth session cached in e2e/.auth via helpers.ts)
(
  cd "$REPO_ROOT/vaani-ai"
  E2E_BASE_URL="http://127.0.0.1:3000" \
  E2E_DB_CONTAINER="${E2E_DB_CONTAINER:-vaani-db-dev}" \
  npx playwright test --config=e2e/playwright.config.ts \
    --reporter=json --output="$STATE_DIR/playwright-out" > "$STATE_DIR/playwright.log" 2>&1
)
E2E_RC=$?

if [[ $E2E_RC -eq 0 ]]; then
  pass "playwright-suite" "all E2E specs green"
else
  # flaky-retry once, same specs, no re-render
  (
    cd "$REPO_ROOT/vaani-ai"
    E2E_BASE_URL="http://127.0.0.1:3000" \
    E2E_DB_CONTAINER="${E2E_DB_CONTAINER:-vaani-db-dev}" \
    npx playwright test --config=e2e/playwright.config.ts \
      --reporter=json --output="$STATE_DIR/playwright-out-retry" > "$STATE_DIR/playwright-retry.log" 2>&1
  )
  if [[ $? -eq 0 ]]; then
    pass "playwright-retry" "flaky on first run, green on retry"
  else
    fail "playwright-suite" "E2E failed — see $STATE_DIR/playwright.log"
  fi
fi

# 3. teardown — kill process trees so next-server/worker children don't orphan
#    and hold :3000 for the next phase (EADDRINUSE in later runs). Kill by PID
#    only (no broad pkill patterns) so a concurrent next phase isn't hit.
kill_tree() {
  local pidfile="$1"
  if [[ -f "$pidfile" ]]; then
    local pid
    pid="$(cat "$pidfile")"
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
  fi
}
kill_tree "$STATE_DIR/vaani-e2e.pid"
kill_tree "$STATE_DIR/vaani-worker.pid"
kill_tree "$STATE_DIR/vaani-dograh.pid"
# Orphaned next-server children (PPID=1) survive npm-wrapper kills; free :3000
# so the next phase can boot its own app.
if ss -ltn 2>/dev/null | grep -q ':3000 '; then
  fuser -k 3000/tcp 2>/dev/null || true
  sleep 1
fi

phase_end
exit $?
