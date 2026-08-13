# 04 — Disaster Recovery

> **Goal:** Define Recovery Time Objective (RTO) and Recovery Point Objective
> (RPO) for every component, and document the exact recovery procedure.

---

## 1. Objectives

| Component | RTO (max downtime) | RPO (max data loss) | Backup frequency |
|---|---|---|---|
| **PostgreSQL** (primary DB) | 15 min | 5 min | WAL archiving + 5-min base backups |
| **Redis** (queues + cache) | 30 min | 0 (AOF) or 1 min (RDB) | AOF every sec + RDB hourly |
| **MinIO** (recordings) | 1 hour | 1 hour | Bucket replication hourly |
| **Dograh** (voice engine) | 15 min | n/a (stateless) | Container image in registry |
| **Next.js app** | 5 min | n/a (stateless) | Container image in registry |

**Definitions:**
- **RTO** — how long until service is restored after a failure.
- **RPO** — how much data you can afford to lose.

---

## 2. Backup Strategy

### 2.1 PostgreSQL backups (critical)

**Three layers of protection:**

1. **WAL archiving (continuous)** — every transaction log shipped to off-site storage.
2. **Base backups (every 5 min)** — via `pgBackRest` or `pg_basebackup`.
3. **Logical dumps (daily)** — `pg_dump` for cross-version recovery.

```bash
# /opt/vaani/scripts/backup-pg.sh (new)
#!/bin/bash
set -euo pipefail
DATE=$(date +%Y%m%d_%H%M%S)
DUMP_FILE="/tmp/vaani_pg_${DATE}.sql.gz"

# Logical dump (gzip-compressed, inserts for faster restore)
pg_dump "$DATABASE_URL" \
  --format=custom \
  --compress=9 \
  --file="/tmp/vaani_pg_${DATE}.dump"

# Encrypt before upload (GPG)
gpg --batch --yes --passphrase-file /etc/vaani/gpg-pass \
  --symmetric "/tmp/vaani_pg_${DATE}.dump"

# Upload to off-site (S3 / B2 / another VPS)
aws s3 cp "/tmp/vaani_pg_${DATE}.dump.gpg" \
  "s3://vaani-backups/postgres/$(date +%Y/%m/%d)/"

# Cleanup local (keep last 3)
ls -t /tmp/vaani_pg_*.dump.gpg | tail -n +4 | xargs -r rm
```

Schedule via cron: `*/5 * * * * /opt/vaani/scripts/backup-pg.sh`

### 2.2 Retention policy

| Backup type | Retention | Storage |
|---|---|---|
| WAL archive | 7 days | Off-site S3 (Glacier) |
| Base backup (5-min) | 2 days | Off-site S3 (Standard) |
| Daily logical dump | 30 days | Off-site S3 (Standard) |
| Weekly logical dump | 90 days | Off-site S3 (Glacier) |
| Monthly logical dump | 1 year | Off-site S3 (Glacier Deep Archive) |

### 2.3 Redis persistence

```conf
# /etc/redis/redis.conf
appendonly yes                    # AOF — every write logged
appendfsync everysec              # balance durability vs performance
save 900 1                        # RDB snapshot: 1 write in 15 min
save 300 10                       # 10 writes in 5 min
save 60 10000                     # 10000 writes in 1 min
```

Also snapshot RDB to off-site hourly:

```bash
# /opt/vaani/scripts/backup-redis.sh
REDIS_HOST=127.0.0.1
DATE=$(date +%Y%m%d_%H%M%S)
redis-cli -h $REDIS_HOST BGSAVE
# wait for save to complete
while [ "$(redis-cli -h $REDIS_HOST LASTSAVE)" -le "$START" ]; do sleep 1; done
aws s3 cp /var/lib/redis/dump.rdb "s3://vaani-backups/redis/dump_${DATE}.rdb"
```

### 2.4 MinIO (recordings) backup

Enable **bucket replication** to a secondary MinIO or S3:

```bash
mc admin bucket add vaani-primary vaani-recordings \
  --remote-bucket vaani-recordings-dr \
  --replication "{'rule_id':'dr','status':'Enabled','priority':1,'delete_marker_replication':true}"
```

### 2.5 Configuration & secrets backup

- **Git** is the backup for code. Tag every release (`git tag v1.2.3`).
- **Secrets**: export Vault/SSM config to an encrypted GPG file weekly, store in off-site S3.
- **Docker Compose files**: committed to git in `deploy/`.

---

## 3. High Availability

### 3.1 PostgreSQL HA (Medium tier and above)

Use **Patroni** for automatic failover:

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│  PG Primary  │ ◀──▶ │  PG Replica  │ ◀──▶ │  PG Replica  │
│  (read-write)│      │  (read-only) │      │  (read-only) │
└──────┬───────┘      └──────┬───────┘      └──────┬───────┘
       │                     │                      │
       └─────────────────────┼──────────────────────┘
                             │
                    ┌────────▼────────┐
                    │  Patroni + etcd │  ← leader election
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   HAProxy / PG pooler │  ← routes to leader
                    └─────────────────┘
```

On primary failure: Patroni promotes a replica in < 10 seconds.

### 3.2 Redis HA

Use **Redis Sentinel** or **Redis Cluster**:

- **Sentinel**: 1 primary + 2 replicas + 3 sentinels (quorum). Sentinel promotes a replica on failure.
- **Cluster**: Sharded, for > 25GB datasets.

### 3.3 App-level HA

- Run **≥ 2 Next.js web containers** behind the load balancer.
- Run **≥ 2 worker containers**.
- Configure load balancer health check to `/api/health/ready` — remove unhealthy nodes.
- Use **drain mode** (existing `scripts/drain_web.sh`) for zero-downtime deploys.

---

## 4. Recovery Procedures

### 4.1 PostgreSQL point-in-time recovery

**Scenario**: Someone ran `DELETE FROM calls WHERE workspace_id = 'clxxx'` at 14:32.

```bash
# 1. Stop the app (prevent new writes)
docker compose stop web worker

