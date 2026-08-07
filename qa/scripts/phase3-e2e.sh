#!/usr/bin/env bash
# =============================================================================
# PHASE 3 — END-TO-END / WORKFLOW TESTS (Playwright, real browser)
# Full user journeys: auth -> workspace -> agent -> campaign -> call -> analytics.
# Requires the vaani-ai app on :3000 (Phase 2 leaves it down; start fresh here).
# Playwright runs serially (workers=1) because specs share one demo DB.
# =============================================================================
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

phase_begin "3-e2e"

# 1. boot the app (prod build) — reuse health wait
# Overrides for the dev QA stack (prod .env values differ):
#   - S3_SECRET_KEY must match the dev MinIO root password (vaani-minio-dev)
#   - DOGRAH_BASE_URL must point at a TEST dograh. The prod .env uses
#     host.docker.internal (Docker-Desktop-only); localhost:8000 is the prod
#     dograh on this host. Point E2E_DOGRAH_BASE_URL at a test instance, or the
#     publish/onboarding specs fail (by design) without touching prod.
(
  cd "$REPO_ROOT/vaani-ai"
  S3_SECRET_KEY="${E2E_S3_SECRET_KEY:-vaani_dev_minio_password}" \
  DOGRAH_BASE_URL="${E2E_DOGRAH_BASE_URL:-http://127.0.0.1:7999}" \
  npm run start > "$STATE_DIR/vaani-e2e.log" 2>&1 &
  echo $! > "$STATE_DIR/vaani-e2e.pid"
)
if ! retry 45 2 curl -sf "http://127.0.0.1:3000/api/health" > /dev/null; then
  blocked "e2e-boot" "app did not boot — see $STATE_DIR/vaani-e2e.log"
  phase_end; exit 2
fi
pass "e2e-boot" "app reachable on :3000"

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

# 3. teardown
if [[ -f "$STATE_DIR/vaani-e2e.pid" ]]; then kill "$(cat "$STATE_DIR/vaani-e2e.pid")" 2>/dev/null || true; fi

phase_end
exit $?
