# 00 — MASTER PLAN: Vaani AI (Read This First, Always)

> **What this folder is:** A complete, step-by-step playbook for building **Vaani AI** — a
> multi-tenant AI Voice Agent SaaS (inbound AI receptionist + outbound AI telecaller) —
> based on `../AI_Voice_Agent_SaaS_Feature_Specification.md` (the readme).
>
> **Who executes it:** A cheap/small LLM agent (Hermes on a VPS). All planning and
> decisions are ALREADY MADE in these files. The executor must NOT redesign, swap
> libraries, or "improve" the architecture. It only follows steps, runs the verification
> commands, and reports results
>
> **Human operator (you):** Your job is to (1) create the external accounts listed in
> §10, (2) paste each guide's kickoff prompt into Hermes, (3) check the verification
> outputs Hermes reports, (4) approve the git checkpoint at the end of each phase.

---

## 1. The Product in One Paragraph

Vaani AI lets any Indian business create an AI phone agent in under 30 minutes. It
answers every inbound call 24/7 in 11+ Indian languages (AI receptionist) and runs
outbound calling campaigns from a CSV upload (AI telecaller), including WhatsApp
follow-ups and predictive/paced dialing. Supervisors get human-in-the-loop live
operations (live transcripts, listen/whisper/barge, warm-transfer queues). Agents are
built from industry templates with versioning, a knowledge base (RAG), and mid-call
tools (calendar booking, CRM writes, webhooks). The platform is fully monetized:
subscription tiers, wallet with per-second metered billing and markup, Razorpay +
Stripe top-ups, GST invoices, number rental, and a white-label reseller panel. It
ships with enterprise-grade surface area in v1: Google SSO + optional SAML, TOTP 2FA,
scoped API keys, a public REST API, signed outbound webhooks, AI QA auto-scoring,
GDPR/retention controls, and full observability. Telephony is **Vobiz**, voice
orchestration is self-hosted **Dograh**, speech is **Sarvam.ai** (STT + TTS), and the
LLM brain is **OpenRouter**. Because Dograh is self-hosted, we pay **zero per-minute
platform fees** — that is the margin. We sell subscriptions + metered minutes with a markup.

**Tagline for the landing page:** *"The AI receptionist that speaks your customer's
language. Answers every call. Never takes a day off. Costs less than one day of a
telecaller's salary."*

---

## 2. Architecture (Final — Do Not Change)

```
                          ┌────────────────────────────────────────────┐
                          │                 VPS (Ubuntu 24.04)          │
                          │                                            │
   PSTN calls             │   ┌─────────┐      ┌──────────────────┐    │
 ◄──────────► Vobiz SIP ──┼──►│ Dograh  │─────►│ Sarvam.ai (STT/  │    │
  (DID numbers,           │   │ (Docker)│      │ TTS streaming)   │    │
   WebSocket audio)       │   └────┬────┘      └──────────────────┘    │
                          │        │              ┌──────────────────┐ │
                          │        └─────────────►│ OpenRouter (LLM) │ │
                          │        REST/webhooks  └──────────────────┘ │
                          │        ▼                                   │
                          │   ┌─────────────────────────────────────┐  │
   Browser ◄──HTTPS──► Caddy│   │ Vaani AI App (Next.js 14)         │  │
                          │   │  - Dashboard (agents, campaigns,    │  │
                          │   │    calls, live ops, analytics,      │  │
                          │   │    integrations, billing, reseller) │  │
                          │   │  - REST API + Dograh webhooks       │  │
                          │   └───────┬─────────────┬──────────────┘  │
                          │           ▼             ▼                  │
                          │      PostgreSQL 16   Redis 7 (BullMQ)      │
                          │           ▼             ▼                  │
                          │      MinIO (recordings)  Worker (campaign  │
                          │  dialer + scheduled jobs process)  │
                          └────────────────────────────────────────────┘
```

**Responsibilities**
- **Dograh** (self-hosted, its own docker-compose): real-time voice pipeline
  (STT→LLM→TTS), call orchestration, telephony abstraction to Vobiz, agent workflows,
  call logs. We do NOT rebuild this — we configure it and call its API.
