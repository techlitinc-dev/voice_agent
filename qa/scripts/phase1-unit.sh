#!/usr/bin/env bash
# =============================================================================
# PHASE 1 — UNIT / MODULE ISOLATION TESTS
# Targets: vaani-ai (vitest, 45 spec files) + dograh (pytest, 150 spec files).
# All external deps (DB, Redis, MinIO, Dograh, Vobiz, Sarvam, OpenRouter) are
# mocked at the unit layer. Threshold: 100% critical path, <50ms per test.
# =============================================================================
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

phase_begin "1-unit"

# ------------------------------------------------------------------ vaani-ai
(cd "$REPO_ROOT/vaani-ai" && npx vitest run --reporter=json --outputFile="$STATE_DIR/vitest.json") \
  > "$STATE_DIR/vitest.log" 2>&1
VAANI_RC=$?

if [[ $VAANI_RC -eq 0 ]]; then
  N="$(jq '.numTotalTests // 0' "$STATE_DIR/vitest.json" 2>/dev/null)"
  pass "vaani-unit" "vitest: $N tests passed"
else
  N="$(jq '.numFailedTests // 0' "$STATE_DIR/vitest.json" 2>/dev/null)"
  fail "vaani-unit" "vitest failed ($N failed) — see $STATE_DIR/vitest.log"
fi

# Retry policy (self-healing loop): one re-run of the exact failed files only.
if [[ $VAANI_RC -ne 0 ]]; then
  RETRY_LOG="$STATE_DIR/vitest-retry.log"
  jq -r '.testResults[] | select(.status=="failed") | .assertionResults[].fullName' \
    "$STATE_DIR/vitest.json" 2>/dev/null | head -40 > "$STATE_DIR/vitest-failures.txt"
  (cd "$REPO_ROOT/vaani-ai" && npx vitest run --reporter=json \
    --outputFile="$STATE_DIR/vitest-retry.json" $(sed 's/^/--testNamePattern=/' "$STATE_DIR/vitest-failures.txt" | tr '\n' ' ')) \
    > "$RETRY_LOG" 2>&1
  RETRY_RC=$?
  if [[ $RETRY_RC -eq 0 ]]; then
    pass "vaani-unit-retry" "flaky on first run, green on retry"
  else
    fail "vaani-unit-retry" "still failing after retry — see $RETRY_LOG"
  fi
fi

# ------------------------------------------------------------------ dograh
(cd "$REPO_ROOT/dograh" && .venv/bin/python -m pytest api/tests -x -q --tb=short \
  --junitxml="$STATE_DIR/dograh-pytest.xml") > "$STATE_DIR/pytest.log" 2>&1
DOGRAH_RC=$?

if [[ $DOGRAH_RC -eq 0 ]]; then
  pass "dograh-unit" "pytest suite green"
else
  fail "dograh-unit" "pytest failed — see $STATE_DIR/pytest.log"
fi

phase_end
exit $?
