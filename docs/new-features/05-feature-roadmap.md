# 05 — Feature Roadmap (Researched)

> **Goal:** A prioritized roadmap of researched features that differentiate
> Vaani AI from competitors (Vapi, Retell, Exotel) and drive retention +
> expansion revenue. Each feature includes rationale, effort estimate, and
> impact.

---

## 1. Prioritization Framework

Features are scored on:

| Factor | Weight | Description |
|---|---|---|
| **Customer demand** | 30% | How many prospects/customers asked for it |
| **Revenue impact** | 25% | Upsell potential / competitive moat |
| **Effort** | 25% | Eng-weeks (lower is better) |
| **Strategic fit** | 20% | Alignment with "voice-native CRM" vision |

**Formula:** `Score = (Demand × 0.3) + (Revenue × 0.25) + (10 − Effort) × 0.25 + (Fit × 0.2)`

---

## 2. Roadmap Overview

```
NOW (Q3 2026)              NEXT (Q4 2026)            LATER (2027)
─────────────────          ─────────────────         ─────────────────
✓ CRM Pipeline             → Real-time Coaching      → Voice Cloning
✓ Detailed Analytics       → Sentiment Trends        → Omnichannel (WhatsApp native)
✓ shadcn/ui expansion      → Smart Retries v2        → AI Lead Nurturing
✓ Production hardening     → Call Highlights Reel    → Multi-region
✓ Manual test suite        → Approval Workflows      → Marketplace 2.0
                           → Voice A/B Testing       → Reseller Portal v2
                           → Webhook v2              → On-device Edge STT
```

---

## 3. Feature Catalog

### Tier 1 — NOW (ship in current quarter)

These are the focus of this documentation set — CRM, analytics, hardening, UI.

| Feature | Status | Doc |
|---|---|---|
| Native CRM (pipeline, deals) | Spec'd | [crm-features/](../crm-features/) |
| Detailed analytics | Spec'd | [analytics/](../analytics/) |
| shadcn/ui 40+ components | Spec'd | [ui-expansion/](../ui-expansion/) |
| Production hardening | Spec'd | [production-readiness/](../production-readiness/) |
| Manual test plan | Spec'd | [manual-testing/](../manual-testing/) |

---

### Tier 2 — NEXT (next quarter)

#### 3.1 Real-Time Call Coaching ★★★★★

