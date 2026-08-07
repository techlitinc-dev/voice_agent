# Test Cards — Phase 1: UNIT / MODULE ISOLATION

Mocks ALL external deps (DB, Redis, MinIO, Dograh, Vobiz, Sarvam, OpenRouter).
Threshold: 100% critical path coverage, <50ms per test.
Runners: `npx vitest run` (vaani-ai, 45 spec files) + `.venv/bin/python -m pytest api/tests` (dograh, 150 spec files).
Self-healing: each suite gets ONE retry of the exact failed tests; a test that
passes on retry is marked FLAKY-PASS, not FAILED.

---

## TEST CARD: Phase 1 → vaani-ai billing → P1-T01

- **1. TRIGGER** : GS-SETUP/GS-CHAIN pass.
- **2. PRE-CONDITIONS** : vaani-ai `.env` present; `node_modules` installed; infra up (setup-env did it).
- **3. AI INSTRUCTIONS** :
  1. `cd /root/voice_agent/vaani-ai`
  2. Run `npx vitest run tests/billing-ratecard.test.ts tests/invoice.test.ts tests/addons-autotopup-reseller.test.ts tests/money.test.ts --reporter=json --outputFile=../../qa/state/vitest-billing.json`
  3. IF exit code != 0 THEN rerun ONLY the failed tests once (self-healing retry); IF still failing THEN mark FAILED.
- **4. INPUT DATA** : vitest spec files (billing-ratecard, invoice, addons-autotopup-reseller, money).
- **5. EXPECTED OUTPUT** :
  - ASSERT exit_code == 0
  - ASSERT jq '.numTotalTests' vitest-billing.json >= 20
  - ASSERT jq '.numFailedTests' vitest-billing.json == 0
- **6. CLEANUP** : none (in-memory mocks).
- **7. NEXT TEST ID** : P1-T02.

## TEST CARD: Phase 1 → vaani-ai auth → P1-T02

- **1. TRIGGER** : P1-T01 passes.
- **2. PRE-CONDITIONS** : Same as P1-T01.
- **3. AI INSTRUCTIONS** :
  1. `cd /root/voice_agent/vaani-ai`
  2. Run `npx vitest run tests/totp.test.ts tests/permissions.test.ts tests/onboarding.test.ts tests/apikeys.test.ts --reporter=json --outputFile=../../qa/state/vitest-auth.json`
  3. Same retry policy as P1-T01.
- **4. INPUT DATA** : totp, permissions, onboarding, apikeys spec files.
- **5. EXPECTED OUTPUT** :
  - ASSERT exit_code == 0
  - ASSERT jq '.numFailedTests' vitest-auth.json == 0
- **6. CLEANUP** : none.
- **7. NEXT TEST ID** : P1-T03.

## TEST CARD: Phase 1 → vaani-ai campaign engine → P1-T03

- **1. TRIGGER** : P1-T02 passes.
- **2. PRE-CONDITIONS** : Same.
- **3. AI INSTRUCTIONS** :
  1. `cd /root/voice_agent/vaani-ai`
  2. Run `npx vitest run tests/campaign-*.test.ts tests/dialJobs.test.ts tests/fallbackPolicy.test.ts tests/campaign-fallback.test.ts --reporter=json --outputFile=../../qa/state/vitest-campaign.json`
  3. Same retry policy.
- **4. INPUT DATA** : campaign-* suite (pacing, phone, pool-compliance, retry, scoring, windows, fallback), dialJobs, fallbackPolicy.
- **5. EXPECTED OUTPUT** :
  - ASSERT exit_code == 0
  - ASSERT jq '.numFailedTests' vitest-campaign.json == 0
- **6. CLEANUP** : none.
- **7. NEXT TEST ID** : P1-T04.

## TEST CARD: Phase 1 → dograh auth → P1-T04

- **1. TRIGGER** : P1-T03 passes.
- **2. PRE-CONDITIONS** : dograh `.venv` exists; `api/.env.test` present; `test_db` exists.
- **3. AI INSTRUCTIONS** :
  1. `cd /root/voice_agent/dograh`
  2. Run `.venv/bin/python -m pytest api/tests/test_auth_routes.py api/tests/test_auth_depends.py api/tests/test_user_email_case_insensitive.py -q --tb=short`
  3. IF exit != 0 THEN rerun failed tests once; THEN mark accordingly.
- **4. INPUT DATA** : test_auth_routes, test_auth_depends, test_user_email_case_insensitive.
- **5. EXPECTED OUTPUT** :
  - ASSERT exit_code == 0
  - ASSERT pytest summary line matches "passed"
- **6. CLEANUP** : transaction rollback via `async_session` fixture (automatic).
- **7. NEXT TEST ID** : P1-T05.

## TEST CARD: Phase 1 → dograh workflow → P1-T05

- **1. TRIGGER** : P1-T04 passes.
- **2. PRE-CONDITIONS** : Same as P1-T04.
- **3. AI INSTRUCTIONS** :
  1. `cd /root/voice_agent/dograh`
  2. Run `.venv/bin/python -m pytest api/tests/test_workflow_*.py api/tests/test_node_specs.py api/tests/test_trigger_path_validation.py api/tests/test_workflow_graph_constraints.py api/tests/test_workflow_versioning.py -q --tb=short`
  3. Same retry policy.
- **4. INPUT DATA** : all `test_workflow_*`, node_specs, trigger_path_validation, workflow_graph_constraints, workflow_versioning.
- **5. EXPECTED OUTPUT** :
  - ASSERT exit_code == 0
  - ASSERT pytest summary "passed" present
- **6. CLEANUP** : transaction rollback.
- **7. NEXT TEST ID** : P1-T06.

## TEST CARD: Phase 1 → dograh MCP server → P1-T06

- **1. TRIGGER** : P1-T05 passes.
- **2. PRE-CONDITIONS** : Same.
- **3. AI INSTRUCTIONS** :
  1. `cd /root/voice_agent/dograh`
  2. Run `.venv/bin/python -m pytest api/tests/test_mcp_*.py -q --tb=short`
  3. Same retry policy.
- **4. INPUT DATA** : test_mcp_auth, test_mcp_create_workflow, test_mcp_get_workflow, test_mcp_save_workflow, test_mcp_integration, test_mcp_custom_tool_manager, test_mcp_docs_search, test_mcp_instructions_drift, test_mcp_tool_* (definition, creation, route, session).
- **5. EXPECTED OUTPUT** :
  - ASSERT exit_code == 0
  - ASSERT pytest summary "passed" present
- **6. CLEANUP** : transaction rollback.
- **7. NEXT TEST ID** : P2-T01.

---

## PHASE 1 JSON SUMMARY (written by phase1-unit.sh → `qa/state/phase-1-unit.json`)

```json
{
  "phase": "1-unit",
  "tests_run": 6,
  "passed": 6,
  "failed": 0,
  "blocked": 0,
  "total_time_ms": 0,
  "go_no_go": "GO"
}
```
