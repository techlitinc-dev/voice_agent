# Deployment Notes

Companion to `05-deployment-runbook.md`. This repo's production layout and
gotchas that the generic runbook can't capture.

## Layout

| Path | Role |
|---|---|
| `docker-compose.prod.yml` | Production stack (app, worker, kb-reindex, db, redis, minio, caddy) |
| `docker-compose.scale.yml` | Horizontal scaling (extra workers, pgbouncer) — `--scale` |
| `docker-compose.ha.yml` | Patroni + Redis Sentinel HA reference topology |
| `docker-compose.observability.yml` | Prometheus / Grafana / Loki / Tempo / Alertmanager |
| `Caddyfile` | TLS + on-demand certs for white-label domains |
| `deploy/` | Tuning configs (postgres, sysctl, docker daemon) |
| `scripts/` | Deploy, backup, recovery, verification scripts |

## Env var mapping (runbook §3.2 → actual `.env`)

The runbook's generic names differ from the app's real ones — use these:

| Runbook says | Actual `.env` key |
|---|---|
| `NEXTAUTH_URL` | `APP_URL` / `APP_BASE_URL` |
| `NEXT_PUBLIC_APP_URL` | `NEXT_PUBLIC_APP_URL` |
| `POSTGRES_USER/PASSWORD/DB` | `DB_PASSWORD` (user/db fixed: `vaani`) |
| `MINIO_ENDPOINT/PORT/ACCESS_KEY/SECRET_KEY/BUCKET` | `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_RECORDINGS`, `MINIO_PASSWORD` |
| `VOBIZ_API_TOKEN` | `VOBIZ_AUTH_TOKEN` |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| `DOGRAH_API_URL` | `DOGRAH_BASE_URL` |
| `NEXT_PUBLIC_SENTRY_DSN` | not yet wired (Sentry is optional) |
| `JWT_SIGNING_KEY_V2` | `JWT_SIGNING_KEY_V1` (start with V1, rotate to V2 later) |

The full source of truth is `.env.example` — copy it, fill every `CHANGE_ME`,
and keep it gitignored. `docker-compose.prod.yml` reads secrets from `.env`
(env_file) plus the `DB_PASSWORD`/`MINIO_PASSWORD`/`DOMAIN` interpolation vars.

## Deploy flow

```bash
# Manual (from the VPS):
cd /home/vaani/voice_agent/vaani-ai
git pull
./scripts/deploy.sh                 # drain → migrate → recreate → verify

# Or via CI (push to main):
# .github/workflows/deploy.yml — test → build/push ghcr → SSH deploy
```

## TLS / DNS

- The `Caddyfile` auto-issues Let's Encrypt certs for `{$DOMAIN}` and on-demand
  for verified white-label domains.
- DNS: `app.vaani.ai A → VPS_IP`, `MX` + `SPF/DKIM/DMARC` per SMTP provider.
- `.env`: set `DOMAIN=app.vaani.ai` — Caddy reads it via compose interpolation.

## Post-deploy

Run `./scripts/deploy-verify.sh` immediately. Then monitor the first 24h:
Grafana populated, no Sentry spikes, Loki flowing, backups running, disk sane.

## Go-Live Gate

Before declaring production-ready, everything in the runbook's checklist
(§Go-Live Gate) must pass — hardening doc, observability stack, load test,
DR drill, smoke tests, TLS A+, DNS, secrets in Vault/SSM, rate limiting,
security headers, audit log, status page, incident runbook, on-call scheduled.