**What**: Supervisors see live transcripts and inject "whispers" (suggestions the
caller can't hear) or "barge" (take over the call) in real-time.

**Why**: The existing `LiveCallState` model + `LiveMode` enum (LISTEN, WHISPER,
BARGE, TAKEOVER) already exist. The UI (`/live`) exists but is basic. This is the
#1 requested feature by sales-team customers.

**Effort**: 3 eng-weeks (UI polish + WebSocket for real-time transcript)

**Revenue**: Premium add-on (₹2,000/month per seat)

**Doc**: [01-real-time-call-coaching.md](01-real-time-call-coaching.md)

---

#### 3.2 Sentiment & Emotion Analytics ★★★★☆

**What**: Track caller sentiment (positive/neutral/negative) over the course of
each call, and aggregate into trends. Detect frustration, anger, joy.

**Why**: The `Call.sentiment` field exists but is a single value. Per-turn
sentiment enables: anger-escalation alerts, QA scoring, agent improvement.

**How**:
- Sarvam or OpenRouter to classify each transcript turn's emotion.
- Store as `TranscriptEntry.sentiment` (new field).
- Aggregate into `Call.sentimentTimeline Json?` (array of `{ ts, score }`).
- Chart on call detail page.

**Effort**: 2 eng-weeks

**Revenue**: Included in Growth plan; differentiator vs Vapi.

**Doc**: [02-sentiment-and-emotion-analytics.md](02-sentiment-and-emotion-analytics.md)

---

#### 3.3 Voice Cloning & Brand Voices ★★★★☆

**What**: Let enterprises clone a brand voice (their IVR voice, a celebrity
endorser, or a consistent agent persona) instead of using Sarvam's stock voices.

**Why**: Banks, hospitals, and D2C brands want a **consistent audio identity**.
This is a high-value enterprise feature competitors charge ₹50K+/month for.

**How**:
- Integrate a voice cloning provider (ElevenLabs, PlayHT, or Sarvam when
  available).
- New model: `CustomVoice { workspaceId, name, provider, sampleKey, clonedVoiceId, status }`.
- UI: upload 30s of sample audio → preview → assign to agents.
- Gate by plan: Enterprise only.

**Effort**: 3 eng-weeks

**Revenue**: Enterprise add-on (₹15,000/month)

**Doc**: [03-voice-cloning-and-brand-voices.md](03-voice-cloning-and-brand-voices.md)

---

#### 3.4 Omnichannel Messaging ★★★★☆

**What**: Beyond voice — let agents also handle WhatsApp, SMS, and web chat from
the same inbox. A unified "conversation" view.

**Why**: Customers don't just call. A lead might call, then WhatsApp their
documents, then SMS a question. Currently these are disconnected.

**How**:
- The `WhatsAppCampaign` / `WhatsAppTemplate` models exist.
- Unify into a `Conversation` model that spans channels.
- Single inbox UI: `/inbox` showing all conversations regardless of channel.
- AI agent can respond on any channel (voice, WhatsApp, SMS) with the same brain.

**Effort**: 5 eng-weeks

**Revenue**: Sticks users to Vaani (reduces churn).

**Doc**: [04-omnichannel-messaging.md](04-omnichannel-messaging.md)

---

#### 3.5 Smart Retries v2 ★★★☆☆

**What**: ML-based optimal retry timing. Instead of "retry in 60 min", predict
the best time to call back based on the contact's answer patterns.

**Why**: The `Campaign.retryPolicy` exists but is static. A contact who never
answers before 7 PM should be called after 7 PM.

**How**:
- Analyze per-contact answer rates by day-of-week and hour.
- Store as `Contact.optimalCallWindows Json?` (e.g. `{"mon":["18-21"], "tue":["18-21"]}`).
- Dialer respects this when scheduling retries.

**Effort**: 2 eng-weeks

---

#### 3.6 Call Highlights Reel ★★★☆☆

**What**: Auto-generate a 30-second audio highlight reel of the best moments of
each call (objection handling, successful close, laughter).

**Why**: Sales managers want to review calls quickly (1 min instead of 10 min).
Great for training.

**How**:
- Post-call worker selects 3–5 notable transcript segments.
- Stitch the corresponding audio segments into a single file.
- Store as `Call.highlightsKey String?` (MinIO object key).
- Play on call detail page.

**Effort**: 2 eng-weeks

---

#### 3.7 Approval Workflows ★★★☆☆

**What**: Deals above a threshold (e.g. > ₹5L) require manager approval before
moving to "Negotiation" or "Won".

**Why**: Enterprise governance. Banks and B2B SaaS need this for compliance.

**How**:
- New model: `ApprovalRequest { dealId, requestedBy, approvedBy, status, threshold }`.
- When a stage transition requires approval, create `ApprovalRequest` and notify manager.
- Manager approves/rejects in UI; on approval, the stage transition completes.

**Effort**: 2 eng-weeks

---

#### 3.8 Voice A/B Testing ★★★☆☆

**What**: The schema already supports `AgentVersion.isAbVariant` and
`abTrafficPercent`. Build the UI to create A/B tests: "Greeting A vs Greeting B",
track which converts better.

**Why**: Data-driven agent optimization. Existing schema is 90% there.

**Effort**: 1.5 eng-weeks

---

#### 3.9 Webhook v2 ★★☆☆☆

**What**: Expand the existing webhook system with: retry backoff visualization,
signed payloads (existing), event filtering (existing), and a visual event
builder.

**Effort**: 1.5 eng-weeks

---

### Tier 3 — LATER (next year)

#### 3.10 AI Lead Nurturing

**What**: Automated drip campaigns where the AI calls/WhatsApp/SMSes leads on a
schedule with dynamic content based on their behavior.

**Why**: "Set it and forget it" nurturing — a step beyond static campaigns.

**Effort**: 4 eng-weeks

---

#### 3.11 Multi-Region Deployment

**What**: Deploy in Mumbai + Singapore + US East for latency and data
sovereignty. Cross-region replication.

**Effort**: 6 eng-weeks + infra cost

---

#### 3.12 Marketplace 2.0

**What**: The `MarketplaceTemplate` model exists. Expand to a full marketplace:
community agents, paid templates, revenue share for creators.

**Effort**: 4 eng-weeks

---

#### 3.13 Reseller Portal v2

**What**: Self-serve reseller onboarding, white-label domain provisioning, tiered
commission tracking.

**Effort**: 3 eng-weeks

---

#### 3.14 On-Device Edge STT

**What**: For high-volume customers, run STT on-device (browser/mobile SDK)
instead of server-side, reducing Sarvam costs by 60%+.

**Effort**: 6 eng-weeks (R&D heavy)

---

#### 3.15 Compliance Call Disposition (TRAI)

**What**: Auto-classify call dispositions per TRAI regulations: transactional,
promotional, service. Auto-apply correct series (140/1600).

**Effort**: 2 eng-weeks

---

## 4. Competitive Analysis (researched)

| Feature | Vaani AI (target) | Vapi | Retell | Exotel |
|---|---|---|---|---|
| Voice AI agents | ✓ | ✓ | ✓ | ✗ (rules only) |
| Indian languages | ✓ (11+) | Limited | Limited | ✓ |
| Native CRM | ✓ (new) | ✗ | ✗ | ✓ (basic) |
| Pipeline + deals | ✓ (new) | ✗ | ✗ | ✗ |
| Real-time coaching | ✓ (new) | ✓ | ✓ | ✗ |
| Sentiment analytics | ✓ (new) | Basic | Basic | ✗ |
| Voice cloning | ✓ (new) | ✓ | ✗ | ✗ |
| Omnichannel | ✓ (new) | ✗ | ✗ | ✓ |
| Self-hostable | ✓ (Dograh) | ✗ | ✗ | ✗ |
| India compliance (TRAI/DLT) | ✓ | ✗ | ✗ | ✓ |
| Razorpay/GST billing | ✓ | ✗ | ✗ | ✓ |
| Price (per minute) | ₹0.75–2.5 | ₹2–4 | ₹3–5 | ₹0.50–1.5 |

**Differentiators**: India-first, native CRM, self-hostable, TRAI-compliant, at a
lower price point than Vapi/Retell.

---

## 5. Revenue Impact Projection

| Feature | Plan gate | Projected MRR uplift (100 tenants) |
|---|---|---|
| CRM Pipeline | Growth+ (included) | Reduces churn 15% = saves ₹75K/mo |
| Real-time Coaching | Add-on ₹2K/seat | 30 seats × ₹2K = ₹60K/mo |
| Voice Cloning | Enterprise ₹15K/mo | 5 enterprises = ₹75K/mo |
| Sentiment Analytics | Growth+ (included) | Conversion upgrade +10% = ₹20K/mo |
| Omnichannel | Growth+ (included) | Reduces churn 10% = saves ₹50K/mo |
| **Total projected uplift** | | **₹2,80,000/mo (₹33.6L ARR)** |

---

## Next

→ [01 — Real-Time Call Coaching](01-real-time-call-coaching.md)