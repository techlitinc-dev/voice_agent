# Test Cards — Phase 3: END-TO-END / WORKFLOW TESTS

Complete user journeys in a real browser (Playwright, chromium, serial workers).
Auth sessions cached in `e2e/.auth/` via `helpers.ts`. Runner:
`qa/scripts/phase3-e2e.sh`. Specs present: auth, onboarding, campaigns, billing,
branding, knowledge, kyc, gdpr, opt-out, analytics, webhooks, sample-data,
status, agent-lifecycle, live-ops.

---

## TEST CARD: Phase 3 → Auth + Onboarding journey → P3-T01

- **1. TRIGGER** : P2-T04 passes.
- **2. PRE-CONDITIONS** : vaani-ai app running on :3000 (phase script boots it); playwright browsers installed (`npx playwright install chromium` done at setup).
- **3. AI INSTRUCTIONS** :
  1. `cd /root/voice_agent/vaani-ai`
  2. `E2E_BASE_URL=http://127.0.0.1:3000 npx playwright test e2e/auth.spec.ts e2e/onboarding.spec.ts --config=e2e/playwright.config.ts`
  3. IF fail THEN rerun the exact same two specs once (self-heal); IF green mark FLAKY-PASS else FAILED.
- **4. INPUT DATA** : spec-driven; fixture user from `e2e/helpers.ts` (demo workspace).
- **5. EXPECTED OUTPUT** :
  - ASSERT exit_code == 0
  - ASSERT report contains 0 failed
  - ASSERT storageState file `e2e/.auth/*.json` created (session persisted)
- **6. CLEANUP** : leave storageState for later specs; clear any created trial data via demo-workspace reseed.
- **7. NEXT TEST ID** : P3-T02.

## TEST CARD: Phase 3 → Agent + Campaign journey → P3-T02

- **1. TRIGGER** : P3-T01 passes.
- **2. PRE-CONDITIONS** : storageState present; app on :3000.
- **3. AI INSTRUCTIONS** :
  1. `cd /root/voice_agent/vaani-ai`
  2. `E2E_BASE_URL=http://127.0.0.1:3000 npx playwright test e2e/agent-lifecycle.spec.ts e2e/campaigns.spec.ts e2e/sample-data.spec.ts --config=e2e/playwright.config.ts`
  3. Self-heal retry once.
- **4. INPUT DATA** : spec-driven (create agent → build flow → run campaign → verify call log).
- **5. EXPECTED OUTPUT** :
  - ASSERT exit_code == 0
  - ASSERT 0 failed
  - ASSERT campaign state transitions observed (draft → active → completed)
- **6. CLEANUP** : delete created agent/campaign via UI teardown in spec (or reseed demo data).
- **7. NEXT TEST ID** : P3-T03.

## TEST CARD: Phase 3 → Analytics + Retention + Webhooks journey → P3-T03

- **1. TRIGGER** : P3-T02 passes.
- **2. PRE-CONDITIONS** : storageState present.
- **3. AI INSTRUCTIONS** :
  1. `cd /root/voice_agent/vaani-ai`
  2. `E2E_BASE_URL=http://127.0.0.1:3000 npx playwright test e2e/analytics.spec.ts e2e/webhooks.spec.ts e2e/gdpr.spec.ts --config=e2e/playwright.config.ts`
  3. Self-heal retry once.
- **4. INPUT DATA** : spec-driven.
- **5. EXPECTED OUTPUT** :
  - ASSERT exit_code == 0
  - ASSERT 0 failed
  - ASSERT gdpr export + erase assertions passed
- **6. CLEANUP** : reseed demo workspace.
- **7. NEXT TEST ID** : P4-T01.

---

## PHASE 3 JSON SUMMARY (phase3-e2e.sh)

```json
{
  "phase": "3-e2e",
  "tests_run": 3,
  "passed": 3,
  "failed": 0,
  "blocked": 0,
  "total_time_ms": 0,
  "go_no_go": "GO"
}
```
