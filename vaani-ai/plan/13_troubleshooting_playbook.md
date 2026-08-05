# 13 — Troubleshooting Playbook

> **How to use this file:** when Hermes reports a FAIL or you hit a wall, find the
> symptom below, paste the relevant row(s) into Hermes, and have it apply the fix.
> Each entry is written as: **Symptom → Likely cause → Exact fix → How to verify.**
> If nothing matches, Hermes' instruction is: gather the exact command, full error
> output, and the last 40 lines of the relevant log — and report (§N). Do NOT
> improvise large refactors to escape an error.

**Log cheat sheet (referenced everywhere below):**

| What | Where |
|---|---|
| Dev server | `/tmp/next-dev.log` |
| Worker (dialer + crons) | `/tmp/worker.log` |
| Prod app/worker | `docker logs vaani-app --tail 40` / `docker logs vaani-worker --tail 40` |
| Dograh | `cd /root/dograh && docker compose logs --tail 60` |
| Caddy | `docker logs vaani-caddy --tail 40` |
| SIP trunk cron | `/var/log/vaani-trunk.log` |
| Webhook test receiver | `/tmp/receiver.log`, `/tmp/e2e-webhook.log` |
| Playwright E2E | `e2e/test-results/` (screenshots + trace.zip) |

---

## A. Setup & Infrastructure (guide 01)

**A1. `docker compose ps` shows a container `Restarting`**
→ Cause: bad env value or port conflict.
→ Fix: `docker compose logs <service> --tail 40`. For port conflicts:
`ss -tlnp | grep -E '5432|6379|9000'` — if a host process owns the port, stop it
(`systemctl stop postgresql` / `redis-server` are the usual squatters on fresh VPS).
→ Verify: `docker compose up -d && docker compose ps` → `Up (healthy)`.

**A2. `npx create-next-app` hangs or asks questions**
→ Cause: interactive prompt despite flags (TTY weirdness).
→ Fix: press Ctrl+C, re-run the EXACT command from guide 01 Step 7 with
`CI=true` prefixed: `CI=true npx --yes create-next-app@14.2.15 . ...`
→ Verify: `package.json` exists with `next` dependency.

**A3. `npm install` fails with `ERESOLVE` peer dependency errors**
→ Cause: a registry-side peer bump.
→ Fix: re-run the same command with `--legacy-peer-deps` appended. Record the
deviation in the report.
→ Verify: `npm ls next react` → exact pinned versions.

**A4. Node version is wrong (v18/v22)**
→ Cause: distro package shadowed NodeSource.
→ Fix: `apt-get remove -y nodejs && apt-get install -y nodejs` after re-running the
NodeSource setup script from guide 01 Step 5. Never "fix" this by switching to nvm
mid-project.
→ Verify: `node --version` → `v20.x`.

**A5. `ufw` enabled and now SSH is at risk**
→ NEVER disable ufw to fix connectivity. `ufw allow 22/tcp` FIRST, always.
→ Verify: `ufw status` lists 22/tcp before any other change.

**A6. `npx playwright install --with-deps chromium` fails on the VPS**
→ Cause: apt lists stale, or download blocked by egress rules.
→ Fix: `apt-get update` then retry once. If the browser download is blocked, set
`PLAYWRIGHT_DOWNLOAD_HOST` per the error message, retry once.
→ Verify: `npx playwright test --config=e2e/playwright.config.ts --list` prints the spec list.

---

## B. Database & Prisma (guide 02)

**B1. `prisma migrate dev` → `P1001 Can't reach database server`**
→ Cause: db container down or wrong `DATABASE_URL`.
→ Fix: `docker compose up -d db && sleep 10`; confirm `.env` has
`postgresql://vaani:vaani_dev_password@localhost:5432/vaani` (dev) — in prod
containers the host is `db`, not `localhost`.
→ Verify: `npx prisma migrate status` → "up to date".

