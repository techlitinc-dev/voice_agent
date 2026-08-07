# Final Go / No-Go Decision Matrix

Evaluated automatically after every phase and at suite end by
`qa/orchestrator.sh` → `qa/state/report.json`.

## Per-phase go/no-go rules

| Phase | GO if | NO-GO if |
|-------|-------|----------|
| 1-unit | all suites pass (flaky-pass counted as pass) | any suite fails after 1 retry |
| 2-integration | all contract checks pass | any handshake/data-contract fails |
| 3-e2e | all Playwright specs pass | any spec fails after retry |
| 4-perf | p95 ≤ budget, 0 errors, memory < 1GB, recovery ok | any threshold exceeded, or degradation test fails to degrade correctly |
| 5-security | all attacks blocked, no 500s, flags correct | any bypass, 500, or leak |
| 6-smoke | build green, health ok, migrations up-to-date, rollback dry-run rc=0 | build fail, health fail, rollback unavailable |
| 7-continuous | health green across cycles, rollback not triggered (or triggered and recovered) | rollback triggered but recovery failed |

## Final decision

- **GO** — all 7 phases GO. Deploy/release proceeds. `exit 0`.
- **NO-GO** — any phase NO-GO. Deploy blocked. `exit 1`. Rollback per
  `qa/docs/rollback-recovery.md`.
- **BLOCKED** — environment/setup failure (setup-env or verify-clean exit 2).
  `exit 2`. Requires infrastructure fix, not code fix.

## Matrix

| Phase | tests_run | passed | failed | blocked | go_no_go |
|-------|-----------|--------|--------|---------|----------|
| 1-unit | ≥6 | = run | 0 | 0 | GO |
| 2-integration | 4 | = run | 0 | 0 | GO |
| 3-e2e | 3 | = run | 0 | 0 | GO |
| 4-perf | 4 | = run | 0 | 0 | GO |
| 5-security | 5 | = run | 0 | 0 | GO |
| 6-smoke | 3 | = run | 0 | 0 | GO |
| 7-continuous | ≥3 | = run | 0 | 0 | GO |
| **TOTAL** | ≥28 | ≥28 | 0 | 0 | **GO** |

## Rollback gates

- If release was already deployed and Phase 7 triggers rollback: block new
  deploys until `qa/state/rollback.json` reports `rc:0` AND both health checks
  return `ok`.
- If rollback itself fails (`rc != 0`): system is FLOORED; page on-call (the
  single allowed human touchpoint, per `SECURITY.md` escalation path).

## Reporting (mandatory per phase, machine-readable)

```json
{
  "phase": "name",
  "tests_run": 28,
  "passed": 28,
  "failed": 0,
  "blocked": 0,
  "total_time_ms": 123456,
  "go_no_go": "GO"
}
```