- **Vaani AI App** (the code we write): multi-tenant SaaS layer around Dograh —
  workspaces, users/roles/SSO/2FA, agent CRUD + versioning + knowledge base (which
  creates Dograh workflows via API), campaign engine, contacts, CDR/transcript/
  recordings viewer, live ops (listen/whisper/barge), integrations (CRM/calendar/
  webhooks/public API), analytics + AI QA, billing/wallet (Razorpay + Stripe),
  reseller/white-label, onboarding wizard, landing page.
- **Worker** (same repo, separate process): BullMQ consumer that dials campaign contacts
  through Dograh/Vobiz with pacing, retries, and schedule windows; also runs scheduled
  jobs (node-cron: campaign retries, retention cleanup, email digests; plus a
  setInterval sweep for failed outbound webhook retries).

---

## 3. Tech Stack — PINNED VERSIONS (install exactly these, nothing newer)

| Layer | Choice | Pinned version |
|---|---|---|
| OS | Ubuntu Server | 24.04 LTS |
| Node | LTS via apt NodeSource | Node 20.x, npm 10.x |
| Framework | Next.js (App Router, TypeScript) | `next@14.2.15`, `react@18.3.1`, `typescript@5.6.3` |
| Styling | Tailwind CSS | `tailwindcss@3.4.14` |
| UI components | shadcn/ui pattern (copied manually — code is given in the guides, do NOT run the interactive CLI) | — |
| Charts | Recharts | `recharts@2.13.3` |
| DB ORM | Prisma | `prisma@5.22.0` + `@prisma/client@5.22.0` |
| DB | PostgreSQL | `postgres:16` (Docker) |
| Queue | BullMQ | `bullmq@5.25.1`, `ioredis@5.4.1` |
| Cache/queue broker | Redis | `redis:7` (Docker) |
| Object storage | MinIO (S3-compatible) | `minio/minio:latest`, client `minio@8.0.2` |
| Auth | Custom: email+password, `bcryptjs@2.4.3`, JWT session cookie via `jose@5.9.6`, sessions table in Postgres | — |
| TOTP 2FA | otplib + QR codes | `otplib@12.0.1`, `qrcode@1.5.4` + dev `@types/qrcode@1.5.5` (installed in guide 03) |
| Google SSO + Calendar | Google APIs client | `googleapis@144.0.0` (installed in guide 03; calendar use in guide 05) |
| File type detection | mime-types (KB upload content-type detection) | `mime-types@2.1.35` + dev `@types/mime-types@2.1.4` (installed in guide 05) |
| Validation | Zod | `zod@3.23.8` |
| CSV parsing | PapaParse | `papaparse@5.4.1` |
| Payments (India) | Razorpay (test mode first) | `razorpay@2.9.4` |
| Payments (international) | Stripe (test mode first) | `stripe@17.3.1` (installed in guide 09) |
| Email | Nodemailer over SMTP (message summaries, digests, alerts — no SES SDK; any SMTP provider works) | `nodemailer@6.9.16` + dev `@types/nodemailer@6.4.17` (installed in guide 06; used by 06/08/09/12) |
| Schedulers | node-cron inside the worker (campaign retries in 07; retention cleanup, email digests in 08) | `node-cron@3.0.3` + dev `@types/node-cron@3.0.11` (installed in guide 07; used by 07/08) |
| Voice orchestration | Dograh (self-hosted Docker, BSD-2) | latest stable from its repo (guide 04 verifies) |
| Telephony | Vobiz | account + SIP trunk (guide 04) |
| STT/TTS | Sarvam.ai Saarika/Bulbul | API key (guide 04) |
| LLM | OpenRouter | API key (guide 04); default model `meta-llama/llama-3.1-70b-instruct` with fallback chain |
| Reverse proxy | Caddy (auto-HTTPS) | `caddy:2` (Docker) |
| Unit/integration tests | Vitest + bash/curl scripts | `vitest@2.1.3` (installed in guide 01) |
| E2E tests | Playwright | `@playwright/test@1.48.2` (installed in guide 11) |

