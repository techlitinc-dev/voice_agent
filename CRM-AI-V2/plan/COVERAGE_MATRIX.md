# Coverage Matrix — readme.md (Product Spec) → Vaani AI Playbook

Every bullet of the product specification maps to executable guide steps or an explicit
OPERATOR GATE (provider-dependent, full scaffolding built + operator confirmation step).
Nothing is silently dropped. Provider-gated items are also tracked in guide 11 §v2-backlog
(23 rows) so they are confirmed/enabled post-launch.

| readme § | Feature | Implemented in | Proof / tests |
|---|---|---|---|
| §1–2 | Overview + architecture (Vobiz/Dograh/Sarvam/OpenRouter, zero per-min fee) | 00 §1–2, 01, 04 | 04 Step 8 live end-to-end call; 04 Step 12 latency-budget script (≤800ms) |
| §3.1 | Workspace isolation, RLS-style scoping, custom domains & white-label | 02, 03, 10 (branding/custom domain), 12 (on-demand TLS) | tenant-isolation tests in 05/07/11 Step 4; branding tests (10) |
| §3.2 | 5 roles + granular permission matrix + audit log | 03 Steps 3–5, 11, 18, 23; enforced in every guide's actions | tests/permissions.test.ts (12); RBAC negatives in 05/06/07/08 + 11 Step 4c |
| §3.3 | Email/pwd + Google SSO; OIDC enterprise SSO (SAML via managed-provider bridge = GATE); TOTP 2FA + backup codes; API keys w/ scopes + IP allowlist; sessions/devices/forced logout | 03 Steps 6–26 | tests/totp (8), apikeys (11); 15 scripted negatives (03 Step 29) |
| §4.1 | Visual builder (Dograh deep-link), branching, multi-agent, no-code, versioning drafts/publish/rollback/A-B, test-in-browser | 05 Steps 3–8, 19 | tests/versions (4), ab (6); E2E agent-lifecycle.spec |
| §4.2 | 39 Bulbul voices + per-language map, 3 language modes, per-agent LLM + failover chain (`:nitro`/`:floor`), 10 industry templates, conversation controls, hybrid pre-recorded (GATE on Dograh field names) | 05 Steps 1–4, 19b; 04 Steps 6, 14 | tests/voices (6), workflow-builder (12), dograh (17) |
| §4.3 | Knowledge base RAG: PDF/DOCX/URL/FAQ, chunk/index, per-agent scoping, re-index cron, KB-only guardrails (Dograh KB API = GATE w/ full scaffolding) | 05 Steps 9–11, 17 | E2E knowledge.spec; re-index cron (12 inventory) |
| §4.4 | 8 mid-call tools: calendar booking (Google full; M365/Calendly/Cal.com = GATE), human transfer, SMS/WhatsApp, CRM write, payment link, custom webhook, voicemail | 05 Steps 9, 12, 19c; /api/tools/execute | tests/tool-configs (6); 05 Step 22 curl suite |
| §5 | 24/7 inbound, smart greeting (hours/holiday/returning caller), NL routing, booking/resched/cancel, FAQ, lead capture→CRM, forwarding, message taking + staff email/WhatsApp, spam filter, voicemail-to-text (GATE), missed-call auto-callback, after-call automation | 06 Steps 1–15 | tests/greeting (16), spamFilter (8), leadExtraction (10); 06 Step 22 simulation |
| §6.1 | CSV/CRM import, dedupe/validation/DNC scrub, CPS/concurrency, timezone windows + TRAI 9–21h guard, per-disposition retries, number-pool rotation + caps, 140/1600 enforcement + DLT guide, 8 campaign presets, adaptive pacing/ramp, live control (pause/edit-script/add-contacts) | 07 Steps 3–11 | tests/windows (10), retry (11), pacing (9), pool-compliance (9); dry-run scenarios A–H |
| §6.2 | Opening hooks + disclosure, objection playbook, hot/warm/cold scoring, "call me tomorrow 5pm" callbacks, AMD/voicemail policy, sentiment escalation→transfer | 07 Steps 4, 8–9, 14.4–14.6 | tests/scoring (11), fallback (2) |
| §7 | Live dashboard + streaming transcript, listen/whisper/barge/takeover (Dograh mid-call audio = GATE, state machine built), skills-based transfer queues w/ context-before-accept, web dialer (browser audio = GATE), fallback policies (low-confidence/VIP/explicit-human) | 06 Steps 16–20 | tests/liveState (11), fallbackPolicy (12); E2E live-ops.spec |
| §8 | Real-time tiles (ASR/AHT/concurrency/burn), full CDR + 4-way cost, campaign funnel + per-number + time-heatmap, agent performance (adherence/escalation/hallucination/dead-air), AI QA auto-scoring 100% w/ rubrics, transcript FTS, CSV exports + print/PDF + scheduled digests, cost/margin analytics | 08 Steps 4–20 | tests/analytics (12), fts (4), qa (10), deadair (5), pii (8), digest (6); E2E analytics.spec |
| §9 | CRM 2-way sync (HubSpot + Zoho full; 4 adapters = GATE), calendars, Sheets/Zapier/Make/n8n recipes, BYOC SIP (GATE), event webhooks w/ HMAC + 8-retry backoff, public REST API v1 + SDK + docs page, MCP proxy (per-tenant = GATE), WhatsApp Business campaigns + call→WhatsApp fallback (DLT approval = GATE) | 05 (CRM), 08 Steps 16–17, 23–25, 04 Steps 15–17, 07 Steps 3g/6d/11 | tests/webhook-sign (5), api-schemas (7), crm-mapping (5), hubspot (4); E2E webhooks.spec |
| §10 | 3 tiers + feature gating, per-second 4-component metering w/ markup engine, wallet + low-balance alerts + auto top-up (tokenization = GATE), number rental, add-ons, Razorpay + Stripe, GST invoicing (IGST/CGST+SGST), free trial + KYC gate, reseller/agency panel | 09 Steps 0–17 | tests/billing-ratecard (13), feature-gates (7), invoice (9), stripe-sig (5), addons-autotopup-reseller (8); E2E billing.spec |
| §11 | TRAI/DLT/140-1600/DND (06/07), GDPR export + erasure, TCPA consent + instant opt-out cascade, recording disclosure (04 Step 6 first-node), encryption ops + secrets audit (12), PII redaction (Luhn/Aadhaar/email/OTP), retention auto-delete, audit trails, status page + uptime (monitor = GATE) | 04, 06, 07, 08 Steps 14–15, 21–22, 12 Steps 1b, 11–12 | tests/pii (8), retention (2); E2E gdpr.spec, status.spec |
| §12 | Horizontal worker scaling (12 Step 13), LLM failover chains (04 Step 6–7), trunk health checks + retry/backoff/idempotency (04 Steps 6, 13), queue workers + idempotent webhooks (07/08/09), observability: tracing/latency histograms/alerting (12 Steps 1a, 2, 10) | 04, 07, 08, 12 | dograh retry tests; /api/health + alert.sh tests (12 Step 7) |
| §13 | Signup→workspace, guided wizard (industry→template→KB→test call→number→live), template gallery, in-app checklist/tooltips/sample-data mode, India KYC flow | 10 Steps 4–10 | tests/onboarding (11), sample-data (7), domain-verify (9); E2E onboarding.spec, kyc.spec |
| §14 | Competitive-edge comparison table + full feature grid on landing | 10 Step 1 | responsive smoke pass (10 Step 14) |
| §15 | Roadmap — Phases 1–3 all in v1 (see above). Phase 4: predictive dialing (07 Step 3d), template marketplace (05 Steps 16–17), voice cloning + speech-to-speech (04 Step 18 scaffolding, GATE) | 04, 05, 07 | tests included in suites above |

## Test totals (guide 11 = the v1 gate)
- **Vitest: 50 files / 381 tests** + `scripts/schema-smoke.ts` (33 DB checks)
- **Playwright E2E: 15 spec files / 18 tests** (chromium, `@playwright/test@1.48.2`)
- **smoke-test.sh: 30 checks** (34 with `SMOKE_PROFILE=prod`) + `webhook-burst.sh`
- **Scripted integration/negative suites** in every guide (curl/bash/psql with exact Expected)
- **Acceptance gate** in guide 11 organized by readme §3–§13

## OPERATOR GATES (tracked in guide 11 v2 backlog, 23 items)
SAML bridge (WorkOS/Auth0) · Dograh KB API · Dograh whisper audio injection · webRTC test widget ·
Sarvam voice cloning · speech-to-speech pipeline · BYOC provider config · server-side PDF ·
Sheets OAuth · 4 CRM adapters · 3 calendar providers · Vobiz WhatsApp path + Meta/DLT approval ·
Razorpay tokenization/auto top-up · MCP per-tenant isolation · uptime monitor setup · others.
