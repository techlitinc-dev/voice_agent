# Test Cards — Phase 5: SECURITY & COMPLIANCE TESTS

Auth, authz, input sanitization, PII handling, rate limits, injection, fuzzing,
privilege escalation, webhook signatures, cookie flags, audit logs. Runner:
`qa/scripts/phase5-security.sh`.

---

## TEST CARD: Phase 5 → authz + tenant isolation → P5-T01

- **1. TRIGGER** : P4-T03 passes.
- **2. PRE-CONDITIONS** : dograh API booted (runner); `.env.test`.
- **3. AI INSTRUCTIONS** :
  1. Signup user A → capture token A.
  2. Signup user B → capture token B.
  3. GET workflows as B (no token A on the request).
  4. Assert B sees only B's org workflows (empty list = pass).
- **4. INPUT DATA** :
  - A: `{"email":"sec.a@vaani.local","password":"TestPass123!","name":"A"}`
  - B: `{"email":"sec.b@vaani.local","password":"TestPass123!","name":"B"}`
- **5. EXPECTED OUTPUT** :
  - ASSERT token_A != ""
  - ASSERT token_B != ""
  - ASSERT http_code(B_workflows_list) == 200
  - ASSERT B_workflows_items_contain_no_A_data == true
- **6. CLEANUP** : delete users A/B from test_db (or rely on transaction teardown).
- **7. NEXT TEST ID** : P5-T02.

## TEST CARD: Phase 5 → injection + fuzz → P5-T02

- **1. TRIGGER** : P5-T01 passes.
- **2. PRE-CONDITIONS** : dograh API up.
- **3. AI INSTRUCTIONS** :
  1. Send login with SQLi payload in email field.
  2. Record HTTP status.
  3. Send 50 malformed/random JSON payloads to login endpoint.
  4. Count HTTP 500s.
- **4. INPUT DATA** :
  - SQLi: `{"email":"' OR 1=1 --","password":"x"}`
  - fuzz: random base64 strings length 1..60 as body
- **5. EXPECTED OUTPUT** :
  - ASSERT sql_injection_http_code != 500
  - ASSERT sql_injection_http_code in (400, 401, 422)
  - ASSERT fuzz_500_count == 0
- **6. CLEANUP** : none.
- **7. NEXT TEST ID** : P5-T03.

## TEST CARD: Phase 5 → rate limiting → P5-T03

- **1. TRIGGER** : P5-T02 passes.
- **2. PRE-CONDITIONS** : vaani on :3000 (runner boots it); `PUBLIC_API_RATE_LIMIT=120` from `.env`.
- **3. AI INSTRUCTIONS** :
  1. Issue 130 rapid GETs to `http://127.0.0.1:3000/api/v1/ping`.
  2. Record the last response code.
- **4. INPUT DATA** : 130 identical GETs.
- **5. EXPECTED OUTPUT** :
  - ASSERT final_http_code == 429
- **6. CLEANUP** : wait 60s for rate-limit window reset (or flush ratelimit Redis key per fixtures).
- **7. NEXT TEST ID** : P5-T04.

## TEST CARD: Phase 5 → PII handling → P5-T04

- **1. TRIGGER** : P5-T03 passes.
- **2. PRE-CONDITIONS** : none extra.
- **3. AI INSTRUCTIONS** :
  1. `cd /root/voice_agent/vaani-ai`
  2. `npx vitest run tests/pii.test.ts --reporter=json --outputFile=../../qa/state/sec-pii.json`
- **4. INPUT DATA** : pii.test.ts — card numbers (16-digit), Aadhaar (12-digit), PAN (AAAAA9999A).
- **5. EXPECTED OUTPUT** :
  - ASSERT exit_code == 0
  - ASSERT numFailedTests == 0
  - ASSERT no raw PII pattern survives redaction in any output fixture
- **6. CLEANUP** : none.
- **7. NEXT TEST ID** : P5-T05.

## TEST CARD: Phase 5 → webhook + cookie security → P5-T05

- **1. TRIGGER** : P5-T04 passes.
- **2. PRE-CONDITIONS** : vaani on :3000, dograh on :8000.
- **3. AI INSTRUCTIONS** :
  1. `cd /root/voice_agent/vaani-ai && DOGRAH_WEBHOOK_SECRET=test-secret npx vitest run tests/webhook-sign.test.ts tests/stripe-sig.test.ts`
  2. POST login to vaani `/api/auth/login`; capture `Set-Cookie` header.
  3. Assert cookie flags.
  4. POST to dograh MCP without key → record code.
- **4. INPUT DATA** :
  - login: `{"email":"sec.a@vaani.local","password":"TestPass123!"}`
  - MCP: `{}` with no auth header
- **5. EXPECTED OUTPUT** :
  - ASSERT webhook_sig_exit_code == 0
  - ASSERT set_cookie_contains_HttpOnly == true
  - ASSERT set_cookie_contains_Secure == true
  - ASSERT mcp_no_auth_http_code in (401, 403)
- **6. CLEANUP** : none.
- **7. NEXT TEST ID** : P6-T01.

---

## PHASE 5 JSON SUMMARY (phase5-security.sh)

```json
{
  "phase": "5-security",
  "tests_run": 5,
  "passed": 5,
  "failed": 0,
  "blocked": 0,
  "total_time_ms": 0,
  "go_no_go": "GO"
}
```