**Why these choices (so nobody re-litigates them):** Next.js App Router + Prisma +
Tailwind is the single most-documented stack in existence — a small model makes the
fewest mistakes on it. Custom cookie auth is fully explicit code (no magic) and avoids
NextAuth version churn. BullMQ gives us retries/scheduling for free. Caddy gives
one-line HTTPS. Nodemailer+SMTP works with any email provider (Resend/SES/Mailgun)
without an extra SDK. otplib is the stable, zero-dependency TOTP library.

---

## 4. Repository Layout (Final)

```
vaani-ai/
├── plan/                        # this playbook (kept in repo for reference)
├── docker-compose.yml           # dev infra: postgres, redis, minio
├── docker-compose.prod.yml      # full prod stack: app, worker, db, redis, minio, caddy
├── Caddyfile
├── .env.example                 # every var documented; real .env is NEVER committed
├── package.json
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── src/
│   ├── middleware.ts            # auth guard for /dashboard etc.
│   ├── app/
│   │   ├── layout.tsx           # root layout, fonts, theme
│   │   ├── page.tsx             # landing page (marketing)
│   │   ├── (auth)/login/page.tsx
│   │   ├── (auth)/register/page.tsx
│   │   ├── (app)/dashboard/page.tsx
│   │   ├── (app)/agents/...     # agent builder UI (+ versions, KB, tools)
│   │   ├── (app)/campaigns/...  # outbound campaigns (+ WhatsApp campaigns)
│   │   ├── (app)/contacts/...
│   │   ├── (app)/calls/...      # CDR, transcripts, recordings, QA scores
│   │   ├── (app)/live/...       # HITL live ops: active calls, listen/whisper/barge (guide 06)
│   │   ├── (app)/numbers/...
│   │   ├── (app)/analytics/...
│   │   ├── (app)/integrations/... # CRM, calendar, webhooks, API keys UI (guides 05/08)
│   │   ├── (app)/billing/...
│   │   ├── (app)/reseller/...   # reseller/white-label panel (guides 09/10)
│   │   ├── (app)/settings/...   # workspace settings: profile, security/2FA, team, retention (guide 03+)
│   │   └── api/
│   │       ├── webhooks/dograh/route.ts    # call events from Dograh
│   │       ├── webhooks/razorpay/route.ts
│   │       ├── webhooks/stripe/route.ts    # Stripe events (guide 09)
│   │       └── v1/...                       # public REST API (guide 08)
│   ├── components/ui/           # button.tsx, card.tsx, input.tsx ... (provided in guides)
│   ├── components/              # app-specific components
│   ├── lib/
│   │   ├── db.ts                # Prisma singleton
│   │   ├── auth.ts              # session create/verify, requireUser(), requireWorkspace(), requireRole(), requirePermission()
│   │   ├── dograh.ts            # Dograh API client (typed, single file)
│   │   ├── queue.ts             # BullMQ queue definitions
│   │   ├── storage.ts           # MinIO client
│   │   ├── money.ts             # paise/rupee helpers, cost calc
│   │   ├── email.ts             # nodemailer SMTP sender (guide 08)
│   │   ├── integrations/        # CRM (hubspot.ts ...), calendar (google.ts ...), whatsapp.ts (guides 05/08)
│   │   └── utils.ts             # cn() etc.
│   ├── server/actions/          # Next.js server actions (mutations)
│   └── worker/
│       └── index.ts             # campaign dialer + node-cron schedulers (run with tsx)
├── tests/                       # Vitest unit tests (created in guide 01; suites added per guide)
├── e2e/                         # Playwright E2E specs (guide 11)
└── scripts/
    ├── smoke-test.sh            # end-to-end curl checks
    └── backup.sh
```

---

## 5. Coding Conventions (Executor MUST Follow)

1. **TypeScript strict.** No `any` unless a guide explicitly uses it. All API payloads
   validated with Zod at the boundary.
2. **Multi-tenancy rule (the most important rule in the project):** EVERY Prisma query
   on a tenant-owned model MUST include `workspaceId` from `requireWorkspace()`.
   Never trust a `workspaceId` from the client. Guides show the pattern; copy it.
3. **Money is integer paise** (INR × 100). Never floats. Helpers live in `lib/money.ts`.
4. **All mutations are Server Actions or Route Handlers** — no client-side direct fetch
   to our DB logic. Forms use `useFormStatus`/`useActionState` as shown in guides.
