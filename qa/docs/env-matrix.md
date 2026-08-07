# Environment Configuration Matrix

## Tier 1 — Unit (Phase 1)

| Var | Value | Notes |
|-----|-------|-------|
| `DATABASE_URL` | (unused — DB mocked) | vitest mocks prisma client |
| `REDIS_URL` | (unused) | BullMQ mocked in unit tests |
| `S3_ENDPOINT` | (unused) | MinIO mocked |
| `DOGRAH_BASE_URL` | (unused) | dograh client mocked |
| `CAMPAIGN_DRY_RUN` | `true` | no real dials, no OpenRouter spend |
| `QA_DRY_RUN` | `true` | deterministic mock scores |
| `RETENTION_DRY_RUN` | `true` | log-only deletion |
| `VAANI_DRY_RUN` / `WHATSAPP_DRY_RUN` / `CRM_PUSH_DRY_RUN` | `true` | no external side effects |
| `DOGRAH_RETRY_DELAY_MS` | `1` | tests set 1 for speed |

## Tier 2 — Integration / E2E / Perf / Security (Phases 2–5)

Real Postgres (vaani + test_db), real Redis, real MinIO, real HTTP.

| Var | Value |
|-----|-------|
| `DATABASE_URL` | `postgresql://vaani:vaani_dev_password@localhost:5432/vaani` (vaani) |
| dograh `.env.test` `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@localhost:5432/test_db` |
| `REDIS_URL` | `redis://localhost:6379` (vaani), `redis://:redissecret@localhost:6379/0` (dograh test) |
| `S3_ENDPOINT` | `http://localhost:9000` |
| `DOGRAH_BASE_URL` | `http://127.0.0.1:8000` |
| `DOGRAH_API_KEY` | `test-key` |
| `DOGRAH_WEBHOOK_SECRET` | `test-secret` |
| `SESSION_SECRET` | 32-byte random (from `.env`) |
| `PUBLIC_API_RATE_LIMIT` | `120` |
| `E2E_BASE_URL` | `http://127.0.0.1:3000` |
| `CAMPAIGN_DRY_RUN` | `true` (keep external calls mocked) |

## Tier 3 — Production Readiness (Phase 6)

Prod-like stack: `docker compose -f docker-compose.prod.yml` (vaani) and the
dograh stack (`remote_up.sh`) with real `.env` secrets. `DEPLOYMENT_MODE=oss` or
SaaS with `CORS_ALLOWED_ORIGINS` allowlist. `ENABLE_SIGNUP` per install.
Rollback smoke runs in `SMOKE_DRY_RUN=1` (no real rebuild).

## Tier 4 — Continuous (Phase 7)

| Var | Default | Notes |
|-----|---------|-------|
| `VAANI_HEALTH_URL` | `http://127.0.0.1:3000/api/health` | override with prod URL |
| `DOGRAH_HEALTH_URL` | `http://127.0.0.1:8000/api/v1/health` | override with prod URL |
| `CONTINUOUS_CYCLES` | `3` | `0`/large = run forever |
| `MAX_CRITICAL_BEFORE_ROLLBACK` | `3` | consecutive failures |

## Non-secret secrets (test-only)

- `SESSION_SECRET=test-secret-32-bytes-xxxxxxxxxxxxxxxx` (test tier)
- `DOGRAH_API_KEY=test-key`
- `DOGRAH_WEBHOOK_SECRET=test-secret`
- `OSS_JWT_SECRET` (dograh) — set in `.env.test` (`test-dograh-devops-secret` per `.env.test.example`)

## Gate rules

- Phase 1–2: run on every commit (CI).
- Phase 3: run on merge to `main`.
- Phase 4: run nightly + on release candidates.
- Phase 5: run nightly + on any auth/billing change.
- Phase 6: run on release candidates (tagged).
- Phase 7: runs forever in prod via cron/systemd.
