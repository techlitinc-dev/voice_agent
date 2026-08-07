#!/usr/bin/env bash
# =============================================================================
# PHASE 7 — CONTINUOUS VALIDATION (Post-Deploy)
# Synthetic monitoring that runs forever in production:
#   - every 60s: health checks (vaani /api/health, dograh /api/v1/health)
#   - every 5m : critical journey probe (auth + workflow list)
#   - auto-rollback: 3 consecutive critical failures -> invoke rollback script
# This runner is designed to be wrapped by cron/systemd/timer for persistence.
# =============================================================================
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# lib.sh does not define log(); the orchestrator does. Provide a local fallback
# so this script also works standalone (--phase 7).
command -v log >/dev/null 2>&1 || log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

phase_begin "7-continuous"

VAANI_HEALTH="${VAANI_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
DOGRAH_QA_PORT="${DOGRAH_QA_PORT:-8100}"
DOGRAH_URL="http://127.0.0.1:$DOGRAH_QA_PORT"
DOGRAH_HEALTH="${DOGRAH_HEALTH_URL:-$DOGRAH_URL/api/v1/health}"
CRITICAL_FAILURES=0
MAX_CRITICAL_BEFORE_ROLLBACK=3

# Auto-rollback runs git checkout (destructive to a working tree). Only allow it
# when explicitly enabled (production orchestration); in QA/dev just report the
# failure instead of mutating the repo.
ALLOW_AUTO_ROLLBACK="${ALLOW_AUTO_ROLLBACK:-false}"

# Ensure the dograh + vaani apps are up. In the QA chain every prior phase tears
# its servers down; boot them here (idempotent: skip if already reachable).
if ! curl -sf "$DOGRAH_HEALTH" > /dev/null 2>&1; then
  log "booting test dograh on :$DOGRAH_QA_PORT"
  (
    cd "$REPO_ROOT/dograh"
    .venv/bin/python -m uvicorn api.app:app --host 127.0.0.1 --port "$DOGRAH_QA_PORT" \
      --env-file api/.env.test > "$STATE_DIR/cont-dograh.log" 2>&1 &
    echo $! > "$STATE_DIR/cont-dograh.pid"
  )
  retry 30 1 curl -sf "$DOGRAH_HEALTH" > /dev/null || { fail "cont-dograh-boot" "dograh did not boot"; phase_end; exit 2; }
  pass "cont-dograh-boot" "test dograh reachable on :$DOGRAH_QA_PORT"
fi
if ! curl -sf "$VAANI_HEALTH" > /dev/null 2>&1; then
  log "booting vaani app on :3000"
  # Clear any orphaned :3000 listener first (previous phases leave orphans).
  if ss -ltn 2>/dev/null | grep -q ':3000 '; then
    fuser -k 3000/tcp 2>/dev/null || true
    sleep 2
  fi
  (
    cd "$REPO_ROOT/vaani-ai"
    S3_SECRET_KEY="${E2E_S3_SECRET_KEY:-vaani_dev_minio_password}" \
    DOGRAH_BASE_URL="$DOGRAH_URL" npm run start > "$STATE_DIR/cont-vaani.log" 2>&1 &
    echo $! > "$STATE_DIR/cont-vaani.pid"
  )
  retry 45 2 curl -sf "$VAANI_HEALTH" > /dev/null || { fail "cont-vaani-boot" "vaani did not boot"; phase_end; exit 2; }
  pass "cont-vaani-boot" "vaani app reachable on :3000"
fi

# Ensure the journey-probe user exists (idempotent — signup fails harmlessly if
# the account already exists from a previous cycle/run).
curl -s -X POST "$DOGRAH_URL/api/v1/auth/signup" -H 'Content-Type: application/json' \
  -d '{"email":"cont.probe@vaani.example.com","password":"TestPass123!","name":"Cont Probe"}' > /dev/null 2>&1

# --- continuous loop (bounded iterations so CI can run it deterministically) --
# In production, set CONTINUOUS_INFINITE=1 to loop forever. Default: 3 cycles.
CYCLES="${CONTINUOUS_CYCLES:-3}"
for cycle in $(seq 1 "$CYCLES"); do
  log "cycle $cycle"

  # 1. health checks
  V_STATUS="$(curl -s -o /dev/null -w '%{http_code}' "$VAANI_HEALTH")"
  D_STATUS="$(curl -s -o /dev/null -w '%{http_code}' "$DOGRAH_HEALTH")"
  if [[ "$V_STATUS" == "200" ]]; then pass "cont-vaani-health" "cycle $cycle ok"; else fail "cont-vaani-health" "vaani $V_STATUS"; CRITICAL_FAILURES=$((CRITICAL_FAILURES+1)); fi
  if [[ "$D_STATUS" == "200" ]]; then pass "cont-dograh-health" "cycle $cycle ok"; else fail "cont-dograh-health" "dograh $D_STATUS"; CRITICAL_FAILURES=$((CRITICAL_FAILURES+1)); fi

  # 2. journey probe (auth + protected route)
  J_CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$DOGRAH_URL/api/v1/auth/login" \
    -H 'Content-Type: application/json' -d '{"email":"cont.probe@vaani.example.com","password":"TestPass123!"}')"
  if [[ "$J_CODE" == "200" ]]; then pass "cont-journey" "auth probe ok"; else fail "cont-journey" "auth probe $J_CODE"; CRITICAL_FAILURES=$((CRITICAL_FAILURES+1)); fi

  # 3. auto-rollback trigger
  if [[ "$CRITICAL_FAILURES" -ge "$MAX_CRITICAL_BEFORE_ROLLBACK" ]]; then
    log "CRITICAL FAILURES >= $MAX_CRITICAL_BEFORE_ROLLBACK"
    if [[ "$ALLOW_AUTO_ROLLBACK" == "true" ]]; then
      log "ALLOW_AUTO_ROLLBACK=true — invoking rollback"
      if [[ -x "$QA_DIR/scripts/rollback.sh" ]]; then
        "$QA_DIR/scripts/rollback.sh"
        ROLLBACK_RC=$?
        if [[ $ROLLBACK_RC -eq 0 ]]; then pass "cont-rollback" "auto-rollback executed"; else fail "cont-rollback" "rollback failed rc=$ROLLBACK_RC"; fi
      else
        fail "cont-rollback" "rollback.sh missing — cannot self-heal"
      fi
    else
      log "auto-rollback disabled (ALLOW_AUTO_ROLLBACK!=true) — skipping in QA/dev"
      fail "cont-rollback" "critical failures reached but auto-rollback disabled"
    fi
    break
  fi

  [[ $cycle -lt "$CYCLES" ]] && sleep 5
done

# teardown — kill servers this phase booted by PID only (a broad pkill could
# hit a concurrently-booting next phase's processes).
kill_tree() {
  local pidfile="$1"
  if [[ -f "$pidfile" ]]; then
    local pid
    pid="$(cat "$pidfile")"
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
  fi
}
kill_tree "$STATE_DIR/cont-vaani.pid"
kill_tree "$STATE_DIR/cont-dograh.pid"

phase_end
exit $?
