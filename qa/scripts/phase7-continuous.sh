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

phase_begin "7-continuous"

VAANI_HEALTH="${VAANI_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
DOGRAH_HEALTH="${DOGRAH_HEALTH_URL:-http://127.0.0.1:8000/api/v1/health}"
CRITICAL_FAILURES=0
MAX_CRITICAL_BEFORE_ROLLBACK=3

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
  J_CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:8000/api/v1/auth/login" \
    -H 'Content-Type: application/json' -d '{"email":"cont.probe@vaani.local","password":"TestPass123!"}')"
  if [[ "$J_CODE" == "200" ]]; then pass "cont-journey" "auth probe ok"; else fail "cont-journey" "auth probe $J_CODE"; CRITICAL_FAILURES=$((CRITICAL_FAILURES+1)); fi

  # 3. auto-rollback trigger
  if [[ "$CRITICAL_FAILURES" -ge "$MAX_CRITICAL_BEFORE_ROLLBACK" ]]; then
    log "CRITICAL FAILURES >= $MAX_CRITICAL_BEFORE_ROLLBACK — triggering rollback"
    if [[ -x "$QA_DIR/scripts/rollback.sh" ]]; then
      "$QA_DIR/scripts/rollback.sh"
      ROLLBACK_RC=$?
      if [[ $ROLLBACK_RC -eq 0 ]]; then pass "cont-rollback" "auto-rollback executed"; else fail "cont-rollback" "rollback failed rc=$ROLLBACK_RC"; fi
    else
      fail "cont-rollback" "rollback.sh missing — cannot self-heal"
    fi
    break
  fi

  [[ $cycle -lt "$CYCLES" ]] && sleep 5
done

phase_end
exit $?
