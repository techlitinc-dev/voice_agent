# AI Voice Agent SaaS — Product Feature Specification
**Inbound + Outbound Calling Platform · Receptionist & Telecaller Replacement**

**Stack:** Vobiz (telephony/SIP) + Dograh (voice agent orchestration, self-hosted) + Sarvam.ai (STT/TTS) + OpenRouter (LLM routing)..

---

## 1. Product Overview

A multi-tenant SaaS where any business can create AI voice agents that fully replace human receptionists and telecallers — answering every inbound call 24/7 and running outbound calling campaigns at scale, in Indian and international languages, with human-level conversation quality and sub-second latency.

**Target customers:** clinics/hospitals, real estate, ed-tech, BFSI/collections, e-commerce, logistics, salons/spas, hotels, recruitment, D2C brands, and BPOs/agencies (white-label).

**Core value proposition:** One AI agent costs less per month than one day of a telecaller's salary, never takes leave, never has a bad day, speaks 11+ Indian languages, and scales from 10 to 10,000 concurrent calls instantly.

---

## 2. Platform Architecture (Why This Stack)

| Layer | Technology | Role |
|---|---|---|
| Telephony / PSTN | **Vobiz** | SIP trunking, DID numbers (140/1600/92/toll-free/130+ countries), inbound & outbound calls, call recording, real-time audio streaming (WebSocket), ~80ms telephony latency, WhatsApp Business API, TRAI/DLT-compliant India routes [^1^] |
| Orchestration | **Dograh** (self-hosted, BSD 2-Clause) | Visual workflow builder for conversational logic, Pipecat-based real-time pipeline, telephony abstraction, human-transfer tool, RAG/knowledge base, call logs, analytics, MCP server [^2^] |
| Speech-to-Text | **Sarvam.ai Saarika v2.5 / Saaras v3** | Streaming Indian-language STT with auto language detection, code-mixed (Hinglish) support: hi, bn, kn, ml, mr, od, pa, ta, te, gu, en-IN [^3^] |
| Text-to-Speech | **Sarvam.ai Bulbul v3** | 39 natural Indian voices, streaming output, mulaw/8kHz output for telephony [^3^] |
| LLM Brain | **OpenRouter** | One endpoint for 400+ models (GPT, Claude, Gemini, Llama, DeepSeek, etc.), automatic failover across 70+ providers, per-model pricing control, `:nitro` (speed) / `:floor` (cost) routing [^4^] |
| Backend | Dograh APIs + custom services | Multi-tenancy, billing, campaign engine, CRM integrations, webhooks |
| Data | PostgreSQL + Redis + S3-compatible object storage | Tenants, CDRs, recordings, transcripts, campaign state |

