#!/usr/bin/env bash
# =============================================================================
# rollback.sh — deterministic rollback procedure for the voice-agent monorepo.
# Triggered by: Phase 7 auto-rollback, Phase 6 rollback trigger, or manually.
# Strategy: git tag -> current deployed tag; rollback = redeploy previous tag.
#   ROLLBACK_TARGET (env) overrides the target tag/commit (default: HEAD~1).
# =============================================================================
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="${ROLLBACK_TARGET:-$(git -C "$REPO_ROOT" rev-parse HEAD~1 2>/dev/null || echo 'unknown')}"
STATE_DIR="$REPO_ROOT/qa/state"

log() { printf '[rollback] %s\n' "$*"; }
[[ -d "$STATE_DIR" ]] || mkdir -p "$STATE_DIR"

if [[ "$TARGET" == "unknown" ]]; then
  echo "ROLLBACK_ABORTED:no_previous_commit" > "$STATE_DIR/rollback.json"
  exit 1
fi

log "rolling back to $TARGET"
git -C "$REPO_ROOT" checkout "$TARGET" -- . 2>&1 | tail -1
RC=$?

# Rebuild what changed (vaani-ai + dograh images, in prod this is the deploy step)
(cd "$REPO_ROOT/vaani-ai" && npm ci --no-audit --no-fund && npm run build) >> "$STATE_DIR/rollback.log" 2>&1 \
  || RC=$?
(cd "$REPO_ROOT/dograh" && .venv/bin/pip install -q -r api/requirements.txt) >> "$STATE_DIR/rollback.log" 2>&1 \
  || RC=$?

echo "{\"rollback_target\":\"$TARGET\",\"rc\":$RC,\"time\":\"$(date -u +%FT%TZ)\"}" > "$STATE_DIR/rollback.json"
[[ $RC -eq 0 ]] && log "rollback complete" || { echo "ROLLBACK_FAILED"; exit 1; }
exit 0