5. **Every server action:** auth check → zod validate → tenant scope → Prisma →
   `revalidatePath`. In that order.
6. **Errors:** never leak stack traces to the client; return `{ ok: false, error: "..." }`.
   Log the real error server-side with `console.error`.
7. **Secrets** only in `.env`, read via `process.env`. Never in code, never committed.
8. **UI:** dark, premium SaaS look (defined in guide 10). shadcn-style components,
   Tailwind only — no other CSS framework, no inline `style=` blobs.
9. **Every file a guide creates is shown IN FULL.** If a guide shows a file, create it
   exactly. Do not truncate with `// ...rest unchanged`.
10. **Git checkpoint at the end of every phase** (the human operator commits, or Hermes
    commits if the operator's prompt says so — default: Hermes commits with the exact
    message given in the guide).

---

## 6. Executor Operating Rules (Paste Into Hermes System Prompt)

The full copy-paste block lives in `01_vps_and_project_setup.md` §2. Summary:

- You are the **executor**. This playbook is the **plan**. The plan wins every conflict.
- Work on ONE guide file at a time, in numeric order. Never skip ahead.
- After every step: run the **Verify** command, compare against **Expected**, and paste
  both into your final report. If output differs: follow the step's **If it fails**
  block. If still failing after 2 attempts: STOP and report the exact command + full
  error output. Do not improvise fixes outside the guide.
- Never install different versions than pinned. Never add dependencies not listed in
  the guide. Never delete or rewrite files outside the current guide's steps.
- If a guide seems to contradict reality (e.g., an external service UI changed), do the
  minimal thing that satisfies the guide's **Expected** output and note the deviation
  in your report.

---

## 7. Phase Map (the .md files in this folder)

| File | Phase | Output (done =) |
|---|---|---|
| `01_vps_and_project_setup.md` | VPS + project skeleton | VPS hardened, Docker up, repo created, Next.js boots, full-scope `.env.example`, dir skeleton (`tests/`, `e2e/`, `scripts/`, live/integrations/reseller/settings routes), CI-less but reproducible |
| `02_database_schema_and_prisma.md` | Data model | Full schema (49 models covering the entire readme: auth/SSO/2FA, agents/versions/KB, campaigns/WhatsApp, calls/live ops, integrations/webhooks, QA, billing/reseller, compliance/onboarding) migrated, seed data for every domain, `npx prisma studio` shows rows |
| `03_authentication.md` | Auth + workspaces + roles | Register/login/logout, session cookie, role guard, audit log, **Google SSO, optional SAML SSO, TOTP 2FA, scoped API keys, session/device management** |
| `04_dograh_vobiz_sarvam_openrouter_integration.md` | Voice stack | Dograh running, Sarvam/OpenRouter keys live, Vobiz trunk, API client built on Dograh's exact OpenAPI contracts (see `dograh_api_docs.txt`), first real phone call answered by AI |
| `05_agent_builder.md` | Agent CRUD + templates | Create/edit/clone agents from industry templates; saved to DB + Dograh; **agent versioning (draft/publish/rollback), knowledge base (RAG) upload + scoping, mid-call tool configs (calendar/CRM/webhook), marketplace template gallery** |
| `06_inbound_receptionist.md` | Inbound + HITL live ops | Number → agent assignment, greeting, FAQ from KB, message-taking, after-call summary; **live call dashboard with real-time transcripts, listen/whisper/barge, human transfer queues** |
| `07_outbound_campaign_engine.md` | Outbound | CSV upload → campaign → worker dials with pacing/retries → live status; **DNC scrubbing, number pool rotation, adaptive/predictive pacing, WhatsApp template campaigns + call-to-WhatsApp fallback** |
| `08_calls_recordings_analytics.md` | CDR + analytics + platform APIs | Call list/detail, transcript, recording playback, dashboards with charts, cost per call; **AI QA auto-scoring, transcript search, CSV exports + scheduled email digests, public REST API v1, outbound signed webhooks with retries, GDPR export/erasure + retention policies** |
| `09_billing_wallet_razorpay.md` | Monetization | Plans, wallet top-up via **Razorpay + Stripe** test mode, per-second metering with markup, **GST invoices, auto top-up, number rental, free trial, reseller panel with wholesale rate cards** |
| `10_ui_polish_and_landing_page.md` | Million-dollar UI + onboarding | Landing page, dark theme, loading/empty states, responsive pass; **guided onboarding wizard (<30 min to live), in-app checklists, white-label theming/custom domains** |
| `11_testing_and_acceptance.md` | QA | Vitest suite green, **Playwright E2E suite green**, smoke-test.sh green, full manual checklist, test prompts + expected outputs, v2 backlog list |
| `12_production_deployment.md` | Ship it | docker-compose.prod on VPS, Caddy HTTPS, backups, **observability (structured logs, metrics, Slack/PagerDuty alerting), status page**, runbook |
| `13_troubleshooting_playbook.md` | When stuck | Symptom → cause → fix table for every known failure mode (incl. SSO/2FA, Stripe, SMTP, integrations, live ops) |

