# Disaster Recovery Drill

Companion to `04-disaster-recovery.md` §5. Quarterly DR drill — mandatory.

## Setup

1. Spin up a parallel "DR" environment using **only** backups (no access to prod).
2. Restore the DB to the DR environment.
3. Run the manual test suite (`docs/manual-testing/`) against DR.
4. Measure actual RTO — how long from "go" to "system functional".
5. Document findings; fix gaps; update this document.

## Drill checklist

- [ ] Restore DB from backup → success? (scripts/restore-pg.sh)
- [ ] Restore Redis from backup → success? (scripts/backup-redis.sh + restart)
- [ ] Restore MinIO from DR bucket → success? (mc mirror)
- [ ] App starts and passes `/api/health/deep`? (scripts/drill-verify.sh)
- [ ] Can log in, view dashboard, make a test call?
- [ ] RTO measured: _____ min
- [ ] RPO verified: _____ min (check latest data present)

## Drill automation

`scripts/drill-verify.sh` asserts the DR environment's health end-to-end and
prints a pass/fail summary — run it as the final gate of every drill.

## Recent drills

| Date | RTO | RPO | Result | Notes |
|---|---|---|---|---|
| (next quarterly drill) | | | | |
