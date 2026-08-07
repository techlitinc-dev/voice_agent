#!/usr/bin/env bash
# =============================================================================
# verify-clean.sh — assert the environment is clean before the chain starts.
# Checks: no stale test data, no leftover servers on test ports, clean git state.
# Exits 2 (BLOCKED) if any check fails. Zero intervention.
# =============================================================================
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

log() { printf '[clean] %s\n' "$*"; }
fail() { echo "CLEAN_FAILED:$1"; exit 2; }

# 1. ports must be free (tests start their own servers)
for port in 3000 3001 8000 9229; do
  if (command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$port ") \
     || (command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1); then
    fail "port_$port_in_use"
  fi
done
log "test ports free"

# 2. git must be clean (no uncommitted changes that would pollute assertions)
if ! git -C "$REPO_ROOT" diff --quiet 2>/dev/null; then
  # Only a warning in CI-less runs: some fixtures are generated. Treated as hard
  # block only when RUN_FROM_CI is set.
  if [[ "${RUN_FROM_CI:-false}" == "true" ]]; then
    fail "dirty_git"
  fi
  log "WARN: git working tree not clean (ignored outside CI)"
fi

# 3. no stale qa/state (previous run output)
rm -rf "$REPO_ROOT/qa/state"
mkdir -p "$REPO_ROOT/qa/state"
log "qa/state reset"

# 4. dograh test db must exist (created by setup-env.sh)
docker exec vaani-db psql -U vaani -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='test_db'" 2>/dev/null | grep -q 1 \
  || fail "test_db_missing"
log "test_db present"

echo "CLEAN_OK"
