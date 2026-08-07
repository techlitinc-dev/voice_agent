# Test Cards — Phase 6: PRODUCTION READINESS / SMOKE TESTS

Production-like environment, production data volumes, monitoring/alerting,
rollback triggers, health checks. Runner: `qa/scripts/phase6-smoke.sh`.

---

## TEST CARD: Phase 6 → prod build smoke → P6-T01

- **1. TRIGGER** : P5-T05 passes.
- **2. PRE-CONDITIONS** : docker available; `vaani-ai/docker-compose.prod.yml` exists.
- **3. AI INSTRUCTIONS** :
  1. `cd /root/voice_agent/vaani-ai`
  2. `docker compose -f docker-compose.prod.yml build --pull`
  3. Assert exit code.
- **4. INPUT DATA** : none.
- **5. EXPECTED OUTPUT** :
  - ASSERT build_exit_code == 0
  - ASSERT image `vaani-ai:prod` (or compose service image) exists in `docker images`
- **6. CLEANUP** : none (leave image for phase 7).
- **7. NEXT TEST ID** : P6-T02.

## TEST CARD: Phase 6 → health + monitoring smoke → P6-T02

- **1. TRIGGER** : P6-T01 passes.
- **2. PRE-CONDITIONS** : docker stack (or local dev services) running; `.env` populated.
- **3. AI INSTRUCTIONS** :
  1. Run `bash vaani-ai/scripts/health-watch.sh --once http://127.0.0.1:3000/api/health` (or against prod URL from env).
  2. Assert exit 0 and log contains `status ok`.
  3. Run `cd vaani-ai && npx prisma migrate status` → assert "up to date".
- **4. INPUT DATA** : health URL from `HEALTH_URL` env (default localhost:3000).
- **5. EXPECTED OUTPUT** :
  - ASSERT health_watch_exit_code == 0
  - ASSERT health_watch_log contains "ok"
  - ASSERT prisma_migrate_status contains "up to date"
- **6. CLEANUP** : none.
- **7. NEXT TEST ID** : P6-T03.

## TEST CARD: Phase 6 → rollback trigger smoke → P6-T03

- **1. TRIGGER** : P6-T02 passes.
- **2. PRE-CONDITIONS** : repo has ≥2 commits (HEAD~1 resolvable); git tags optional.
- **3. AI INSTRUCTIONS** :
  1. Verify `git -C /root/voice_agent describe --tags --abbrev=0` returns a tag (or fall back to commit SHA).
  2. Verify `ROLLBACK_TARGET` env is resolvable (`git rev-parse`).
  3. Assert rollback script exists and is executable.
  4. Dry-run: `bash qa/scripts/rollback.sh` with `ROLLBACK_TARGET=<previous commit>` — assert exit 0 (rebuild step may be skipped in smoke via `SMOKE_DRY_RUN=1`).
- **4. INPUT DATA** : none.
- **5. EXPECTED OUTPUT** :
  - ASSERT rollback_script_exists == true
  - ASSERT rollback_exit_code == 0 (dry-run)
  - ASSERT qa/state/rollback.json contains `"rc":0`
- **6. CLEANUP** : `git checkout main -- .` to restore tree if dry-run altered it (dry-run must not alter).
- **7. NEXT TEST ID** : P7-T01.

---

## PHASE 6 JSON SUMMARY (phase6-smoke.sh)

```json
{
  "phase": "6-smoke",
  "tests_run": 3,
  "passed": 3,
  "failed": 0,
  "blocked": 0,
  "total_time_ms": 0,
  "go_no_go": "GO"
}
```
