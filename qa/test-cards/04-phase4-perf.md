# Test Cards — Phase 4: PERFORMANCE & LOAD TESTS

Measures latency, throughput, memory, concurrency. Exact thresholds from
PRODUCT_SPEC and readme. Runner: `qa/scripts/phase4-perf.sh`.

---

## TEST CARD: Phase 4 → latency (health + autoscale) → P4-T01

- **1. TRIGGER** : P3-T03 passes.
- **2. PRE-CONDITIONS** : vaani on :3000, dograh on :8000 (booted by runner); infra up.
- **3. AI INSTRUCTIONS** :
  1. For each URL, run 100 timed GETs (`curl -w '%{time_total}'`), collect to file.
  2. Compute p95 = 95th percentile of the 100 samples.
  3. Compare p95 to budget.
- **4. INPUT DATA** :
  - `http://127.0.0.1:3000/api/health` budget 200ms
  - `http://127.0.0.1:8000/api/v1/health` budget 200ms
  - `http://127.0.0.1:8000/api/v1/health/autoscale-metric?buffer=0` budget 200ms
- **5. EXPECTED OUTPUT** :
  - ASSERT p95(vaani_health) <= 200
  - ASSERT p95(dograh_health) <= 200
  - ASSERT p95(autoscale_metric) <= 200
- **6. CLEANUP** : remove timing files.
- **7. NEXT TEST ID** : P4-T02.

## TEST CARD: Phase 4 → concurrency / throughput → P4-T02

- **1. TRIGGER** : P4-T01 passes.
- **2. PRE-CONDITIONS** : same.
- **3. AI INSTRUCTIONS** :
  1. Fire 50 parallel `POST /api/v1/auth/login` requests (background `&`, `wait`).
  2. Count `200` responses; count non-200.
  3. Measure wall-clock time of the batch.
- **4. INPUT DATA** : 50× `{"email":"perf.load@vaani.local","password":"TestPass123!"}`.
- **5. EXPECTED OUTPUT** :
  - ASSERT count_200 == 50
  - ASSERT count_non_200 == 0
  - ASSERT batch_wall_time <= 4000 ms (i.e. p95 per-request < 400ms under concurrency)
- **6. CLEANUP** : none.
- **7. NEXT TEST ID** : P4-T03.

## TEST CARD: Phase 4 → degradation + recovery → P4-T03

- **1. TRIGGER** : P4-T02 passes.
- **2. PRE-CONDITIONS** : infra up; both apps booted.
- **3. AI INSTRUCTIONS** :
  1. `docker stop vaani-redis`; wait 2s.
  2. GET `http://127.0.0.1:3000/api/health` → record status code + `.status`.
  3. `docker start vaani-redis`; wait up to 40s for health recovery (retry loop).
  4. Assert recovery.
- **4. INPUT DATA** : none.
- **5. EXPECTED OUTPUT** :
  - ASSERT health_http_code_with_redis_down == 503
  - ASSERT health_status_with_redis_down == "down"
  - ASSERT health_recovered_http_code == 200
  - ASSERT health_recovered_status == "ok"
- **6. CLEANUP** : ensure redis running; wait for `health.status == ok`.
- **7. NEXT TEST ID** : P5-T01.

## TEST CARD: Phase 4 → memory bound → P4-T04

- **1. TRIGGER** : P4-T03 passes (run inside phase4-perf.sh after concurrency).
- **2. PRE-CONDITIONS** : vaani node PID known.
- **3. AI INSTRUCTIONS** :
  1. Read `/proc/<pid>/status` `VmRSS`.
  2. Compare to 1 GB (1048576 KB).
- **4. INPUT DATA** : none.
- **5. EXPECTED OUTPUT** :
  - ASSERT VmRSS_kb < 1048576
- **6. CLEANUP** : none.
- **7. NEXT TEST ID** : P5-T01.

---

## PHASE 4 JSON SUMMARY (phase4-perf.sh)

```json
{
  "phase": "4-perf",
  "tests_run": 4,
  "passed": 4,
  "failed": 0,
  "blocked": 0,
  "total_time_ms": 0,
  "go_no_go": "GO"
}
```
