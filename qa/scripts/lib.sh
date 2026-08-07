#!/usr/bin/env bash
# =============================================================================
# lib.sh — shared helpers for phase runner scripts. Sourced, not executed.
# =============================================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
QA_DIR="$REPO_ROOT/qa"
STATE_DIR="$QA_DIR/state"
mkdir -p "$STATE_DIR"

# ---- counters for phase summaries -----------------------------------------
PHASE_NAME=""
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_BLOCKED=0
PHASE_START_MS=$(date +%s%3N)

phase_begin() { PHASE_NAME="$1"; PHASE_START_MS=$(date +%s%3N); TESTS_RUN=0; TESTS_PASSED=0; TESTS_FAILED=0; TESTS_BLOCKED=0; }

# pass <test_id> <detail>
pass() { TESTS_RUN=$((TESTS_RUN+1)); TESTS_PASSED=$((TESTS_PASSED+1)); printf 'PASS %-24s %s\n' "$1" "${2:-}"; }

# fail <test_id> <detail>
fail() { TESTS_RUN=$((TESTS_RUN+1)); TESTS_FAILED=$((TESTS_FAILED+1)); printf 'FAIL %-24s %s\n' "$1" "${2:-}"; }

# blocked <test_id> <detail> — environment error, phase is NO-GO but suite continues
blocked() { TESTS_RUN=$((TESTS_RUN+1)); TESTS_BLOCKED=$((TESTS_BLOCKED+1)); printf 'BLOCKED %-24s %s\n' "$1" "${2:-}"; }

phase_end() {
  local ms=$(( $(date +%s%3N) - PHASE_START_MS ))
  local gng="GO"
  [[ $TESTS_FAILED -gt 0 || $TESTS_BLOCKED -gt 0 ]] && gng="NO-GO"
  cat > "$STATE_DIR/phase-$PHASE_NAME.json" <<JSON
{
  "phase": "$PHASE_NAME",
  "tests_run": $TESTS_RUN,
  "passed": $TESTS_PASSED,
  "failed": $TESTS_FAILED,
  "blocked": $TESTS_BLOCKED,
  "total_time_ms": $ms,
  "go_no_go": "$gng"
}
JSON
  printf '\nPHASE %s: %s/%s passed, %s failed, %s blocked (%sms) -> %s\n' \
    "$PHASE_NAME" "$TESTS_PASSED" "$TESTS_RUN" "$TESTS_FAILED" "$TESTS_BLOCKED" "$ms" "$gng"
  [[ "$gng" == "GO" ]]
}

# ---- assertion helpers (run an assertion, feed pass/fail) -------------------
# assert_status <test_id> <label> <expected> <actual>
assert_status() {
  local tid="$1" label="$2" expected="$3" actual="$4"
  if [[ "$expected" == "$actual" ]]; then pass "$tid" "$label == $expected"; else fail "$tid" "$label expected=$expected got=$actual"; fi
}

# expect <test_id> <description> <cmd...> — runs cmd, PASS if rc==0
expect() {
  local tid="$1" desc="$2"; shift 2
  if "$@" >/dev/null 2>&1; then pass "$tid" "$desc"; else fail "$tid" "$desc"; fi
}

# expect_json <test_id> <desc> <json> <jqfilter> <expected-value>
expect_json() {
  local tid="$1" desc="$2" json="$3" filter="$4" expected="$5" actual
  actual="$(printf '%s' "$json" | jq -r "$filter" 2>/dev/null)"
  if [[ "$actual" == "$expected" ]]; then pass "$tid" "$desc"; else fail "$tid" "$desc (expected $expected got $actual)"; fi
}

# retry <n> <delay> <cmd...> — retry loop for flaky-tolerant probes
retry() {
  local n="$1" delay="$2"; shift 2
  local i
  for i in $(seq 1 "$n"); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep "$delay"
  done
  return 1
}
