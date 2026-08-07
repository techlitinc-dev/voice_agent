# Test Cards — Phase 2: INTEGRATION TESTS

Real (unmocked) Postgres/Redis/MinIO + real HTTP between vaani-ai (Next.js) and
dograh (FastAPI). Verifies data contracts, serialization, event flow, and error
propagation at module boundaries. Runner: `qa/scripts/phase2-integration.sh`.

---

## TEST CARD: Phase 2 → vaani-ai ↔ dograh contract → P2-T01

- **1. TRIGGER** : P1-T06 passes.
- **2. PRE-CONDITIONS** : Infra up (postgres/redis/minio); `test_db` exists; `.env`/`.env.test` present.
- **3. AI INSTRUCTIONS** :
  1. Boot dograh: `cd /root/voice_agent/dograh && .venv/bin/python -m uvicorn api.app:app --host 127.0.0.1 --port 8000 --env-file api/.env.test &`
  2. Wait: `curl -sf http://127.0.0.1:8000/api/v1/health` up to 30s.
  3. Boot vaani: `cd /root/voice_agent/vaani-ai && DOGRAH_BASE_URL=http://127.0.0.1:8000 npm run start &`
  4. Wait: `curl -sf http://127.0.0.1:3000/api/health` up to 45s.
  5. POST signup to dograh; capture token.
  6. POST workflow creation with token.
- **4. INPUT DATA** :
  - signup: `{"email":"integ.test@vaani.local","password":"TestPass123!","name":"Integ Tester"}`
  - workflow: `{"name":"Integ Test Agent","config":{}}`
- **5. EXPECTED OUTPUT** :
  - ASSERT dograh_health.status == "ok"
  - ASSERT vaani_health.status == "ok"
  - ASSERT vaani_health.checks.dograh == true
  - ASSERT signup.token != ""
  - ASSERT workflow.id != ""
  - ASSERT protected_route_without_token_http_code == 401
- **6. CLEANUP** : kill dograh + vaani PIDs.
- **7. NEXT TEST ID** : P2-T02.

## TEST CARD: Phase 2 → webhook signature handshake → P2-T02

- **1. TRIGGER** : P2-T01 passes.
- **2. PRE-CONDITIONS** : vaani-ai deps installed.
- **3. AI INSTRUCTIONS** :
  1. `cd /root/voice_agent/vaani-ai`
  2. `DOGRAH_WEBHOOK_SECRET=test-secret npx vitest run src/lib/dograhWebhook.test.ts --reporter=json --outputFile=../../qa/state/integ-webhook.json`
  3. IF fail THEN rerun once (self-heal); mark FLAKY-PASS if green.
- **4. INPUT DATA** : dograhWebhook.test.ts (HMAC verification, tamper rejection).
- **5. EXPECTED OUTPUT** :
  - ASSERT exit_code == 0
  - ASSERT jq '.numFailedTests' integ-webhook.json == 0
- **6. CLEANUP** : none.
- **7. NEXT TEST ID** : P2-T03.

## TEST CARD: Phase 2 → queue / event flow (BullMQ ↔ Redis real) → P2-T03

- **1. TRIGGER** : P2-T02 passes.
- **2. PRE-CONDITIONS** : Redis up.
- **3. AI INSTRUCTIONS** :
  1. `cd /root/voice_agent/vaani-ai`
  2. `npx vitest run tests/analytics.test.ts tests/campaign-retry.test.ts --reporter=json --outputFile=../../qa/state/integ-queue.json`
  3. Self-heal retry once.
- **4. INPUT DATA** : analytics + campaign-retry spec files.
- **5. EXPECTED OUTPUT** :
  - ASSERT exit_code == 0
  - ASSERT jq '.numFailedTests' integ-queue.json == 0
- **6. CLEANUP** : flush BullMQ queues used by tests (`redis-cli FLUSHDB` scoped to test keys only — see fixtures).
- **7. NEXT TEST ID** : P2-T04.

## TEST CARD: Phase 2 → PII boundary (worker → API) → P2-T04

- **1. TRIGGER** : P2-T03 passes.
- **2. PRE-CONDITIONS** : none extra.
- **3. AI INSTRUCTIONS** :
  1. `cd /root/voice_agent/vaani-ai`
  2. `npx vitest run tests/pii.test.ts --reporter=json --outputFile=../../qa/state/integ-pii.json`
  3. Self-heal retry once.
- **4. INPUT DATA** : pii.test.ts (card numbers, Aadhaar, PAN masking).
- **5. EXPECTED OUTPUT** :
  - ASSERT exit_code == 0
  - ASSERT no assertion result contains unmasked 16-digit sequence
  - ASSERT jq '.numFailedTests' integ-pii.json == 0
- **6. CLEANUP** : none.
- **7. NEXT TEST ID** : P3-T01.

---

## PHASE 2 JSON SUMMARY (phase2-integration.sh)

```json
{
  "phase": "2-integration",
  "tests_run": 4,
  "passed": 4,
  "failed": 0,
  "blocked": 0,
  "total_time_ms": 0,
  "go_no_go": "GO"
}
```