Each guide file is self-contained: goal, prerequisites, exact steps (commands + full
file contents), verify/expected/if-fails per step, and an acceptance checklist.

---

## 8. Scope Reality Check (Honest Note to the Operator)

**v1 now covers the ENTIRE readme feature specification.** Every feature bullet in the
product spec — including what older revisions of this plan deferred (Google SSO, SAML,
TOTP 2FA, scoped API keys, agent versioning, knowledge base/RAG, HITL listen/whisper/
barge, CRM + calendar syncs, WhatsApp campaigns, AI QA auto-scoring, Stripe, reseller
panel, white-label, onboarding wizard, public REST API, predictive dialing, template
marketplace, observability/status page) — is built by guides 01–13. Nothing in the
readme is silently dropped.

Two kinds of honest caveats remain:

1. **Provider-gated capabilities ship as scaffolding with OPERATOR GATES.** Voice
   cloning (brand voice) and speech-to-speech ultra-low-latency models depend on
   Sarvam.ai/Dograh capabilities that may not be generally available. The guides build
   the full config surface and integration points, and mark each with an explicit
   `OPERATOR GATE:` note stating exactly what the human must verify with the provider
   before enabling. Predictive dialing beyond answer-rate adaptive pacing, and BYOC
   SIP beyond Vobiz, are similarly gated.
2. **Optional third-party accounts.** Enterprise SAML IdP access, Microsoft 365
   calendar, Calendly/Cal.com, and CRM developer accounts (HubSpot etc.) are only
   needed if you sell those integrations on day one — the code is built and tested
   with mocks; the operator plugs in real credentials when a customer needs them.

The **v2 backlog shrinks to post-launch enhancements only** (community template
marketplace submissions/moderation, additional CRMs beyond the shipped set, dedicated
enterprise VPC/air-gapped installs, SDK packages for the public API). Guide 11 owns
the v2 backlog list so nothing is lost.

---

## 9. Definition of "Production Ready" for v1

- [ ] A new user can register → create workspace → pick a template agent → assign a
      number → receive a real phone call answered by the AI → see transcript + recording
      + cost in the dashboard. (The "golden path")
- [ ] A user can enable **TOTP 2FA** and log in with an authenticator code; a user can
      log in with **Google SSO**.
- [ ] A user can upload a PDF/FAQ to the **knowledge base**, and the agent answers an
      inbound FAQ question grounded in that document on a live call.
- [ ] A user can upload a CSV of 50 contacts → start a campaign → the worker dials with
      pacing and retries → per-contact outcomes visible live.
- [ ] A supervisor can open **live ops**, see an active call's real-time transcript,
      and use **listen** on it (whisper/barge verified where Dograh supports it).
