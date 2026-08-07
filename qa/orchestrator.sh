#!/usr/bin/env bash
# =============================================================================
# Voice Agent Monorepo — Master Test Orchestrator (ZERO-HUMAN-INTERVENTION)
# =============================================================================
# Usage:
#   ./qa/orchestrator.sh [--phase N] [--skip-setup] [--continue-on-fail] [--json-only]
#
# Exit codes:
#   0  GO   — all phases passed (or explicit continue-on-fail with NO-GO reported)
#   1  NO-GO — at least one phase failed
#   2  ERROR — environment/setup failure (pre-flight not satisfied)
#
# This script is the SINGLE COMMAND entry point. It drives the full chain:
#   Phase 1 Unit -> Phase 2 Integration -> Phase 3 E2E -> Phase 4 Perf
#   -> Phase 5 Security -> Phase 6 Production Smoke -> Phase 7 Continuous.
# Each phase writes its JSON summary to qa/state/phase-<N>.json; the phase
# summaries and the final go/no-go are written to qa/state/report.json.
# =============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QA_DIR="$REPO_ROOT/qa"
STATE_DIR="$QA_DIR/state"
mkdir -p "$STATE_DIR"

PHASE_FILTER=""
CONTINUE_ON_FAIL=false
JSON_ONLY=false
RUN_SETUP=true

# ------------------------------------------------------------------ arg parse
while [[ $# -gt 0 ]]; do
  case "$1" in
    --phase)        PHASE_FILTER="$2"; shift 2 ;;
    --skip-setup)   RUN_SETUP=false; shift ;;
    --continue-on-fail) CONTINUE_ON_FAIL=true; shift ;;
    --json-only)    JSON_ONLY=true; shift ;;
    *) echo "Unknown arg: $1"; exit 2 ;;
  esac
done

FAILED_PHASES=()
declare -A PHASE_SUMMARY
OVERALL_START_MS=$(date +%s%3N)

