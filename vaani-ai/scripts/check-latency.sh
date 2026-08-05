#!/usr/bin/env bash
# Vaani AI — latency budget check (readme §2): streaming STT->LLM->TTS < 800ms E2E,
# Vobiz telephony leg ~80ms. Read-only; safe to run any time.
set -u
BUDGET=${LATENCY_BUDGET_MS:-800}
echo "== latency budget: end-to-end first-audio < ${BUDGET}ms (vobiz leg ~80ms) =="
echo
echo "-- 1. Dograh pipeline latency lines (last 2000 log lines) --"
cd /root/dograh
docker compose logs --tail 2000 2>/dev/null \
  | grep -i -E "latency|ttfb|time.to.first|stt.*ms|llm.*ms|tts.*ms" | tail -n 20
echo
echo "-- 2. Latest run usage/cost info via Dograh API --"
cd /root/vaani-ai
# env loaded by executor wrapper
curl -s --max-time 10 -H "X-API-Key: ${DOGRAH_API_KEY}" \
  "${DOGRAH_BASE_URL}/api/v1/organizations/usage/runs" | head -c 1200
echo
echo
echo "== done. If section 1 is empty, discover this Dograh version's metric names with:"
echo "   cd /root/dograh && grep -ri -E 'latency|ttfb' docs/ README.md 2>/dev/null | head"