- [ ] A **CRM sync** (e.g. HubSpot) pushes a call outcome/lead out of Vaani (tested
      against the provider's sandbox or a mock if no account).
- [ ] A campaign contact who doesn't answer receives the configured **WhatsApp
      fallback** template (or the fallback is verifiably queued if Vobiz WhatsApp
      access is still pending — OPERATOR GATE).
- [ ] A completed call shows an **AI QA score** against the default rubric on the call
      detail page.
- [ ] Wallet: **Razorpay AND Stripe** test-mode top-ups credit the wallet; calls debit
      it per-second with markup; low-balance warning shows; GST invoice generated.
- [ ] **White-label**: a reseller sub-account sees its own logo/colors, and a custom
      domain serves the branded app (tested with a local hosts entry or real domain).
- [ ] The **public REST API** answers with a scoped API key, enforces rate limits, and
      an outbound webhook fires with a valid signature.
- [ ] All tests in guide 11 pass — **Vitest units, curl integration scripts, and the
      Playwright E2E suite are green**; smoke-test.sh exits 0 on the production URL.
- [ ] HTTPS on a real domain, daily DB backups, log rotation, uptime ping, status page,
      and Slack/PagerDuty alert webhook firing on a forced failure.

---

## 10. Accounts & Secrets the HUMAN Must Create (Hermes cannot)

Do these BEFORE starting guide 04 (start now — **Vobiz KYC can take days**; everything
else is minutes):

| Service | What to get | Where it goes (.env key) | Needed by guide |
|---|---|---|---|
| VPS (Hetzner/DigitalOcean, 4 vCPU/8GB min) | IP + SSH access | — | 01 |
| Domain (e.g. vaani.ai / any .com) | DNS A-record → VPS IP | `DOMAIN` | 12 |
| Vobiz | account, SIP trunk credentials, 1 test DID number, WhatsApp Business API access | `VOBIZ_*` (into Dograh's env) | 04 (KYC lead time!) |
| Sarvam.ai | API subscription key | `SARVAM_API_KEY` (into Dograh's env) | 04 |
| OpenRouter | API key + $10 credit | `OPENROUTER_API_KEY` (into Dograh's env) | 04 |
| Razorpay | test-mode Key ID + Secret + webhook secret | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | 09 |
| Stripe | test-mode secret key + webhook signing secret | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | 09 |
| Google Cloud | OAuth 2.0 client (web) with Calendar scope enabled — used for Google SSO AND Google Calendar sync | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 03 (SSO), 05 (calendar) |
| SMTP provider (Resend / AWS SES / Mailgun — pick one) | SMTP host, port, user, password/API key, verified sender | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | 06 |
| Slack (or PagerDuty) | incoming webhook URL in an ops channel for alerts | `ALERT_SLACK_WEBHOOK_URL` | 12 |
| (optional) Microsoft Azure app | app registration for M365 calendar OAuth | documented in guide 05's env block | 05 |
| (optional) Calendly / Cal.com | API keys for calendar booking tools | documented in guide 05's env block | 05 |
| (optional) HubSpot developer account | OAuth app client id/secret for CRM sync | `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET` | 05/08 |
| (optional) Managed SSO provider (WorkOS / Auth0) for enterprise SAML | provider name + OAuth client credentials — see guide 03's OPERATOR GATE | `SAML_PROVIDER`, `SAML_CLIENT_ID`, `SAML_CLIENT_SECRET` | 03 |

`.env.example` (created in guide 01) documents every key. The operator pastes real
values into `.env` on the VPS; Hermes never invents or commits secrets. Optional rows
can be skipped until a customer needs them — the code ships and tests without them.

---

## 11. How to Run This Playbook (Operator Workflow)

1. Read this file fully.
2. Do the account creation in §10 (start Vobiz KYC immediately — it is the long pole).
3. Open `01_vps_and_project_setup.md`. Paste its **kickoff prompt** into Hermes.
4. Watch Hermes work. When it reports, compare its verification outputs against the
   guide's **Expected** blocks.
5. If green → approve the git checkpoint → move to the next guide.
6. If red → paste Hermes the relevant section of `13_troubleshooting_playbook.md`.
7. Guides 01–03 and 05–11 need no paid API calls. Guide 04 is where real money starts
   (small amounts — keep Vobiz/OpenRouter balances low during testing). Stripe and
   Razorpay stay in test mode until launch.
8. Wherever a guide contains an **OPERATOR GATE** note, the human completes that
   provider-side verification before the guide's dependent steps are considered done.

**Estimated executor time (full-scope v1):** guides 01–03 ≈ 2 days, 04 ≈ 0.5–1 day
(depends on Vobiz KYC), 05–09 ≈ 6–9 days, 10 ≈ 1–2 days, 11–12 ≈ 2–3 days, 13 is
reference. A beginner following this should ship the full v1 in **12–18 focused days**.
