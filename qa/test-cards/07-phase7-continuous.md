# Test Cards — Phase 7: CONTINUOUS VALIDATION (Post-Deploy)

Synthetic monitoring that runs forever in production. Auto-rollback if critical
assertions fail. Runner: `qa/scripts/phase7-continuous.sh` (wrap in cron/systemd
in prod; bounded `CONTINUOUS_CYCLES` for CI).

---

## TEST CARD: Phase 7 → synthetic health monitor → P7-T01

- **1. TRIGGER** : P6-T03 passes.
- **2. PRE-CONDITIONS** : production URLs set via `VAANI_HEALTH_URL` / `DOGRAH_HEALTH_URL` (default localhost).
- **3. AI INSTRUCTIONS** :
  1. Every 60s, GET `$VAANI_HEALTH_URL` and `$DOGRAH_HEALTH_URL`.
  2. Record http codes.
- **4. INPUT DATA** : none.
- **5. EXPECTED OUTPUT** :
  - ASSERT vaani_health_code == 200
  - ASSERT dograh_health_code == 200
  - IF either != 200 THEN increment critical_failure_counter
- **6. CLEANUP** : none (running monitor).
- **7. NEXT TEST ID** : P7-T02.

## TEST CARD: Phase 7 → critical journey probe → P7-T02

- **1. TRIGGER** : P7-T01 passes (or every 5th cycle).
- **2. PRE-CONDITIONS** : probe user exists (seeded by fixtures).
- **3. AI INSTRUCTIONS** :
  1. POST `$DOGRAH_HEALTH_URL`-adjacent auth: `POST /api/v1/auth/login` with probe user.
  2. Assert 200 + token present.
  3. GET a protected resource (workflows) with token → assert 200.
- **4. INPUT DATA** : `{"email":"cont.probe@vaani.local","password":"TestPass123!"}`.
- **5. EXPECTED OUTPUT** :
  - ASSERT login_code == 200
  - ASSERT token != ""
  - ASSERT workflows_code == 200
  - IF any fails THEN increment critical_failure_counter
- **6. CLEANUP** : none.
- **7. NEXT TEST ID** : P7-T03.

## TEST CARD: Phase 7 → auto-rollback check → P7-T03

- **1. TRIGGER** : P7-T02 passes (checked every cycle).
- **2. PRE-CONDITIONS** : `critical_failure_counter` tracked in `qa/state/continuous.json`.
- **3. AI INSTRUCTIONS** :
  1. IF critical_failure_counter >= 3 THEN execute `qa/scripts/rollback.sh` (auto, no human).
  2. After rollback, re-run P7-T01 health probe once.
  3. IF health still failing THEN mark system FLOORED (page human, log to `qa/state/continuous.json`).
- **4. INPUT DATA** : none.
- **5. EXPECTED OUTPUT** :
  - ASSERT rollback_triggered_only_if_counter_ge_3 == true
  - ASSERT rollback_exit_code == 0
  - ASSERT post_rollback_health_code == 200
- **6. CLEANUP** : reset counter to 0 on success; log rollback event.
- **7. NEXT TEST ID** : GS-TEARDOWN → END.

---

## PHASE 7 JSON SUMMARY (phase7-continuous.sh)

```json
{
  "phase": "7-continuous",
  "tests_run": 3,
  "passed": 3,
  "failed": 0,
  "blocked": 0,
  "total_time_ms": 0,
  "go_no_go": "GO"
}
```
