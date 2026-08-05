# Progress — Phase 08: Calls, Recordings, Analytics, Webhooks, Public API & Compliance

Executing `/root/voice_agent/CRM-AI-V2/plan/08_calls_recordings_analytics.md` exactly (project root: `/root/voice_agent/vaani-ai`).

## Status

| Step | Description | Status | Evidence |
|---|---|---|---|
| 0 | Env vars + deps verify | ✅ done | guide-08 vars appended; guide-01 keys present |
| 1 | Dependencies + vitest config verify | ✅ done | node-cron 3.0.3, nodemailer 6.9.16, googleapis 144.0.0, minio 8.0.2, recharts 2.13.3 |
| 2 | MinIO storage helpers + bootstrap | ✅ done | bucket ready: vaani-recordings (needed --env-file) |
| 3 | Analytics aggregation lib + tests | ✅ done | 12/12 pass |
| 4 | Calls list page (CDR) | ✅ done | typecheck 0 |
| 5 | FTS migration + query helper | ✅ done | migration applied; fts tests 4/4; seeded "cleaning" found |
| 6 | Call detail page | ✅ done | build 0; /calls, /calls/[id] |
| 7 | Recording ingestion worker job | ✅ done | ingested call_rec_test into MinIO (object size 8945229) |
| 8 | Analytics page + charts | ✅ done | build 0; /analytics |
| 9 | Real-time dashboard live tiles | ✅ done | live-stats 200 with cookie; auth enforced (307 anon) |
| 10 | Campaign reports | ✅ done | build 0; /analytics/campaigns |
| 11 | Agent performance page | ✅ done | build 0; /analytics/agents |
| 12 | QA rubrics + scorer + tests | ✅ done | 10/10 pass |
| 13 | Dead-air detection + tests | ✅ done | 5/5 pass |
| 14 | PII redaction + tests | ✅ done | 8/8 pass |
| 15 | Post-call processing worker jobs | ✅ done | call_qa_test: piiRedacted=t, deadAir=5, QA 36/40 dry-run-mock |
| 16 | Webhook delivery (HMAC + retries) | ✅ done | e2e: SUCCESS/200 + bad-secret PENDING/400 retry |
| 17 | Webhook settings UI | ✅ done | build 0; VIEWER webhooks:write → 403 |
| 18 | CSV exports + PDF report | ✅ done | export 200 w/ cookie, header + booked/362 row |
| 19 | Email digests + settings UI | ✅ done | digest tests 6/6 |
| 20 | Cost analytics & margins page | ✅ done | typecheck 0 |
| 21 | Retention policies + nightly cron | ✅ done | cron registered; dry-run logs, deletes nothing |
| 22 | GDPR data rights | ✅ done | export COMPLETED + resultKey; erasure COMPLETED, transcripts gone |
| 23 | Public REST API v1 | ✅ done | 5 routes; 200s / 401 / 403 / 429 burst all verified |
| 24 | TS SDK + API docs page | ✅ done | SDK smoke: fetched 2 calls; /settings/api-docs |
| 25 | Google Sheets export (OPERATOR GATE) | ✅ GATED | action returns "not configured" (envs empty — correct dev behavior) |
| 26 | Git checkpoint | pending | commit after this file |

## Notes / Deviations

- Project root is `/root/voice_agent/vaani-ai` (guide's `/root/vaani-ai` path maps here).
- Dev/build run with `unset NODE_ENV NODE_OPTIONS` (environment exports NODE_ENV=production which breaks Next middleware).
- `npx tsx scripts/*.ts` needs `--env-file=.env` (tsx does not auto-load .env) — bootstrap-minio required it.
- Step 7 recording test: substituted SoundHelix mp3 for the unreachable UIC sample URL (guide-sanctioned).
- Anonymous `/api/internal/` and `/api/exports/` requests return 307 (middleware redirect) not 401 — the middleware (guide 03) intercepts before the route; with a valid session the routes work (auth enforced).
- Guide's form-action server actions returning `{ok,...}` needed void-returning page-level wrappers (Next form-action type constraint): webhooks, digests, retention, gdpr, sheets.
- Several `let`→`const` and `&apos;`/`_match` lint fixes per repo eslint config (no logic change).
- GDPR erasure test erased the seeded demo call (guide-predicted); numbers now read `erased-gdpr_era`.