# 2. Stop postgres
docker compose stop postgres

# 3. Restore latest base backup from before 14:32
aws s3 cp s3://vaani-backups/postgres/2026/08/07/vaani_pg_20260807_1425.dump.gpg /tmp/
gpg --decrypt /tmp/vaani_pg_20260807_1425.dump.gpg > /tmp/restore.dump
pg_restore --clean --if-exists -d vaani /tmp/restore.dump

# 4. Replay WAL up to 14:31:59 (just before the bad DELETE)
cat >> /var/lib/postgresql/recovery.signal <<EOF
restore_command = 'aws s3 cp s3://vaani-backups/wal/%f -'
recovery_target_time = '2026-08-07 14:31:59 IST'
recovery_target_action = 'promote'
EOF

# 5. Start postgres — it replays WAL and promotes
docker compose start postgres

# 6. Verify, then restart app
docker compose start web worker
```

### 4.2 Full DB loss recovery

**Scenario**: Primary VPS died, no replica.

```bash
# 1. Provision new VPS
# 2. Pull latest code
git clone https://github.com/techlitinc-dev/voice_agent.git
cd voice_agent/vaani-ai

# 3. Restore secrets
aws s3 cp s3://vaani-backups/secrets/env.production.gpg /tmp/
gpg --decrypt /tmp/env.production.gpg > .env

# 4. Restore latest DB backup
aws s3 cp s3://vaani-backups/postgres/$(date +%Y/%m/%d)/vaani_pg_latest.dump.gpg /tmp/
gpg --decrypt /tmp/vaani_pg_latest.dump.gpg > /tmp/restore.dump

# 5. Start services
docker compose -f docker-compose.prod.yml up -d

# 6. Restore DB
docker compose exec postgres pg_restore --clean -U vaani -d vaani /tmp/restore.dump

# 7. Re-run pending migrations
docker compose exec web npx prisma migrate deploy

# 8. Verify health
curl https://app.vaani.ai/api/health/deep
```

### 4.3 Redis loss recovery

Redis loss = queued jobs are gone, but **no persistent business data is lost**
(all state of record is in Postgres). Recovery:

```bash
# 1. Restore from latest RDB
aws s3 cp s3://vaani-backups/redis/dump_latest.rdb /var/lib/redis/dump.rdb
docker compose restart redis

# 2. Re-enqueue any in-flight jobs (campaigns check their own state and re-dial)
docker compose exec worker tsx src/worker/cron.ts
```

### 4.4 MinIO loss (recordings)

```bash
# Enable MinIO server on new host, then sync from DR bucket
mc mirror s3/vaani-recordings-dr vaani-new/vaani-recordings
```

### 4.5 Dograh engine loss

Dograh is stateless (all state is in its own PG). Recovery:

```bash
cd dograh
docker compose -f docker-compose.yaml up -d
# Re-import published workflows by re-publishing each PUBLISHED agent
# (the app's prisma/seed or a re-publish script can do this)
```

---

## 5. Disaster Recovery Drills

**Quarterly DR drill** (mandatory):

1. Spin up a parallel "DR" environment using only backups (no access to prod).
2. Restore DB to the DR environment.
3. Run the manual test suite (see [manual-testing/](../manual-testing/)) against DR.
4. Measure actual RTO — how long from "go" to "system functional".
5. Document findings; fix gaps; update this document.

### Drill checklist

- [ ] Restore DB from backup → success?
- [ ] Restore Redis from backup → success?
- [ ] Restore MinIO from DR bucket → success?
- [ ] App starts and passes `/api/health/deep`?
- [ ] Can log in, view dashboard, make a test call?
- [ ] RTO measured: _____ min
- [ ] RPO verified: _____ min (check latest data present)

---

## 6. Incident Response

### Severity levels

| Severity | Definition | Response | Examples |
|---|---|---|---|
| **SEV1** | Total outage or data loss | Page on-call immediately; all-hands | DB down, payment system down |
| **SEV2** | Major feature broken | Page on-call; resolve in business hours | Calls failing for one tenant, billing broken |
| **SEV3** | Minor feature degraded | Slack alert; fix in next sprint | Slow analytics, a non-critical webhook failing |
| **SEV4** | Cosmetic / minor bug | Ticket | UI glitch, typo |

### SEV1 response runbook

1. **Acknowledge** the page (PagerDuty) within 5 min.
2. **Assess**: check Grafana, Sentry, Loki for the cause.
3. **Communicate**: post in `#incidents` Slack, update status page.
4. **Mitigate**: rollback deploy / failover DB / scale up / block traffic.
5. **Resolve**: apply fix, verify health checks pass.
6. **Postmortem**: within 48h, blameless doc covering timeline, root cause, action items.

### Postmortem template

```markdown
# Incident YYYY-NNN — <title>

**Date:** 2026-08-07
**Severity:** SEV1
**Duration:** 47 minutes

## Summary
<one paragraph>

## Timeline (IST)
- 14:32 — Alert fired (HighErrorRate)
- 14:35 — On-call acknowledged
- 14:40 — Root cause identified (bad migration)
- 14:50 — Rollback deployed
- 15:19 — Service recovered

## Root cause
<detailed technical explanation>

## Impact
- <N> tenants affected
- <N> calls dropped
- ₹<X> revenue impact

## Action items
- [ ] Add migration test to CI (owner: ___ , due: ___)
- [ ] Add alert for <pattern> (owner: ___ , due: ___)
```

---

## Next

→ [05 — Deployment Runbook](05-deployment-runbook.md)