# ------------------------------------------------------------------ logging
log()  { printf '\n[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
json() { printf '%s\n' "$*" >&2; }

# ------------------------------------------------------------------ helpers
phase_enabled() {
  [[ -z "$PHASE_FILTER" ]] && return 0
  [[ "$PHASE_FILTER" == "$1" ]] && return 0
  return 1
}

# write_phase_json <phase> <tests_run> <passed> <failed> <blocked> <total_ms> <go_no_go>
write_phase_json() {
  local phase="$1" run="$2" passed="$3" failed="$4" blocked="$5" ms="$6" gng="$7"
  cat > "$STATE_DIR/phase-$phase.json" <<JSON
{
  "phase": "$phase",
  "tests_run": $run,
  "passed": $passed,
  "failed": $failed,
  "blocked": $blocked,
  "total_time_ms": $ms,
  "go_no_go": "$gng"
}
JSON
  PHASE_SUMMARY["$phase"]="$gng"
  [[ "$gng" == "NO-GO" ]] && FAILED_PHASES+=("$phase")
}

# run_phase <phase> <command...> — runs a phase body; catches hard env errors (exit 2).
run_phase() {
  local phase="$1"; shift
  local start_ms end_ms rc
  start_ms=$(date +%s%3N)
  log "=== PHASE $phase START ==="
  "$@"
  rc=$?
  end_ms=$(date +%s%3N)
  if [[ $rc -eq 2 ]]; then
    write_phase_json "$phase" 0 0 0 1 $((end_ms - start_ms)) "NO-GO"
    log "=== PHASE $phase BLOCKED (environment error) ==="
  elif [[ $rc -ne 0 ]]; then
    # phase runner already wrote its JSON via lib.sh phase_end; record verdict
    FAILED_PHASES+=("$phase")
    log "=== PHASE $phase FAILED (rc=$rc) ==="
  fi
  log "=== PHASE $phase DONE (rc=$rc, $((end_ms - start_ms))ms) ==="
  return $rc
}

# ------------------------------------------------------------------ setup
if [[ "$RUN_SETUP" == true ]]; then
  log "--- PRE-FLIGHT / SETUP ---"
  "$QA_DIR/scripts/setup-env.sh" || { echo "SETUP_FAILED"; exit 2; }
  log "--- PRE-FLIGHT: environment clean ---"
  "$QA_DIR/scripts/verify-clean.sh" || { echo "CLEAN_CHECK_FAILED"; exit 2; }
fi

# =============================================================================
# PHASE 1 — UNIT / MODULE ISOLATION (vaani-ai vitest + dograh pytest)
# =============================================================================
if phase_enabled "1"; then
  run_phase "1" "$QA_DIR/scripts/phase1-unit.sh"
  rc=$?
  [[ $rc -eq 0 ]] || { [[ "$CONTINUE_ON_FAIL" == true ]] || exit $rc; }
fi

# =============================================================================
# PHASE 2 — INTEGRATION (service-to-service contracts, real interfaces)
# =============================================================================
if phase_enabled "2"; then
  run_phase "2" "$QA_DIR/scripts/phase2-integration.sh"
  rc=$?
  [[ $rc -eq 0 ]] || { [[ "$CONTINUE_ON_FAIL" == true ]] || exit $rc; }
fi

# =============================================================================
# PHASE 3 — END-TO-END / WORKFLOW (Playwright browser journeys)
# =============================================================================
if phase_enabled "3"; then
  run_phase "3" "$QA_DIR/scripts/phase3-e2e.sh"
  rc=$?
  [[ $rc -eq 0 ]] || { [[ "$CONTINUE_ON_FAIL" == true ]] || exit $rc; }
fi

# =============================================================================
# PHASE 4 — PERFORMANCE & LOAD (latency, throughput, concurrency thresholds)
# =============================================================================
if phase_enabled "4"; then
  run_phase "4" "$QA_DIR/scripts/phase4-perf.sh"
  rc=$?
  [[ $rc -eq 0 ]] || { [[ "$CONTINUE_ON_FAIL" == true ]] || exit $rc; }
fi

# =============================================================================
# PHASE 5 — SECURITY & COMPLIANCE (authz, PII, injection, fuzz, rate limits)
# =============================================================================
if phase_enabled "5"; then
  run_phase "5" "$QA_DIR/scripts/phase5-security.sh"
  rc=$?
  [[ $rc -eq 0 ]] || { [[ "$CONTINUE_ON_FAIL" == true ]] || exit $rc; }
fi

# =============================================================================
# PHASE 6 — PRODUCTION READINESS / SMOKE (prod-like env, health, rollback trig.)
# =============================================================================
if phase_enabled "6"; then
  run_phase "6" "$QA_DIR/scripts/phase6-smoke.sh"
  rc=$?
  [[ $rc -eq 0 ]] || { [[ "$CONTINUE_ON_FAIL" == true ]] || exit $rc; }
fi

# =============================================================================
# PHASE 7 — CONTINUOUS VALIDATION (synthetic monitors; self-heal/auto-rollback)
# =============================================================================
if phase_enabled "7"; then
  run_phase "7" "$QA_DIR/scripts/phase7-continuous.sh"
  rc=$?
  [[ $rc -eq 0 ]] || { [[ "$CONTINUE_ON_FAIL" == true ]] || exit $rc; }
fi

# =============================================================================
# FINAL REPORT + GO / NO-GO
# =============================================================================
OVERALL_END_MS=$(date +%s%3N)
GNG="GO"
if [[ ${#FAILED_PHASES[@]} -gt 0 ]]; then GNG="NO-GO"; fi

if [[ ${#FAILED_PHASES[@]} -gt 0 ]]; then
  FAILED_JSON="$(printf '"%s",' "${FAILED_PHASES[@]}" | sed 's/,$//')"
else
  FAILED_JSON=""
fi

cat > "$STATE_DIR/report.json" <<JSON
{
  "suite": "voice-agent-monorepo",
  "total_time_ms": $((OVERALL_END_MS - OVERALL_START_MS)),
  "go_no_go": "$GNG",
  "failed_phases": [$FAILED_JSON],
  "phases": $(for f in "$STATE_DIR"/phase-*.json; do cat "$f"; printf '\n'; done | jq -s -c . 2>/dev/null || echo "[]")
}
JSON

log "=== FINAL GO/NO-GO: $GNG ==="
log "Report written to $STATE_DIR/report.json"
[[ "$JSON_ONLY" == true ]] && cat "$STATE_DIR/report.json"

if [[ "$GNG" == "NO-GO" ]]; then
  log "Failed phases: ${FAILED_PHASES[*]}"
  log "Rollback procedures: see qa/docs/rollback-recovery.md"
  exit 1
fi
exit 0