**B2. `Unique constraint failed` during seed**
→ Cause: seed ran twice (createMany isn't idempotent for contacts).
→ Fix (dev only): `npx prisma migrate reset --force && npm run prisma:seed`.
→ Verify: seed prints the credentials block (`demo@vaani.ai / demo1234`).

**B3. `prisma generate` types missing (`@prisma/client` has no `agent`)**
→ Cause: client not regenerated after schema change.
→ Fix: `npx prisma generate` then restart the dev server.
→ Verify: `npm run typecheck` exit 0.

**B4. Prod: `prisma migrate deploy` says database schema is not empty / drift**
→ Cause: someone ran `migrate dev` against prod.
→ Fix: STOP. Report output of `npx prisma migrate status`. Resolution is
case-by-case — do NOT run `--force` anything against prod without operator sign-off.

**B5. Schema smoke fails on one check (`scripts/schema-smoke.ts`)**
→ Cause: the check number names the model group (guide 02 Step 6 maps numbers →
models) — usually a stale migration or a hand-edited schema.
→ Fix: `npx prisma migrate dev && npx prisma generate`, re-run the smoke script.
If the schema itself was edited outside guide 02, revert the edit — guide 02 is
authoritative.
→ Verify: `SCHEMA SMOKE: 33/33 checks passed`.

**B6. Hand-written SQL inserts silently break `@updatedAt`**
→ Cause: raw SQL (`docker exec … psql -c "INSERT …"`) bypasses Prisma's
`@updatedAt` auto-update — rows get NULL/wrong `updatedAt`, which breaks
`orderBy: { updatedAt: "desc" }` listings and BullMQ claim queries.
→ Fix: always include `"createdAt"=now(), "updatedAt"=now()` (and any other
no-default column) in operator SQL. The guides' own SQL blocks already do this —
copy their pattern, don't ad-lib column lists.
→ Verify: `SELECT "updatedAt" FROM "<Model>" ORDER BY 1 DESC NULLS LAST LIMIT 1;`
shows a fresh timestamp.

---

## C. Auth, SSO & API keys (guide 03)

**C1. Login succeeds but immediately redirects back to /login**
→ Cause: cookie not sticking — `secure` cookie over http, or clock skew.
→ Fix: dev over plain http needs `NODE_ENV=development` in `.env` (secure flag is
production-only by design). Check server clock: `date` vs real time.
→ Verify: login → dashboard renders workspace name.

**C2. `SESSION_SECRET missing or too short`**
→ Cause: `.env` not loaded or placeholder not replaced.
→ Fix: guide 01 generated it — re-run:
`sed -i "s/CHANGE_ME_openssl_rand_hex_32/$(openssl rand -hex 32)/" .env` and restart.
→ Verify: `grep -c CHANGE_ME .env` → only provider keys remain.

**C3. "UNAUTHENTICATED" thrown inside a server action but user IS logged in**
→ Cause: usually a page wrapped the call in a try that swallowed the real error.
→ Fix: check dev server log for the true underlying error; actions return
`{ ok:false }` by design — the page must display `error`.
→ Verify: reproduce with dev log visible.

**C4. TOTP login: "pending-2FA token" expired / invalid after entering the code**
→ Cause: the pending token issued after the password step is short-lived; the user
(or E2E test) sat on the code form too long.
→ Fix: start the login over and enter the TOTP promptly. In Playwright, generate
the code with `authenticator.generate(secret)` immediately before submitting
(guide 11's auth.spec does exactly this, with one retry across the 30s boundary).
→ Verify: login completes within one attempt.

**C5. Backup codes exhausted / all rejected**
→ Cause: each backup code works ONCE; the set is consumed.
→ Fix: while still logged in, disable + re-enable 2FA in /settings/security to
mint a fresh set. If fully locked out (operator-approved, dev/staging only):
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "UPDATE \"User\" SET \"totpSecret\"=NULL, \"totpEnabledAt\"=NULL, \"totpBackupHashes\"='{}' WHERE email='<user-email>';"
```
then the user logs in with password only and re-enrolls. Report the incident.
→ Verify: user can log in and sees 2FA disabled.

**C6. SSO: OIDC start/callback fails with 502 or "discovery failed"**
→ Cause: the IdP's discovery URL is unreachable from the VPS (DNS/egress) or
`OIDC_ISSUER` is mistyped (trailing slash counts).
→ Fix: `curl -sI "$OIDC_ISSUER/.well-known/openid-configuration"` FROM THE VPS.
Fix DNS/egress or the issuer value; restart the app.
→ Verify: the curl returns 200 JSON; SSO login round-trips.

**C7. SSO callback error: IdP did not return an email claim**
→ Cause: the IdP didn't include `email` in scope/claims (common with default SAML/
OIDC attribute maps).
→ Fix: in the IdP, add the `email` scope/attribute mapping; or set the claim-name
override env documented in guide 03's env block if the IdP uses a nonstandard
claim. Do NOT synthesize emails from the subject id.
→ Verify: callback logs show an email; user lands on /dashboard.

**C8. API-key IP allowlisting fails behind Caddy (or every client looks like the proxy)**
→ Cause: the app reads `x-forwarded-for` — behind Caddy that's correct, but a
client can ALSO spoof XFF if Caddy passes it through untouched.
→ Fix: Caddy must strip/replace inbound `X-Forwarded-For` (the prod Caddyfile in
guide 12 does); never trust XFF except from the Caddy hop. When testing
allowlists, curl through Caddy, not directly at :3000.
→ Verify: allowlist blocks/permits by the REAL client IP (check request logs).

**C9. Invite accept fails: "invite email mismatch"**
→ Cause: the logged-in account's email ≠ the invited email — by design.
→ Fix: log in with the invited email (or register it), or revoke + re-invite the
correct address.
→ Verify: `invite-accept-button` lands the user in the workspace.

**C10. Cannot demote/remove an owner: "last owner" error**
→ Cause: last-owner protection — a workspace must always have ≥ 1 OWNER.
→ Fix: promote another member to OWNER first, then demote.
→ Verify: members table shows the new owner; demotion succeeds.

**C11. Build error: `useSearchParams() should be wrapped in a suspense boundary` (login page)**
→ Cause: Next 14 requires a Suspense boundary around `useSearchParams` in pages.
→ Fix: wrap the client component using it in `<Suspense>` exactly as guide 03's
login page shows (the page file already does this — if you re-created the page
without the wrapper, re-copy guide 03's version).
→ Verify: `npm run build` exit 0.

**C12. SAML enterprise SSO errors after "configuring the provider"**
→ Cause: v1 SAML is an OPERATOR GATE delegated to a managed provider (WorkOS/Auth0)
— there is no raw SAML SP in the codebase. Misconfig symptoms are therefore on the
BRIDGE: wrong `SAML_ENTRY_POINT`/`SAML_ISSUER`/`SAML_CERT` (guide 01 env block) or
the provider's connection not mapped to the workspace's domain.
→ Fix: confirm the managed-provider dashboard connection (domain → IdP) and re-paste
the three env vars exactly (x509 cert whitespace/line breaks count — use the
single-line PEM form guide 01 documents), restart the app. If the provider bridge
itself was never set up, that is the gate — see guide 11 Step 8 backlog #1; do NOT
start writing a SAML SP.
→ Verify: the enterprise user's IdP login round-trips to /dashboard; an unknown
domain still falls back to password login.

---

## D. Voice stack — Dograh / Vobiz / Sarvam / OpenRouter (guide 04)

**D1. Dograh containers won't start**
→ Fix: `cd /root/dograh && docker compose logs --tail 60`. Missing env var is cause
#1 — compare `.env` against the repo's `.env.example` key by key.
→ Verify: health endpoint 200 (guide 04 Step 2).

**D2. Calls connect but AI is silent / no transcription**
→ Cause (most likely): Sarvam key wrong or out of credit; less often: OpenRouter key.
→ Fix: `docker compose logs | grep -i -E "sarvam|openrouter|401|403|429"`. Re-check
keys with the guide 04 Step 0 curl tests. Top up credits if 402/429.
→ Verify: a new test call produces transcript lines in Dograh logs.

**D3. Latency is awful (multi-second pauses)**
→ Cause: non-streaming path, a slow LLM model, or the VPS is far from Sarvam/Vobiz
edges (region).
→ Fix: switch the agent's LLM to a faster model (Gemini Flash / Llama via `:nitro`),
confirm Dograh streaming is enabled per its docs; check VPS CPU steal with `htop`.
→ Verify: greeting plays within ~2s of pickup.

**D4. Our webhook never receives events**
→ Cause: the workflow's webhook node points at an unreachable `endpoint_url` — it is
built from `APP_URL` in `buildWorkflowDefinition` (guide 04 Step 5). In dev, Dograh
(in Docker) cannot reach `http://localhost:3000` — use
`host.docker.internal` (guide 12 Step 6) or the LAN IP; in prod `APP_URL` must be the
public https domain. Also check the workflow was re-published after `APP_URL` changed.
→ Fix: correct `APP_URL` in `.env`, re-publish the agent (guide 05), then simulate
with the signed curl from guide 04 Step 7 to prove our side works.
→ Verify: simulation inserts a CallEvent row; next real call appears in `/calls`.

**D5. `{"ok":true,"ignored":"unknown destination number"}` on real inbound calls**
→ Cause: the DID as dialed doesn't match the `PhoneNumber.number` string — usually
E.164 formatting (Vobiz may send `9180...` without `+`).
→ Fix: register the number in the exact format observed in the Dograh event payload
(check a CallEvent raw payload), or normalize in the webhook (minimal change; report
deviation).
→ Verify: next call creates a Call row.

**D6. Dograh create/update workflow → `422` on unknown builder keys**
→ Cause: our workflow definition includes keys the LIVE Dograh version's schema
rejects (the schema drifts between Dograh releases).
→ Fix — the strip-keys procedure: remove ONLY the key(s) named in the 422 response
body from the definition (guide 04 shows this pattern — never redesign the
definition). If the rejected keys are the builder "hints" block, set
`WORKFLOW_HINTS=false` in `.env` (guide 05 — the builder then omits them; the
prompt still carries the same instructions) and re-publish.
→ Verify: create/publish returns a workflow id; `npm test` stays green (the unit
tests encode the contract — update them ONLY if the guide says so).

**D7. Vobiz calls → `404` on WhatsApp or account-info paths**
→ Cause: Vobiz endpoint paths differ per account/API version — our defaults
(`VOBIZ_WHATSAPP_PATH=/v1/whatsapp/messages`, the account-info path in
`check-trunk.sh`) are unconfirmed OPERATOR GATES.
→ Fix: confirm the real paths in https://vobiz.ai/docs, then set
`VOBIZ_WHATSAPP_PATH` (and the account-path override documented in guide 04's env
block) in `.env`; restart app + worker.
→ Verify: the guide 04 vobiz curl returns 2xx; `scripts/check-trunk.sh` exits 0.

**D8. `POST /api/mcp` with the right key → `503 DOGRAH_MCP_URL not configured`**
→ This is the DESIGNED state while the MCP OPERATOR GATE is open — not a bug.
→ Fix (to close the gate): enable MCP in Dograh (docs.dograh.com/integrations/mcp.md),
note the internal URL, set `DOGRAH_MCP_URL` in `.env`, restart the app.
→ Verify: the same curl now proxies the Dograh JSON-RPC response (200). No-key and
wrong-key calls must STILL be 401.

**D9. Branding logos / uploaded assets 403 from MinIO (`vaani-assets`)**
→ Cause: the `vaani-assets` bucket lost its public-read policy (logos are served
via presign-less URLs by design).
→ Fix: re-run `npx tsx scripts/bootstrap-minio.ts` — it sets public-read on
`vaani-assets` ONLY. Never apply public policy to `vaani-recordings`.
→ Verify: the logo `<img>` loads; recordings still require presigned URLs.

**D10. `check-trunk.sh` cron alerts but calls work fine (false alarm)**
→ Cause: the account-info probe path doesn't match this Vobiz account (D7), so the
probe 404s while the SIP trunk itself is healthy.
→ Fix: set the account-path override (D7); until confirmed, treat trunk alerts as
WARN — verify with a real test call before paging anyone.
→ Verify: `scripts/check-trunk.sh; echo $?` → 0 with a live trunk.

**D11. Browser test-run creation → `404` from Dograh**
→ Cause: Dograh's test-run endpoint path differs per version (the `PATHS` map in
`src/lib/dograh.ts` targets the documented one).
→ Fix: check the LIVE Dograh OpenAPI (`curl $DOGRAH_API_URL/openapi.json | grep -i
test`), update the single `PATHS.testRun` entry in `src/lib/dograh.ts`, re-run
`npx vitest run src/lib/dograh.test.ts` (it encodes the map), retry once, then STOP
and report the path you found.
→ Verify: `agent-test-call-btn` creates a run and opens the browser call.

**D12. "Advanced editor" deep link 404s in the Dograh UI**
→ Cause: Dograh UI route mismatch — the deep link assumes a route the installed
Dograh version renamed.
→ Fix: open `DOGRAH_UI_URL`, click into the workflow manually, note the real route,
and update the deep-link builder (guide 05 Step — one function). Report the route.
→ Verify: the button lands on the workflow in the Dograh UI.

---

## E. Agent builder & integrations (guide 05)

**E1. Publish fails with "voice engine unreachable" / Dograh down**
→ Cause: Dograh containers stopped, or `DOGRAH_API_URL`/`DOGRAH_API_KEY` wrong.
→ Fix: `cd /root/dograh && docker compose up -d && sleep 15`; re-check the guide 04
health curl; then re-publish from the editor. The agent stays DRAFT — nothing is
half-written on our side (safe to retry).
→ Verify: `version-history-table` gains a PUBLISHED row with a Dograh workflow id.

**E2. KB URL document stuck in `FAILED`**
→ Cause: the URL was unreachable, blocked the fetch, or returned non-HTML.
→ Fix: `curl -sIL <url>` from the VPS — fix the URL, then use the row's **Re-index**
button (`kb-reindex-*`). For content you can't fetch (login-walled pages), paste the
text as an FAQ doc instead. Text docs index synchronously — if a TEXT doc is FAILED,
that's a bug: STOP and report.
→ Verify: `kb-status-*` flips to INDEXED.

**E3. CRM/calendar OAuth callback: "invalid state"**
→ Cause: OAuth state cookie expired/mismatched (user took >10 min), clock skew, or
the redirect URI registered at the provider ≠ our callback URL.
→ Fix: retry the connect flow in one sitting; check `date` on the VPS; compare the
provider console's redirect URI with `APP_URL` + the guide 05 callback path exactly
(https vs http counts).
→ Verify: connection row appears in /settings/integrations.

**E4. Salesforce / LeadSquared / Freshsales / Pipedrive throw "gate" errors**
→ EXPECTED behavior — these 4 adapters are stubs by design (guide 11 backlog #10).
→ Fix: none in code. When a customer needs one: create the provider OAuth app, add
creds to `.env` per guide 05's env block, implement the adapter per the stub's
TODO, and close the gate.
→ Verify (gate open): the error message names the provider + "not configured".

**E5. `WORKFLOW_HINTS=false` — when to use it**
→ Symptom: Dograh 422s on the workflow-hint keys during publish.
→ Fix: set `WORKFLOW_HINTS=false` in `.env`, restart, re-publish. The builder omits
the hint keys; the agent prompt still carries the same instructions (see D6).
→ Verify: publish succeeds; `npx vitest run tests/workflow-builder.test.ts` green.

**E6. `/api/tools/execute` (and similar tool routes) 307-redirect to /login instead of running**
→ Cause: the route is missing from the middleware's API prefix list — Next
middleware treats it as a protected PAGE and issues the login redirect instead of
letting the route handler enforce its own auth (guide 05 Step 12 patched the
middleware matcher for exactly this).
→ Fix: apply guide 05 Step 12's middleware patch — the `/api/tools/:path*` prefix
must be in the API branch (route handlers return 401 JSON; only pages redirect).
Re-check any NEW api route you add against the same list.
→ Verify: `curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3000/api/tools/execute -d '{}'`
→ `401` (or the route's own auth response), NEVER `307`.

---

## F. Inbound receptionist & live ops (guide 06)

**F1. Simulated call completes but outcome/sentiment are generic defaults**
→ Cause: `OPENROUTER_API_KEY` absent/invalid — the post-call extractor deliberately
falls back to defaults instead of crashing.
→ Fix: set a valid OpenRouter key in `.env`, restart app + worker, re-fire the
simulation.
→ Verify: outcome reflects the transcript (e.g. `booked`), sentiment set.

**F2. Spam filter let an obvious spammer through**
→ Cause: the filter is FAIL-OPEN by design (a broken blocklist must never drop real
customers) — check for a filter error in the log first.
→ Fix: if there's a DB error in `/tmp/next-dev.log`, fix that. If the number simply
isn't in any list, add it via the DNC UI (`MANUAL` source).
→ Verify: resolver returns `"blocked":true` for the number (guide 06 T3).

**F3. Missed call produced NO callback task (or TWO)**
→ Cause (none): the missed-call event didn't match a configured number/agent, or the
dedupe unique constraint silently dropped a duplicate (by design — one task per
caller per window).
→ Fix: check the CallEvent row exists and the number maps to a workspace; query
`CallbackTask` for the caller. Duplicates are the dedupe working — not a bug.
→ Verify: exactly one `CallbackTask` per missed caller per window.

**F4. "Where did the callback-dial job go?" — not in the DB**
→ Cause: BullMQ delayed jobs live in REDIS, not Postgres.
→ Fix: `docker exec vaani-redis redis-cli KEYS 'bull:*callback*'` and
`HGETALL` a job hash to inspect its delay/payload.
→ Verify: the job fires at `scheduledFor` (worker log shows the dial attempt).

**F5. Whisper text sent but the AI ignores it on a REAL call**
→ Cause: whisper = LLM CONTEXT injection (works on the next turn). Mid-call AUDIO
injection is a Dograh capability gate (guide 11 backlog #3) — if Dograh has no such
API, there is no audio whisper; do not build one ad hoc.
→ Fix: confirm expectations with Script E in guide 11 Step 6; confirm the
`LiveCallState.whisperContext` row updated; the AI should use the hint within 1–2 turns.
→ Verify: transcript shows the hint influencing the reply.

---

## G. Campaigns & worker (guide 07)

**G1. Worker log shows `ECONNREFUSED 6379`**
→ Fix: Redis down — `docker compose up -d redis` (dev) /
`docker compose -f docker-compose.prod.yml up -d redis` (prod).
→ Verify: `worker ready — waiting for campaigns` in log.

**G2. Campaign RUNNING but nothing dials**
→ Checklist in order: (1) worker process actually running? (2) campaign inside
calling window? (test with 00:00–23:59) (3) contacts still PENDING?
(4) `AuditLog` has `campaign.start`? (5) BullMQ repeatable job exists:
`docker exec vaani-redis redis-cli KEYS 'bull:campaign-scheduler:*' | head`.
→ Fix the first failing item. Most common: worker not started.
→ Verify: `enqueued N dial(s)` appears within 30s.

**G3. Worker crashed mid-campaign → contacts stuck in `DIALING` forever**
→ Cause: crash between claim and completion leaves stale DIALING rows.
→ Fix (safe — DIALING rows are reclaimable by design):
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "UPDATE \"CampaignContact\" SET status='PENDING', \"updatedAt\"=now() WHERE status='DIALING';"
```
then restart the worker; the scheduler re-claims them on the next tick.
→ Verify: `SELECT count(*) FROM "CampaignContact" WHERE status='DIALING';` → 0 and
dials resume.

**G4. All dials instantly FAILED**
→ Cause: `CAMPAIGN_DRY_RUN=false` with Dograh down or agent not published — OR the
Vobiz/Dograh dial call returned `ok:false` (the client RETURNS `{ok:false}`, it
never throws — the reason is in the worker log line, not an exception).
→ Fix: either set `CAMPAIGN_DRY_RUN=true` for testing, or fix Dograh + publish the
agent (PUBLISHED + `dograhWorkflowId` present); read the `reason` field in the
worker log for the provider's own error.
→ Verify: one dry-run campaign completes (guide 07 flow).

**G5. Campaign stalled: every dial skipped, pool-related log lines**
→ Cause: number-pool exhaustion — every pool number hit its daily/lifetime cap or
its series is barred for this campaign type (140 promotional vs 1600 service).
→ Fix: check `NumberPool` numbers' caps in the pool editor; add numbers or wait for
the daily reset; verify the campaign's number type matches the pool
(`tests/campaign-pool-compliance.test.ts` encodes the rules).
→ Verify: dials resume; per-number counts increment.

**G6. Retries never fire / scheduler stuck**
→ Cause: `nextAttemptAt` in the future is correct behavior — wait `retryDelayMin`.
If long past due: the worker was down during the window, or the BullMQ repeatable
tick vanished; the scheduler only ticks while the campaign is RUNNING —
pause/start the campaign to re-register it.
→ Verify: `RETRY_SCHEDULED` rows get re-claimed after their `nextAttemptAt`.

**G7. CSV imports 0 contacts**
→ Cause: header row missing/wrong (`phone`/`mobile` required) or file isn't real CSV
(Excel .xlsx!).
→ Fix: export as CSV (UTF-8), ensure first line is headers.
→ Verify: import message counts match expectations.

**G8. Worker's env changes have no effect (e.g. edited `CAMPAIGN_DRY_RUN`)**
→ Cause: the worker loads `.env` at process start (via `src/lib/db` import) — a
running worker never re-reads it.
→ Fix: `pkill -f "tsx src/worker"; (npm run worker > /tmp/worker.log 2>&1 &)`
(prod: `docker compose -f docker-compose.prod.yml up -d worker` after the `.env` edit).
→ Verify: the worker log's startup line reflects the new flag.

**G9. Interest scores all show "unscored" marker**
→ Cause: OpenRouter was down/keyless at scoring time — the scorer marks calls
`unscored` instead of failing the dial loop (by design).
→ Fix: restore the OpenRouter key; re-scoring is manual for v1 (report if a
customer needs it). New calls score normally.
→ Verify: `interestScore` set on newer completed calls.

**G10. Double-enqueued callbacks / duplicate dial jobs**
→ Cause: dedupe keys should make this impossible — if seen, check whether the same
contact is in TWO lists attached to the campaign (allowed) vs a true queue bug.
→ Fix: dedupe the contact list (guide 07 dedupe on import); if the SAME
CampaignContact dialed twice concurrently, STOP and report with the worker log —
that's a claim-lock bug.
→ Verify: one dial per CampaignContact per attempt window.

**G11. Dials instantly FAILED with `no DID in workspace for fromNumber`**
→ Cause: the campaign's pool/number selection found no usable PhoneNumber row in
THIS workspace to dial FROM (pool empty, all numbers unassigned to the pool, or
the campaign's number-type filter matches nothing — guide 07's fromNumber
resolution).
→ Fix: /numbers — confirm at least one number exists in the workspace; /pools —
attach it to the campaign's pool with the right series type (140/1600); re-check
the campaign's `pool-select`. Then resume the campaign.
→ Verify: the next tick enqueues dials with a real `fromNumber` in the worker log;
dry-run dials complete.

---

## H. Calls, analytics & platform APIs (guide 08)

**H1. Transcript full-text search returns 0 for everything**
→ Cause: the FTS migration (tsvector column + trigger) wasn't applied, or it ran
before existing rows (they need a backfill touch).
→ Fix: `npx prisma migrate dev` (dev) / `migrate deploy` (prod); re-save one call or
run the guide 08 backfill SQL; test with a token you know is in a transcript.
→ Verify: `tests/fts.test.ts` green + UI `calls-fts-count` ≥ 1 for a known token.

**H2. No QA scores on completed calls, scorer log shows 401**
→ Cause: `QA_DRY_RUN=false` with an invalid/absent `OPENROUTER_API_KEY` — the real
scorer is being rejected.
→ Fix: fix the key, or set `QA_DRY_RUN=true` (deterministic mock) until you want
real spend. Restart app + worker.
→ Verify: new completed calls get `QaScore` rows.

**H3. Outbound webhook shows 8 attempts then FAILED**
→ This is the DESIGNED backoff (guide 08: 8 retries, exponential).
→ Fix: read `responseCode` on the delivery — non-2xx means YOUR receiver rejected
it (bad signature → secret mismatch; 500 → receiver bug). Re-test with
`scripts/webhook-receiver.ts` to isolate.
→ Verify: a corrected receiver gets SUCCESS on the next test event.

**H4. Public API rate limits seem to reset randomly**
→ Cause: the v1 limiter is IN-MEMORY — app restarts and multi-replica deployments
reset it (documented v1 limitation).
→ Fix: none for v1 (Redis-backed limiter is a v2 hardening item). Don't build
customer SLAs on exact limit counters.
→ Verify: limits behave per-window on a single steady process.

**H5. Email digests never arrive, no errors anywhere**
→ Cause: `SMTP_*` unset — digests are SKIPPED SILENTLY by design (no provider, no
crash).
→ Fix: set `SMTP_HOST/PORT/USER/PASS/FROM` in `.env`, restart the worker (digests
are worker crons — see G8).
→ Verify: next digest tick logs a send; mailbox receives it.

**H6. Prod runs but "nothing real happens" — the DRY_RUN trap**
→ Cause: one or more of `CAMPAIGN_DRY_RUN` / `WHATSAPP_DRY_RUN` / `CRM_PUSH_DRY_RUN`
/ `QA_DRY_RUN` / `AUTOTOPUP_ENABLED=false` still set in prod `.env`.
→ Fix: guide 12's S5 check greps these; flip the ones the operator approved
(guide 12 Step 14), restart app + worker. Until flipped, the no-op is SAFE — money
and messages are never spent by accident.
→ Verify: guide 12 S5 output lists the intended values.

**H7. GDPR request stuck PENDING / re-queued forever**
→ Cause: the processing cron errored mid-export (usually MinIO unreachable) and the
worker re-queues on each tick.
→ Fix: read `/tmp/worker.log` for the failing request id; fix the underlying error
(G5/MinIO first), then either let the next tick finish it or mark it:
`UPDATE "GdprRequest" SET status='FAILED' WHERE id='<id>';` and re-file via the UI.
→ Verify: status COMPLETED with a `resultKey`, or FAILED with a log trail.

**H8. "Export to Sheets" button does nothing**
→ EXPECTED — Google Sheets export is a `not_configured` no-op until the OAuth gate
(guide 11 backlog #9) is closed with a Google Cloud service account.
→ Fix: none in v1 code; CSV export covers the need today.
→ Verify: the button's tooltip/state says not configured.

**H9. After running guide 08's GDPR scripted test, the demo call vanished**
→ EXPECTED — the guide's erasure test erases the seeded caller `+919812345678`'s
data (that's the proof).
→ Fix: re-run `npm run prisma:seed` (or guide 06 Step 22's setup block) to restore
demo rows. Never run erasure tests against a customer workspace.
→ Verify: demo call rows present again.

**H10. A worker scheduler never fires (or fires constantly) after an env "tweak"**
→ Cause: interval-vs-cron confusion — `WEBHOOK_RETRY_INTERVAL_MS` is **milliseconds
between runs** (a number), while `DIGEST_CRON` and `RETENTION_CRON` are **cron
expressions** (e.g. `"0 8 * * *"`). Putting a cron string in the ms var (or a bare
number in a cron var) silently breaks the schedule.
→ Fix: check the var NAMES against guide 08's env block; ms vars get integers,
`*_CRON` vars get 5-field cron expressions — when in doubt, paste the guide's
default value back verbatim. Restart the worker (G8).
→ Verify: the worker log's cron registration lines appear at startup and the job
fires on schedule.

---

## I. Billing, wallet & payments (guide 09)

**I1. Razorpay checkout opens but wallet never credits**
→ Cause: webhook not reaching the app (URL/secret) — checkout success alone doesn't
credit; the WEBHOOK does.
→ Fix: dashboard webhook URL + secret = `RAZORPAY_WEBHOOK_SECRET`; test with the
simulation in guide 09. In the Razorpay dashboard check webhook delivery attempts.
→ Verify: simulation credits exactly once.

**I2. `PaymentOrder` stuck in `created` (customer paid, wallet not credited)**
→ Cause: the webhook was missed/failed (I1) — the order row stays `created`.
→ Fix — reconcile, never hand-credit: re-send the signed `payment.captured`
simulation from guide 09 with the order's `providerOrderId` (idempotent — a second
credit for the same receipt is impossible). If the payment truly happened at
Razorpay but no webhook exists, use the reconcile one-off:
`npx tsx -e "import('./src/lib/billing').then(m => m.reconcileOrder('<providerOrderId>'))"`
IF guide 09 shipped `reconcileOrder` — otherwise STOP and report (do not invent SQL
credits; the ledger must always have a matching event).
→ Verify: order `paid`, one `TOPUP` ledger row, wallet += amount.

**I3. `bad signature` on real Razorpay/Stripe webhooks**
→ Cause: dashboard secret ≠ `.env` secret (whitespace counts); Stripe: using the
API secret instead of the SIGNING secret (`whsec_…`).
→ Fix: re-paste both (`RAZORPAY_WEBHOOK_SECRET` / `STRIPE_WEBHOOK_SECRET`), restart
the app.
→ Verify: the HMAC simulation passes.

**I4. Call completed but `billedPaise = 0`**
→ Cause: `durationSec = 0` (billing skips zero-duration), or billing threw — check
logs for `billing failed for call`.
→ Fix: if duration is missing, the telephony payload didn't include it — see D5
(payload shape). Manual repair: set `durationSec`, then re-run billCall via a
file-based one-off script in `scripts/` (see L7 — never `tsx -e` against project
modules) — report what you ran.
→ Verify: call row shows cost components + billedPaise > 0.

**I4b. ANSWERED calls with a duration don't debit (regression class)**
→ Cause: `billCall` was being invoked BEFORE the call row was re-loaded with the
final `durationSec`/status (guide 09 Step 6 moved it AFTER the row load) — the
biller saw a zero/partial duration and skipped, and calls that end without a
transcript were skipped entirely.
→ Fix: confirm guide 09 Step 6's ordering in the post-call pipeline: persist the
final call row FIRST, then `billCall(freshRow)`. The regression is pinned by
guide 09 Part C `dograh_bill_2` (answered call, no transcript → expected debit
**235** paise) — run that exact scenario, don't eyeball it.
→ Verify: `dograh_bill_2` debits 235; `billedPaise > 0` on answered no-transcript
calls.

**I5. Wallet went negative**
→ By design for v1 (calls in flight debit as they complete; plan upgrades debit
immediately). The low-balance banner + alerts + operator top-up are the control.
Do NOT "fix" by clamping — the ledger must reflect reality.

**I6. Suspected double-debit**
→ Cause: should be impossible — every debit/credit carries an idempotent receipt
reference (`topup_…`, `autotopup_…`, `plan_…`, call id) enforced by a unique
constraint; cron overlap is safe for the same reason.
→ Fix: `SELECT reference, count(*) FROM "WalletLedger" GROUP BY reference HAVING count(*)>1;`
— zero rows expected. If a duplicate exists, STOP and report with both rows.
→ Verify: the query returns 0 rows.

**I7. GST wrong on the invoice (IGST where CGST+SGST expected, or vice versa)**
→ Cause: `placeOfSupply` (workspace GST settings) vs `BILLING_COMPANY_*` state
mismatch — intra-state ⇒ CGST+SGST, inter-state ⇒ IGST (`tests/invoice.test.ts`
encodes the rule).
→ Fix: correct the GSTIN / place-of-supply in the billing settings form
(`gst-settings-form`); regenerate the invoice (same month, idempotent ref).
→ Verify: regenerated invoice splits match the rule.

**I8. Wallet balance ≠ sum of ledger rows (drift)**
→ Cause: a manual SQL edit or a crashed debit left the cached balance off.
→ Fix — resync FROM the ledger (the ledger is the truth), operator-approved:
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "UPDATE \"Wallet\" w SET \"balancePaise\"=x.sum FROM \
  (SELECT \"workspaceId\", COALESCE(SUM(\"amountPaise\"),0) AS sum FROM \"WalletLedger\" GROUP BY \"workspaceId\") x \
  WHERE w.\"workspaceId\"=x.\"workspaceId\";"
```
(sign convention: credits positive, debits negative — confirm one row first:
`SELECT "amountPaise", type FROM "WalletLedger" LIMIT 5;`)
→ Verify: dashboard balance matches the ledger sum.

**I9. `AUTOTOPUP_ENABLED=true` but auto top-up never charges**
→ Cause: real tokenized charges need Razorpay tokenization enabled on the account
(OPERATOR GATE — guide 11 backlog #13). With the gate open, the flow only logs
DRY-RUN lines even when the flag is true.
→ Fix: request tokenization via Razorpay dashboard → Settings → Configuration, set
the `paymentMethodRef` per guide 09 Step 7, then flip the flag. Until then keep
`AUTOTOPUP_ENABLED=false` to avoid confusion.
→ Verify: a threshold crossing produces a real charge (or a clear Razorpay error).

**I10. Worker/one-off scripts crash with `require is not defined` (Stripe lib or tsx ESM)**
→ Cause: ESM context where a CJS `require` (or `require.main === module` guard) was
used.
→ Fix: guide 09's note — replace the `if (require.main === module)` guard with the
ESM-safe pattern it shows, and import Stripe via the lazy singleton in
`src/lib/stripe.ts` (never a top-level `require`). Re-run once; then STOP and report.
→ Verify: the script/worker starts; `tests/stripe-sig.test.ts` green.

---

## J. Onboarding, branding & KYC (guide 10)

**J1. Every app page keeps bouncing to /onboarding (perpetual redirect)**
→ Cause: `OnboardingResume` force-redirects while `completedAt` is NULL AND no
checklist item is done. If a user completed the wizard but `completedAt` never got
set (crash during `completeOnboardingAction`), they're stuck.
→ Fix: check `SELECT * FROM "OnboardingState" WHERE "workspaceId"='<id>';` — if
checklist items are done but `completedAt` is null, finish it manually:
`UPDATE "OnboardingState" SET "completedAt"=now() WHERE "workspaceId"='<id>';`
If the user is genuinely brand-new, the redirect is CORRECT — walk the wizard
(or the E2E helper `completeOnboardingFast`, guide 11).
→ Verify: /dashboard loads without redirect.

**J2. Custom domain verification flapping (verified → unverified → verified)**
→ Cause: DNS record type confusion (the flow expects the exact TXT/CNAME shown in
`branding-dns-instructions`) or propagation delays; some DNS providers proxy CNAMEs
(Cloudflare orange-cloud) which hides the target.
→ Fix: `dig TXT <domain>` / `dig CNAME <domain>` from the VPS — the answer must
match the instructions exactly; disable proxying (grey-cloud); wait out propagation
(up to 24h, usually minutes) before re-verifying.
→ Verify: `tests/domain-verify.test.ts` green + UI `branding-domain-status` = VERIFIED.

**J3. Sample data cleared but some sample rows remain**
→ Cause: cleanup deletes by `SAMPLE_PREFIX`; rows created by an older/renamed prefix
(or hand-edited sample rows) are missed.
→ Fix: list leftovers (`SELECT … WHERE name LIKE '%' || '<prefix>' || '%'` per the
guide 10 prefix), delete the stragglers manually by id, and report the miss (the
cleanup list lives in `src/server/actions/onboarding.ts` — a missing model there is
a bug to fix, not to work around permanently).
→ Verify: /contacts, /campaigns, /calls show no sample rows.

**J4. KYC upload fails silently / 413**
→ Cause: file over the size limit, non-allowed mime, or MinIO down.
→ Fix: keep scans < 5 MB PDF/JPG/PNG; check `docker compose ps` for minio; re-run
`npx tsx scripts/bootstrap-minio.ts` if buckets were recreated.
→ Verify: `kyc-success` shows PENDING and `kyc-status-banner` updates.

---

## K. Testing & E2E (guide 11)

**K1. `npm test` runs only 46 files / `src/lib` suites missing (guide 04 ×3 + guide 05's vobiz.sms)**
→ Cause: stale `vitest.config.ts` from guide 06 (`include: ["tests/**"]` only).
→ Fix: apply guide 11 Step 1a — include must be
`["tests/**/*.test.ts", "src/**/*.test.ts"]`.
→ Verify: `npx vitest list | grep -c ".test.ts"` → 50; `npm test` → 50 files/381 tests.

**K2. Playwright: `browser executable doesn't exist` / launch fails**
→ Fix: `npx playwright install --with-deps chromium` (A6). Headless VPS needs no
X server — the config runs headless; do NOT add `--headed` except via SSH X
forwarding locally.
→ Verify: `--list` prints the spec inventory.

**K3. E2E login/wizard specs fail: landed on /onboarding unexpectedly (or not)**
→ Cause: guide 10's `OnboardingResume` — brand-new workspaces are force-redirected
to /onboarding; the seeded demo workspace is NOT (checklist partially done).
→ Fix: non-onboarding specs must log in as the demo user (guide 11 helpers
`loginDemo`) or call `completeOnboardingFast` after registering. This is the #1
E2E pitfall — it is documented in guide 11 Step 2.2.
→ Verify: the spec's first `expect(page).toHaveURL(...)` matches its design.

**K4. E2E agent publish / wizard template step fails with a voice-engine error**
→ Cause: Dograh not running (publish pushes a workflow).
→ Fix: `cd /root/dograh && docker compose up -d`, wait for healthy, re-run the spec.
→ Verify: `e2e/agent-lifecycle.spec.ts` green.

**K5. E2E webhook spec: receiver log shows `signature_valid=false`**
→ Cause: receiver started with a DIFFERENT secret than the subscription (the UI
generates the secret — the spec reads it from the table and restarts the receiver).
→ Fix: re-run the spec; if hand-testing, copy the secret from
/settings/webhooks into `RECEIVER_SECRET`.
→ Verify: `event=test.ping signature_valid=true` in `/tmp/e2e-webhook.log`.

**K6. E2E GDPR spec times out waiting for COMPLETED**
→ Cause: the worker cron that processes requests ticks ~60s AND the worker wasn't
running (or errored — H7).
→ Fix: confirm `npm run worker` is up; check `/tmp/worker.log` for the request id;
the spec allows 200s — beyond that, treat as H7.
→ Verify: `GdprRequest.status='COMPLETED'` with a `resultKey`.

**K7. `npm run test:e2e` → "playwright: command not found"**
→ Cause: `@playwright/test` not installed yet (guide 11 Step 2.1), or you're
running before guide 11 (guide 01 wires the script early — expected failure then).
→ Fix: run guide 11 Step 2.1 exactly.
→ Verify: `npm ls @playwright/test` → `1.48.2`.

---

## L. Build & Runtime (all phases)

**L1. `npm run build` fails with a type error that `typecheck` didn't show**
→ Fix: a stale `.next` dir: `rm -rf .next && npm run build`. (Safe: `.next` is
build output.)
→ Verify: build green.

**L2. Page shows stale data after a mutation**
→ Cause: missing `revalidatePath` in the action, or the page cached.
→ Fix: confirm the action calls `revalidatePath` for the affected route; pages that
must always be fresh have `export const dynamic = "force-dynamic"`.
→ Verify: mutation → immediate UI change on refresh.

**L3. `EADDRINUSE :::3000`**
→ Fix: an old dev server is still running: `pkill -f "next dev"` then start again.
→ Verify: `curl -s -o /dev/null -w "%{http_code}" localhost:3000` → 200.

**L4. Out of disk on the VPS (`no space left on device`)**
→ Fix: check `df -h`; usual suspects are docker logs (guide 12 caps them), old
images (`docker image prune -f` — safe), and Playwright traces in
`e2e/test-results/`. NEVER `docker system prune -a --volumes` (destroys database
volumes).
→ Verify: `df -h /` below 80%.

**L5. MinIO `signature does not match` from the app**
→ Cause: `S3_ACCESS_KEY`/`S3_SECRET_KEY` ≠ MinIO root credentials (desync after prod
password rotation, guide 12 Step 2).
→ Fix: align the two, restart app/worker.
→ Verify: `npx tsx scripts/bootstrap-minio.ts` → `bucket ready`.

**L6. Next dev server is slow / random 500s after big edits**
→ Fix: `rm -rf .next` and restart; if it persists, `npm run typecheck` for the real
error. Node heap: `NODE_OPTIONS=--max-old-space-size=4096 npm run dev` on small VPS.
→ Verify: clean compile, pages 200.

**L7. `npx tsx -e "…"` one-liner fails: named exports undefined / `undefined is not a function`**
→ Cause: `tsx -e` inline eval CJS-wraps the inline code — importing OUR TS modules
from an inline eval loses their named exports (guide 06 hit this; the module's
ESM exports don't materialize on the CJS wrapper).
→ Fix: never `tsx -e` against project modules — write a file-based script in
`scripts/` (full content, like the guides do) and `npx tsx scripts/<name>.ts`.
Inline eval is fine ONLY for pure npm CJS packages, and even there prefer a file
so the report can quote it.
→ Verify: the file-based script runs and sees the module's named exports.

---

## M. Production (guide 12)

**M1. Caddy 502 Bad Gateway**
→ Cause: app container down or still booting.
→ Fix: `docker logs vaani-app --tail 40`; `docker compose -f docker-compose.prod.yml ps`.
→ Verify: `docker exec vaani-caddy wget -qO- http://app:3000 | head -c 100`.

**M2. TLS certificate not issuing**
→ Cause: DNS not pointing at the VPS, ports 80/443 blocked, or rate limit from
repeated attempts.
→ Fix: `dig +short <domain>` must equal the VPS IP; `ufw status` allows 80/443;
`docker logs vaani-caddy --tail 40`. If Let's Encrypt rate-limited: wait 1h.
→ Verify: `curl -sI https://<domain>` → 200 with valid cert.

**M3. `/api/health` says `degraded` but everything looks fine (false negative)**
→ Cause: a dependency CHECK is falsy — most commonly Dograh (`"dograh":false`)
because `DOGRAH_API_URL` isn't reachable/set yet, or a slow first probe.
→ Fix: read the JSON — the failing key names the dependency. Dograh unset is
EXPECTED `degraded` until guide 12 Step 9 wires it; only `"db"/"redis"/"minio":false`
are page-worthy (the alert watcher thresholds in guide 12 already treat it so).
→ Verify: after wiring, `"status":"ok"`.

**M4. health-watch cron pages while the site is fine (hairpin NAT)**
→ Cause: the VPS curls its OWN public domain — many cloud NATs can't hairpin, so
the watcher sees a timeout that users never experience.
→ Fix: point the watcher at the internal address (`http://127.0.0.1:3000/api/health`,
or the compose service via `extra_hosts` — guide 12 Step 8) and keep ONE external
monitor (backlog #19) for the public view.
→ Verify: watcher logs 200s; forced-failure test (guide 12 H3) still pages.

**M5. Cron jobs (digests/retries/retention/health-watch) run twice or not at all after scaling workers**
→ Cause: `RUN_CRON` gate — the primary worker must run `RUN_CRON=true` and scaled
dialer workers `RUN_CRON=false`; the comparison is literally `!== "false"`, so the
value must be exactly the string `false` (not `0`, not empty, not `no`).
→ Fix: check `docker inspect vaani-worker*` env; set the compose env exactly; also
verify no dev shell worker is still alive (`pgrep -fa "tsx src/worker"`).
→ Verify: guide 12's CRON INVENTORY line shows each cron registered exactly once.

**M6. MinIO backup fails: `mc` cannot resolve/connect to minio**
→ Cause: the backup runs `docker run --network <name> minio/mc` — the network name
drifted with the compose PROJECT name (see M8).
→ Fix: get the real network:
`docker inspect vaani-minio-prod --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}'`
and use exactly that in `scripts/backup.sh` (guide 12 Step 8 derives it the same way).
→ Verify: a manual backup run lists objects mirrored.

**M7. Workspace custom domain: no cert, or Let's Encrypt abuse caps hit**
→ Cause: on-demand TLS asks the app before issuing; the ask endpoint
(`/api/domain-ask`) approves ONLY verified workspace domains — 403 for anything
else is CORRECT and protects you from random-domain abuse caps.
→ Fix: confirm the domain shows VERIFIED in /settings/branding (J2) before pointing
DNS at the VPS; if caps were already hit by probing, wait 1h and stop the probe loop.
→ Verify: `curl -sI https://<workspace-domain>` → 200, branded app renders.

**M8. Scripts can't find containers (`vaani-db` vs `vaani-db-prod` vs `app-db-1`)**
→ Cause: compose project-name drift — container names come from the project
(directory or `-p` flag); the guides' scripts assume the documented names.
→ Fix: `docker ps --format '{{.Names}}'` — either use the documented
`docker compose -f docker-compose.prod.yml` commands from the repo directory (they
pin names), or pass `-p <name>` consistently. Don't rename containers ad hoc.
→ Verify: `docker exec vaani-db-prod psql -U vaani -d vaani -c 'SELECT 1;'` works.

**M9. App works but worker keeps crashing in prod**
→ Fix: `docker logs vaani-worker --tail 40`. Most common: `DATABASE_URL`/`REDIS_URL`
still pointing at `localhost` inside containers — must be `db`/`redis` (compose
service names). The prod compose sets these via `environment:` — confirm your `.env`
edits didn't override them.
→ Verify: worker log shows `worker ready`.

**M10. Restore from backup**
→ Fix (careful, operator-approved only):
```bash
docker cp /root/backups/vaani-<stamp>.dump vaani-db-prod:/tmp/restore.dump
docker exec vaani-db-prod pg_restore -U vaani -d vaani --clean --if-exists /tmp/restore.dump
docker exec vaani-db-prod rm /tmp/restore.dump
```
→ Verify: app queries return restored data; run smoke test (prod profile).

---

## N. Escalation protocol (for Hermes)

If a problem is NOT in this playbook after 2 fix attempts:

1. Freeze. Do not refactor, reinstall the OS, or drop data to "start clean".
2. Collect: the exact command, full stdout/stderr, and the relevant log tails —
   dev (`/tmp/next-dev.log`, `/tmp/worker.log`), prod
   (`docker logs vaani-app|vaani-worker|vaani-caddy --tail 40`,
   `docker compose -f docker-compose.prod.yml ps`), Dograh
   (`cd /root/dograh && docker compose logs --tail 60`), E2E
   (`e2e/test-results/**/error-context.md`, screenshots, `trace.zip`).
3. State: which guide + step you are on, what Verify expected, what you got, and
   WHICH playbook entries you already tried (letter + number, e.g. "tried G3, M5").
4. Report to the operator and WAIT. The operator brings the report back to the
   planner for a playbook amendment.
5. Never weaken a test, delete a `data-testid`, or set a DRY_RUN flag to make a
   failure disappear — those are exactly the signals the operator needs.

## O. Operator FAQ

- **"Calls cost real money in tests?"** No — `CAMPAIGN_DRY_RUN=true` (default)
  simulates; `WHATSAPP_DRY_RUN`, `CRM_PUSH_DRY_RUN`, `QA_DRY_RUN` and
  `AUTOTOPUP_ENABLED=false` likewise no-op the paid/real side effects. Real money
  starts when the operator flips flags in guide 12 Step 14.
- **"Where are recordings?"** MinIO bucket `vaani-recordings`, per-workspace prefix;
  playback via 15-minute presigned URLs on the call detail page.
- **"How do I change prices?"** Per-workspace wholesale rate cards: /billing →
  rate-card editor (`ratecard-editor`, guide 09). Plan prices: `Plan` table (one-off
  tsx script) + landing copy in `src/app/page.tsx` + seed defaults in
  `prisma/seed.ts`.
- **"How do I add a team member?"** /settings/members → invite form (UI ships in
  v1, guide 03). The invitee must accept with the invited email (C9).
- **"Why are there no QA scores / WhatsApp messages / CRM pushes / real charges?"**
  The matching DRY_RUN flag is still on (H6) or the OPERATOR GATE is still open —
  check guide 11 Step 8's backlog table first, then this playbook's H2/H6/I9.
- **"A customer says they got double-charged / double-called."** Impossible by
  design (idempotent refs + dedupe keys) — run I6's SQL and G10's checks; if a
  duplicate row truly exists, STOP and escalate (§N) with both rows.
- **"Something is on fire and customers are affected."** Pause all RUNNING campaigns
  (`UPDATE "Campaign" SET status='PAUSED' WHERE status='RUNNING';`), check
  `docker logs vaani-app`, then work this playbook top-down from the symptom.
  The stack is designed so every emergency stop is safe: paused campaigns resume,
  stale DIALING rows are reclaimable (G3), webhooks retry (H3).
- **"How do I run the full test battery before a release?"** In order:
  `npm test` (50/381) → `npx tsx scripts/schema-smoke.ts` (33/33) →
  `npm run test:e2e` → `SMOKE_PROFILE=prod BASE_URL=https://<domain> ./scripts/smoke-test.sh`
  → `BASE_URL=https://<domain> ./scripts/webhook-burst.sh`. All must be green; the
  guide 11 acceptance checklist maps every line to the spec section it proves.
