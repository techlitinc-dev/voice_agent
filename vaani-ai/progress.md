# Progress — Phase 12: Production Deployment, Observability, Status Page, Scaling & Security Ops

Executing `/root/voice_agent/CRM-AI-V2/plan/12_production_deployment.md` exactly (project root: `/root/voice_agent/vaani-ai`).

## Status

| Step | Description | Status | Evidence |
|---|---|---|---|
| 1 | Health endpoint, status page, incidents.md, middleware patch, RUN_CRON guard | ✅ done | `/api/health` 200 JSON; `/status` public 200; `src/content/incidents.md`; middleware has `/status` + `/api/health` public; all 9 cron/setInterval registrations wrapped in `if (RUN_CRON)`; typecheck + build exit 0 |
| 2 | Alerting — alert.sh, health-watch.sh, mock receiver, T1/T2 | ✅ done | T1: `alert sent`, mock log `POST /alert {"text":"[vaani-ai ...] test alert from guide 12"}`; T2: `exit=1` with loud message; `.env.example` documents both vars (fixed a quoting bug in the guide's PAYLOAD line) |
| 3 | Dockerfile + .dockerignore + image build | ✅ done | `docker build -t vaani-app:latest .` → `naming to docker.io/library/vaani-app:latest`; created empty `public/` dir (guide assumed it existed) |
| 4 | docker-compose.prod.yml + Caddyfile + .env prod update | ✅ done | `compose valid`; all 6 env vars `<set>`; DOMAIN=localhost (operator gate: real domain + DNS needed) |
| 5 | Cron & service inventory | ✅ done | all node-cron schedules + 4 setIntervals guarded; `worker:kb` script + `scripts/check-trunk.sh` present |
| 6 | Migrate + launch prod stack | ✅ done | 7 containers Up (app healthy); `prisma migrate deploy` applied; seed complete (demo@vaani.ai / demo1234); http→308 redirect works; https://localhost handshake fails (operator gate — no real domain) |
| 7 | Prod smoke + health/status + H3 | ✅ done | smoke-test.sh **34/34 PASS** (prod profile, internal); health 200 `"status":"degraded"` (dograh false — expected pre-Step-9); /status 200 public; H3: redis stop→**503** `"status":"down"`, restart→**200** |
| 8 | Backups + restore drill + cron + log rotation | ✅ done | pg dump `vaani-20260806-101026.dump` (152K) + minio mirror 1 object; restore drill **54 tables**; 3 cron jobs installed; docker log rotation 50m×5 applied |
| 9 | Voice stack at production | ⚠️ PARTIAL | `DOGRAH_BASE_URL=http://host.docker.internal:8000` set; app wiring verified; **Dograh containers exited — UNREACHABLE** (dograh compose conflicts with prod ports 80/443/5432/6379/9000) — OPERATOR GATE |
| 10 | Observability (tracing, latency histogram, error budget) | ✅ done | `CallEvent.payload` persists full Dograh payload (sttMs/llmMs/ttsMs stored when Dograh reports them); latency histogram query works; error-budget table documented |
| 11 | Status page + uptime SLA | ✅ done (operator-gated) | `/status` 200 logged-out, shows "being configured" note; `STATUS_UPTIME_URL` empty (operator sets after creating Better Uptime/UptimeRobot page) |
| 12 | Security & encryption audit | ✅ done (S2/S3 operator) | S1: HTTP/2 via Caddy (internal 200); S2: SRTP/TLS on Vobiz trunk = operator confirm; S3: disk = plain ext4 (provider encryption decision); S4: `.env` git-ignored + 600, no live secrets in git, `.env.example` clean; S5: all 5 DRY_RUN flags present, safe defaults |
| 13 | Scaling — compose.scale.yml | ✅ done | applied → 3 worker containers (primary + 2 replicas), scaled workers log ready WITHOUT `[cron] schedules registered`; scaled back down cleanly |
| 14 | Go-live checklist | ✅ presented | 17 operator decisions — see FINAL REPORT in this file's conversation |
| 15 | Git checkpoint | ✅ done | `916cc14 phase 12: production — prod stack, on-demand TLS, health+status+alerting, backups, scaling, security ops` (8 phase commits total) |

## Code fixes / deviations from the guide

1. **`scripts/alert.sh` PAYLOAD line** — the guide's `${MSG//\"/\'}` bash-only substitution was malformed (bash parse error + `/bin/sh: Bad substitution`). Replaced with a POSIX-safe `sed "s/\"/'/g"` + `printf` so T1/T2 actually pass.
2. **`public/` directory missing** — the guide's Dockerfile COPYs `/app/public`, but no `public/` existed (not created in earlier phases). Created `public/.gitkeep` so the image builds.
3. **Prisma engine mismatch in Docker** — image built with `debian-openssl-1.1.x` engine (bookworm-slim detection) while runtime needed `3.0.x` → worker/kb-reindex crash-looped with P2021. Fixed by adding `binaryTargets = ["native", "debian-openssl-3.0.x"]` to `prisma/schema.prisma`; rebuilt; worker healthy.
4. **Caddyfile `on_demand_tls`** — current `caddy:2` (v2.11.4) dropped `interval` AND `burst` options; the bare `https://` catch-all block is invalid ("server block without any key"). Fixed: `on_demand_tls { ask ... }` (no interval/burst) + catch-all `https://* { tls { on_demand } ... }`. Validated with `caddy validate` and `caddy adapt` (confirmed `"on_demand":{"permission":{"endpoint":"http://app:3000/api/domain-ask"}}`).
5. **Caddy got no DOMAIN env** — compose `env_file: .env` did not pass `DOMAIN` into the caddy process env, so `{$DOMAIN}` was empty → block parsed as global. Added explicit `environment: DOMAIN: ${DOMAIN}` to the caddy service in `docker-compose.prod.yml`.
6. **`.env` updates** — guide's `sed -i "s/^DB_PASSWORD=.*/.../" .env 2>/dev/null || echo ...` silently no-ops when the var is absent (sed exits 0). Fixed by appending missing vars; `DATABASE_URL` kept at the dev value (guide does not change it); `S3_SECRET_KEY` synced to MINIO_PASSWORD.
7. **Dograh port conflict** — guide 12 Step 9 assumes Dograh runs on this VPS from guide 04; its compose publishes 80/443/5432/6379/9000-9001 which collide with the running prod stack. Dograh containers left exited (operator gate) — did NOT force-start to avoid breaking the live stack.

## Operator gates / deferred (need human action)

- **Real domain + DNS**: `DOMAIN=localhost` in `.env`; `dig` must return the VPS IP (65.20.76.84) after operator sets the A-record. External HTTPS (`curl https://<domain>/`) currently fails at TLS handshake because there is no real cert.
- **Dograh runtime**: bring up Dograh (resolve port plan vs. prod stack), then health shows `"dograh":true` / `"status":"ok"`.
- **Step 11 external uptime monitor** (Better Uptime/UptimeRobot): create account + public page → set `STATUS_UPTIME_URL` (+ `ALERT_SLACK_WEBHOOK_URL` for alert.sh paging).
- **S2**: confirm SRTP/TLS on the Vobiz production trunk in the Vobiz dashboard.
- **S3**: disk at-rest encryption — provider-managed or LUKS (procurement decision).
- **Step 14 go-live checklist**: 17 operator yes/no answers (flip CAMPAIGN_DRY_RUN etc. only after checklist).

## Notes / Deviations

- Project root is `/root/voice_agent/vaani-ai`; git repo top-level is `/root/voice_agent` (monorepo).
- Smoke test run in prod profile against `http://app:3000` inside the compose network (external TLS gated on real domain).
- `/api/health` returns `200` for "degraded" (db+redis ok) and `503` for "down" — per the route design.