**Key architectural advantage:** Dograh natively supports Vobiz telephony, Sarvam STT, and OpenRouter as an LLM provider [^2^] — the four components connect via configuration, not custom code. Self-hosting Dograh means **zero per-minute platform fees** (unlike Vapi's $0.05/min), giving the SaaS a structural cost advantage and full data sovereignty for enterprise/regulated customers.

---

## 3. Multi-Tenancy & User Management

### 3.1 Tenancy Model
- **Workspace (tenant) isolation:** separate numbers, agents, campaigns, contacts, recordings, billing per workspace
- **Data isolation:** row-level tenant scoping in PostgreSQL; optional dedicated database or fully air-gapped on-prem deployment for enterprise (Dograh supports VPC/on-prem/air-gapped installs) [^2^]
- **Custom domains & white-label:** agencies resell under their own brand, logo, colors, domain

### 3.2 Roles & Permissions
- **Owner** — billing, API keys, everything
- **Admin** — manage agents, campaigns, users, numbers
- **Manager** — campaigns, contacts, analytics, call recordings
- **Agent/Supervisor** — live-call monitoring, whisper/barge, take-over
- **Viewer** — dashboards and reports only
- Granular feature-level permission matrix; audit log of every user action

### 3.3 Authentication & Security
- Email/password + Google SSO; enterprise SAML/OIDC SSO
- Two-factor authentication (TOTP)
- API keys with scopes + IP allowlisting
- Session management, device history, forced logout

---

## 4. AI Agent Builder

### 4.1 Visual Workflow Builder (Dograh-powered)
- Drag-and-drop conversation flows: greeting → qualification → FAQ → booking → transfer/hangup
- Branching on intent, entities, sentiment, and custom variables
- Multi-agent flows: specialist agents (greeter → qualifier → scheduler) with clean handoffs [^2^]
- No-code editing so non-engineers can change prompts/scripts without deployments
- Version control for agent flows: drafts, publish, rollback, A/B versions
- **Test-in-browser:** talk to your agent via webRTC widget before assigning a phone number

### 4.2 Agent Configuration
- **Voice selection:** Sarvam Bulbul v3's 39 voices; per-language voice mapping [^3^]
- **Language mode:** fixed language, auto-detect (Saarika `languageCode: unknown`), or caller-selectable ("Hindi ke liye 1 dabaiye")
- **LLM selection per agent:** pick any OpenRouter model per use case — cheap models (Llama/DeepSeek via `:floor`) for simple FAQ agents, premium models for complex sales conversations; automatic failover chain if a provider rate-limits or goes down [^4^]
- **Personality & script:** system prompt templates per industry (clinic receptionist, real-estate qualifier, EMI collections, delivery confirmation…)
- **Conversation controls:** interruption/barge-in handling, VAD tuning, max call duration, silence timeout, filler phrases, speaking pace
- **Hybrid pre-recorded + TTS:** pre-record predictable utterances (greetings, disclosures) to cut TTS cost up to 3× and guarantee compliance-critical lines are said perfectly [^2^]
- **Latency budget:** streaming STT → streaming LLM → streaming TTS targeting <800ms end-to-end (Vobiz contributes only ~80ms) [^1^]

### 4.3 Knowledge Base (RAG)
- Upload PDFs, DOCX, URLs, FAQs, product catalogs, price lists
- Automatic chunking, embedding, and retrieval during live calls
- Per-agent knowledge scoping; refresh/re-index on schedule
- Guardrails: agent answers only from knowledge base or says "let me confirm and call you back"

### 4.4 Tools & Actions (function calling)
Mid-call actions the LLM can trigger:
- **Book appointment** — calendar availability check + booking (Google Calendar, Calendly, Cal.com)
- **Transfer to human** — warm transfer with context whisper to the receiving agent [^2^]
- **Send SMS/WhatsApp** — confirmation, payment link, brochure via Vobiz WhatsApp Business API [^1^]
- **CRM write** — create/update lead, log call outcome
- **Payment collection** — read out + send UPI/payment link, confirm payment status
- **Custom webhooks/API calls** — any REST endpoint with auth, request/response mapping
- **Take a message / voicemail capture**

---

## 5. Inbound Calling (AI Receptionist)

- **24/7 answering** on dedicated numbers: local DIDs, toll-free 1800, mobile series via Vobiz (130+ countries) [^1^]
- **Smart greeting by context:** business hours, caller history (returning caller → "Welcome back, Mr. Sharma"), holiday calendar
- **Call routing/IVR replacement:** natural-language intent detection instead of "press 1" menus — caller just says what they need
- **Core receptionist skills:**
  - Appointment booking/rescheduling/cancellation with live calendar sync
  - FAQ answering from knowledge base (hours, location, pricing, policies)
  - Lead capture: name, number, requirement → CRM
  - Call forwarding to departments/humans on demand or by intent
  - Message taking with instant email/WhatsApp summary to staff
- **Spam & robocall filtering**
- **Voicemail-to-text** with transcription and routing
- **Missed-call handling:** if lines are busy or after hours, AI calls the customer back automatically
- **Simultaneous calls:** unlimited concurrency — no "all our agents are busy" ever again
- **After-call automation:** transcript + summary + recording + extracted data pushed to CRM/webhook within seconds

---

## 6. Outbound Calling (AI Telecaller)

### 6.1 Campaign Engine
- **Contact list management:** CSV/Excel upload, API sync, CRM import; dedupe, validation, DNC scrubbing
- **Bulk dialing:** up to 1,000 destinations per API request via Vobiz; parallel dialing with configurable CPS (calls/sec) and concurrency [^1^]
- **Scheduling:** timezone-aware dialing windows, business-hours enforcement, day-of-week rules
- **Retry logic:** configurable attempts per disposition (busy, no-answer, failed, voicemail), smart spacing between retries
- **Number pool rotation:** spread calls across multiple DIDs with per-number daily/lifetime caps to prevent spam-flagging [^1^]
- **TRAI-compliant series:** 140 (promotional) and 1600 (service/transactional) number support for India; DLT registration guidance built into onboarding [^1^]
- **Campaign types:** lead qualification, appointment reminders, payment/EMI reminders, feedback/NPS surveys, order/delivery confirmation, reactivation/win-back, event invites, political/survey campaigns
- **Throttling & pacing:** progressive ramp-up, answer-rate adaptive pacing
- **Live campaign control:** pause, resume, edit script mid-flight, add contacts to a running campaign

### 6.2 Conversation Intelligence (Outbound)
- **First-15-seconds optimization:** configurable opening hooks, identity disclosure
- **Objection handling:** LLM-driven dynamic responses guided by playbook
- **Interest scoring & lead qualification:** hot/warm/cold classification with reasons
- **Callback scheduling:** "call me tomorrow at 5" → automatic follow-up task
- **Voicemail/AMD detection:** leave message or hang up per policy
- **Sentiment-aware escalation:** angry/abusive callers → polite exit + human flag

---

## 7. Human-in-the-Loop & Live Operations

- **Live call dashboard:** every active call with real-time transcript streaming
- **Listen / Whisper / Barge:** supervisor can silently listen, coach the AI (whisper text injected as context), or take over the call
- **Human transfer queues:** skills-based routing to available human agents with full context handoff (transcript + summary shown before accepting)
- **Web dialer for humans:** softphone in-browser for manual calls from the same numbers
- **Fallback policies:** auto-transfer on low confidence, repeated misunderstanding, explicit "I want a human," or VIP caller ID match

---

## 8. Analytics, Reporting & Quality

- **Real-time dashboards:** calls in progress, ASR (answer seize ratio), AHT, concurrency, cost/minute burn
- **Call detail records (CDR):** every call with recording, full transcript, summary, extracted entities, sentiment, outcome/disposition, duration, cost breakdown (telephony + STT + LLM + TTS)
- **Campaign reports:** reach rate, connect rate, conversion funnel (dialed → answered → qualified → booked), per-number performance, best time-to-call heatmap
- **Agent performance:** script adherence, escalation rate, hallucination flags, dead-air detection
- **AI QA / auto-scoring:** LLM-based call scoring against custom rubrics (greeting, compliance lines, closing) — sample 100% of calls, not 2%
- **Searchable call library:** full-text search across all transcripts
- **Exports & scheduled reports:** CSV/PDF, daily/weekly email digests, webhook pushes
- **Cost analytics:** per-tenant, per-agent, per-campaign unit economics with margin tracking

---

## 9. Integrations & Extensibility

- **CRM:** HubSpot, Zoho, Salesforce, LeadSquared, Freshsales, Pipedrive (two-way sync)
- **Calendars:** Google, Microsoft 365, Calendly, Cal.com
- **Sheets & no-code:** Google Sheets, Airtable, Zapier, Make, n8n
- **Telephony:** bring-your-own-carrier (BYOC) SIP in addition to bundled Vobiz numbers [^1^]
- **Webhooks:** event subscriptions (call.started, call.completed, lead.qualified, campaign.finished…) with retries and signature verification
- **Public REST API + SDKs:** everything in the dashboard is API-accessible (agents, campaigns, contacts, calls, numbers)
- **MCP server:** let customers' AI tools (Claude Code, Cursor) create/modify agents programmatically [^2^]
- **WhatsApp Business:** template campaigns + call-to-WhatsApp fallback via Vobiz [^1^]

---

## 10. Billing & Monetization (Your SaaS Revenue)

- **Subscription tiers:** Starter / Growth / Enterprise — minutes bundles, agent count, seats, features gating
- **Usage metering:** per-second call metering across telephony + STT + LLM + TTS with markup engine (you buy wholesale from Vobiz/Sarvam/OpenRouter, sell at your price)
- **Wallet/prepaid credits** for usage-based plans; low-balance alerts and auto top-up
- **Number rental:** monthly DID rental passed through with margin
- **Add-ons:** extra concurrent lines, premium voices, white-label, dedicated infra
- **Payment gateways:** Razorpay/Stripe; INR + GST invoicing for Indian customers [^1^]
- **Free trial:** sandbox number + trial minutes, KYC-gated to prevent abuse
- **Reseller/agency panel:** sub-account provisioning, wholesale rate cards, revenue reports (Vobiz's embeddable multi-tenant partner API supports this natively) [^1^]

---

## 11. Compliance, Security & Trust

- **India:** TRAI/TCCCPR compliance, DLT-registered headers/templates, 140/1600 series separation (promotional vs service), DND registry scrubbing, permitted calling hours enforcement
- **Global:** GDPR-ready (data export, right-to-erasure of recordings/transcripts), TCPA-friendly outbound controls (consent flags, opt-out detection — "stop calling me" honored instantly and added to DNC)
- **Call recording disclosure:** configurable legal disclaimer playback per jurisdiction
- **Data security:** encryption at rest & in transit (TLS/SRTP on Vobiz trunks [^1^]), PII redaction in transcripts (card numbers, Aadhaar), role-based access to recordings
- **Retention policies:** auto-delete recordings/transcripts after N days per tenant config
- **Enterprise data sovereignty:** self-hosted/VPC/air-gapped deployment option — call audio, transcripts, and models never leave the customer's perimeter [^2^]
- **Audit trails, uptime SLA, status page**

---

## 12. Reliability & Scale

- Horizontal scaling from 10 to 10,000+ concurrent calls (Vobiz handles 3M+ calls/day, 99.99% uptime) [^1^]
- **LLM failover chains:** OpenRouter auto-fails over across providers/models mid-traffic — a rate-limited provider never kills a live call [^4^]
- Redundant media paths, health-checked SIP trunks, automatic retry on call setup failure
- Queue-based campaign workers with backpressure; idempotent webhooks
- Observability: per-call tracing across STT → LLM → TTS, latency histograms, error budgets, alerting (PagerDuty/Slack)

---

## 13. Onboarding & Self-Serve UX

1. **Sign up → workspace created** with trial credits
2. **Guided wizard:** pick industry → pick template agent → connect knowledge base → test call in browser → buy/assign number → go live in <30 minutes
3. Template gallery: dental clinic receptionist, real-estate qualifier, EMI reminder, restaurant reservations, salon booking, delivery confirmation, NPS survey…
4. In-app checklists, tooltips, sample data mode
5. India KYC flow for regulated number series; instant numbers for international

---

## 14. Competitive Edge Summary

| vs. Alternative | Your Advantage |
|---|---|
| Human telecallers | ~90% cost reduction, 24/7, infinite scale, zero attrition/training, perfect script adherence, instant multilingual |
| Vapi/Retell-based resellers | No per-minute platform fee (self-hosted Dograh) → better margins; data sovereignty option [^2^] |
| Single-model voice bots | OpenRouter = 400+ models, cost-optimized routing, no downtime on provider outages [^4^] |
| Global voice platforms | Sarvam = best-in-class Indian language/code-mixed speech; Vobiz = native TRAI/DLT compliance, 140/1600 numbers, INR billing [^1^][^3^] |
| Legacy IVR | Natural conversation instead of keypad menus; resolves, not just routes |

---

## 15. Suggested Roadmap

- **Phase 1 (MVP, weeks 1–8):** single-tenant-hardened core — agent builder (Dograh), inbound receptionist, CSV outbound campaigns, Vobiz numbers, Sarvam voices, OpenRouter models, recordings/transcripts, basic billing
- **Phase 2 (weeks 9–16):** full multi-tenancy, wallet billing + Razorpay/Stripe, campaign scheduling/retries/number rotation, live listen/whisper/barge, CRM + calendar integrations, analytics suite
- **Phase 3 (weeks 17–24):** white-label/reseller panel, WhatsApp campaigns, AI QA auto-scoring, enterprise VPC deployment, SAML SSO, public API + SDKs
- **Phase 4:** voice cloning (brand voice), speech-to-speech models for ultra-low latency, predictive dialing, marketplace of community agent templates

---

### Sources
[^1^]: Vobiz Docs & Platform — https://vobiz.ai/docs/introduction , https://www.vobiz.ai/ , https://www.vobiz.ai/blog/vobiz-vs-exotel-comparison
[^2^]: Dograh — https://www.dograh.com/ , https://hackernoon.com/inside-dograh-the-architecture-behind-an-open-voice-ai-stack , https://www.dograh.com/feeds/blog/create-ai-voice-agent
[^3^]: Sarvam.ai voice reference — https://mastra.ai/reference/voice/sarvam
[^4^]: OpenRouter model routing — https://openrouter.ai/blog/insights/model-routing/
