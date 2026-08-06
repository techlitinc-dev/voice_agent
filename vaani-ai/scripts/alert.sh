#!/usr/bin/env bash
# Post an alert to ALERT_SLACK_WEBHOOK_URL (Slack-compatible incoming webhook;
# Discord webhooks with /slack suffix also accept this payload shape).
set -euo pipefail
MSG="${1:-Vaani AI alert (no message)}"
WEBHOOK="${ALERT_SLACK_WEBHOOK_URL:-}"
if [ -z "$WEBHOOK" ]; then
  echo "ALERT_SLACK_WEBHOOK_URL not set — alert NOT sent: $MSG" >&2
  exit 1
fi
# Build a JSON-safe payload; replace any double quotes in the message with single
# quotes (POSIX-safe, no bash-only substitution).
SAFE_MSG=$(printf '%s' "$MSG" | sed "s/\"/'/g")
PAYLOAD=$(printf '{"text":"[vaani-ai %s] %s"}' "$(hostname)" "$SAFE_MSG")
curl -sS -m 10 -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$WEBHOOK"
echo
echo "alert sent"
