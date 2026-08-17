# Recovery Runbooks

Companion to `04-disaster-recovery.md`. Each runbook assumes the operator has
shell access to the host and the off-site backup bucket (`s3://vaani-backups`,
or the `AWS_S3_ENDPOINT` configured in `.env`).

Automation lives in `scripts/`:

| Script | Purpose |
|---|---|
| `backup-pg.sh` | 5-min logical dump → GPG → off-site S3, local keep-3 |
| `restore-pg.sh` | Full restore from a dump (or `latest`) |
| `restore-pg-pitr.sh` | Point-in-time recovery via base backup + WAL replay |
| `backup-redis.sh` | Hourly RDB snapshot → off-site S3 |
| `backup-secrets.sh` | Weekly encrypted `.env` snapshot |
| `setup-minio-replication.sh` | Configure bucket replication to a DR MinIO |
| `drain-web.sh` | Zero-downtime node drain before deploys |

---

## 4.1 Point-in-time recovery (bad DELETE / UPDATE)

```bash
# Find the last backup taken BEFORE the bad statement (14:32 in the doc example)
aws s3 ls s3://vaani-backups/postgres/ --recursive | sort | tail -20

# Run the PITR script (recovery time is IST, exclusive of the bad statement)
scripts/restore-pg-pitr.sh \
  s3://vaani-backups/postgres/2026/08/07/vaani_pg_20260807_1425.dump.gpg \
  "2026-08-07 14:31:59 IST" \
  vaani-db-prod
```

The script: stops app → stops PG → restores base dump → appends `recovery.signal`
(restore_command to the WAL bucket, `recovery_target_time`, promote) → starts PG
which replays WAL and promotes → starts app.

Verify: `curl https://<domain>/api/health/deep` and spot-check the recovered rows.

## 4.2 Full DB loss (VPS died, no replica)

```bash
# 1. New VPS, pull code
git clone https://github.com/techlitinc-dev/voice_agent.git && cd voice_agent/vaani-ai

# 2. Restore secrets
scripts/restore-secrets.sh   # fetch + decrypt env.production.latest.gpg → .env

# 3. Restore latest DB backup
scripts/restore-pg.sh latest

# 4. Start services + run pending migrations
docker compose -f docker-compose.prod.yml up -d
docker compose exec web npx prisma migrate deploy

# 5. Verify
curl https://<domain>/api/health/deep
```

## 4.3 Redis loss

Redis holds queues + cache only — no state of record is lost.

```bash
# Restore the latest RDB snapshot
aws s3 cp s3://vaani-backups/redis/dump_latest.rdb /tmp/dump.rdb
docker cp /tmp/dump.rdb vaani-redis-prod:/data/dump.rdb
docker compose -f docker-compose.prod.yml restart redis

# In-flight campaign dials are re-enqueued by the workers' own state checks
# (campaigns re-dial from CampaignContact rows; the scheduler tick re-runs).
docker compose -f docker-compose.prod.yml logs --tail=50 worker
```

## 4.4 MinIO loss (recordings)

```bash
# On the new MinIO host, mirror from the DR bucket
mc alias set vaani-new https://minio.vaani.ai <user> <pass>
mc alias set vaani-dr  https://minio-dr.vaani.ai <user> <pass>
mc mirror --overwrite vaani-dr/vaani-recordings-dr vaani-new/vaani-recordings

# Re-enable replication once live
scripts/setup-minio-replication.sh https://minio.vaani.ai primary https://minio-dr.vaani.ai dr
```

## 4.5 Dograh engine loss

Dograh is stateless (state lives in its own Postgres).

```bash
cd dograh && docker compose -f docker-compose.yaml up -d

# Re-import published workflows: re-publish each PUBLISHED agent from the app.
# Prisma seed creates the agents; publishing pushes workflows to Dograh.
cd ../vaani-ai && npx prisma db seed   # if agents are missing
# Then re-publish via the UI (Agents → Publish) or a re-publish script.
```

---

## Verification checklist (after ANY recovery)

- [ ] `curl https://<domain>/api/health` → `"status":"ok"`
- [ ] `curl https://<domain>/api/health/deep` → `"status":"ok"` (secrets + migrations + MinIO + Dograh)
- [ ] Log in, view dashboard, make a test call
- [ ] Spot-check the recovered data (the exact rows from the incident)
- [ ] Confirm backup scripts still run: `scripts/backup-pg.sh && scripts/backup-redis.sh`
