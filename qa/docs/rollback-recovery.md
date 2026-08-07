# Rollback & Recovery Procedures

Deterministic, human-free. Triggered by Phase 6 rollback smoke, Phase 7
auto-rollback, or any phase producing NO-GO in a release pipeline.

## Triggers

| Trigger | Source | Action |
|---------|--------|--------|
| Any phase NO-GO in CI release | orchestrator exit 1 | Block deploy; page on-call |
| 3 consecutive critical failures in prod | Phase 7 counter | Auto-run `qa/scripts/rollback.sh` |
| Health degraded > 5 min | health-watch.sh | Page + auto-rollback |

## Procedure (rollback.sh)

1. Resolve target: `ROLLBACK_TARGET` env, else `HEAD~1` (previous deploy tag).
2. `git checkout $TARGET -- .` (restore tree to known-good).
3. Rebuild vaani-ai (`npm ci && npm run build`) and dograh (`pip install -r requirements.txt`).
4. In prod: redeploy the rebuilt images (compose `up -d --build` or k8s rollout).
5. Write `qa/state/rollback.json` with target + rc.
6. Re-run Phase 6 smoke (P6-T02 health) to confirm rollback is healthy.

## Self-healing loops

| Failure class | Retry | Backoff | Verdict |
|---------------|-------|---------|---------|
| Flaky unit test (vitest/pytest) | 1 re-run of failed tests only | immediate | FLAKY-PASS (not a failure) |
| Server boot timeout (P2/P3/P4/P5) | up to 45 probes | 1–2s | BLOCKED (env), not FAILED |
| Rate-limit window (P5-T03) | 1 re-run after 60s | 60s | FAILED if still 429-missing |
| Health check after Redis restart (P4-T03) | 20 probes / 40s | 2s | FAILED if not recovered |
| Continuous monitor (P7) | every 60s cycle | n/a | counter++; rollback at ≥3 |

## Marking FLAKY vs FAILED

- A test that passes on retry is recorded as **FLAKY-PASS** — reported in the
  phase JSON as `passed`, plus a note in `qa/state/*.log`.
- A test that fails on both attempts is **FAILED** → phase NO-GO.
- An environment error (infra not reachable after setup) is **BLOCKED** → phase
  NO-GO but suite continues; only `setup-env.sh` hard-exits.

## Recovery verification (post-rollback)

```bash
bash qa/scripts/verify-clean.sh        # ports free, state reset
curl -sf http://127.0.0.1:3000/api/health | jq -e '.status=="ok"'
curl -sf http://127.0.0.1:8000/api/v1/health | jq -e '.status=="ok"'
```
Both must return exit 0 before the next release attempt.

## Data safety

- Never drop `test_db` (used by dograh pytest session).
- `prisma migrate status` must be "up to date" post-rollback; if the rollback
  target predates a migration, run `prisma migrate deploy` on the target.
- Recordings/transcripts are never deleted by tests (`RETENTION_DRY_RUN=true`).
