# Vaani AI — Robustness, CRM & Production Guide

> **Purpose.** This documentation set converts the current Vaani AI application (a
> functional but frontier-stage product) into a **robust, production-ready,
> analytics-rich CRM platform** with an expanded UI component library, manual
> test coverage, and a forward-looking feature roadmap.
>
> **Audience.** Engineers (backend + frontend), SRE/DevOps, QA, and product
> owners responsible for shipping and operating Vaani AI in production.

---

## What is Vaani AI today?

Vaani AI is a **multi-tenant AI Voice Agent SaaS** for the Indian market. It lets
businesses create AI phone agents that replace human receptionists (inbound) and
telecallers (outbound) in 11+ Indian languages.

| Area | Current state |
|---|---|
| **Backend** | Next.js 14 App Router (API routes) + Prisma 5 (PostgreSQL 16) + BullMQ (Redis 7) workers |
| **Frontend** | Next.js 14 RSC + Tailwind 3.4 + **5 shadcn/ui components** (button, card, input, select, tooltip) |
| **Voice engine** | Self-hosted **Dograh** (FastAPI + Pipecat) for orchestration; Vobiz/Sarvam/OpenRouter for STT/LLM/TTS/telephony |
| **Data model** | 40+ Prisma models — tenancy, auth, agents, knowledge, telephony, campaigns, calls, integrations, billing, compliance |
| **App surface** | ~20 feature routes: dashboard, agents, analytics, campaigns, contacts, calls, billing, live, dialer, marketplace, settings |
| **Infra** | Docker Compose for dev; prod compose exists; Caddy for TLS; MinIO for object storage |
| **Tests** | Vitest unit tests + Playwright e2e config; coverage is **thin** — no manual test plan |

## What this guide adds

1. **[Production Readiness](production-readiness/)** — hardening, observability, security, scalability, disaster recovery.
2. **[CRM Features](crm-features/)** — pipeline, deals, activities, segmentation, lead scoring — the missing CRM layer.
3. **[Detailed Analytics](analytics/)** — executive dashboards, cohort/funnel analysis, cost attribution, custom reports.
4. **[UI Expansion (shadcn/ui)](ui-expansion/)** — grow from 5 to 40+ components with full usage examples.
5. **[New Features](new-features/)** — researched roadmap: real-time coaching, sentiment trends, voice cloning, omnichannel.
6. **[Manual Testing](manual-testing/)** — step-by-step manual test plans per module with pass/fail criteria.

---

## Document map

```
docs/
├── README.md                          ← you are here
├── production-readiness/
│   ├── 01-hardening-and-security.md
│   ├── 02-observability-and-monitoring.md
│   ├── 03-scalability-and-performance.md
│   ├── 04-disaster-recovery.md
│   └── 05-deployment-runbook.md
├── crm-features/
│   ├── 01-data-model-and-migrations.md
│   ├── 02-pipeline-and-deals.md
│   ├── 03-activities-and-tasks.md
│   ├── 04-segmentation-and-lead-scoring.md
│   └── 05-crm-analytics.md
├── analytics/
│   ├── 01-executive-dashboard.md
│   ├── 02-funnel-and-cohort-analysis.md
│   ├── 03-cost-and-revenue-attribution.md
│   └── 04-custom-reports-builder.md
├── ui-expansion/
│   ├── 01-component-catalog.md
│   ├── 02-installation-and-setup.md
│   ├── 03-dashboard-and-data-display.md
│   ├── 04-forms-and-inputs.md
│   └── 05-navigation-and-overlays.md
├── new-features/
│   ├── 01-real-time-call-coaching.md
│   ├── 02-sentiment-and-emotion-analytics.md
│   ├── 03-voice-cloning-and-brand-voices.md
│   ├── 04-omnichannel-messaging.md
│   └── 05-feature-roadmap.md
└── manual-testing/
    ├── 00-test-strategy.md
    ├── 01-auth-and-onboarding.md
    ├── 02-agent-builder.md
    ├── 03-inbound-receptionist.md
    ├── 04-outbound-campaigns.md
    ├── 05-crm-module.md
    ├── 06-analytics-module.md
    ├── 07-billing-and-wallet.md
    ├── 08-settings-and-admin.md
    └── 09-regression-checklist.md
```

---

## How to use this guide

### If you are hardening for launch
Read **[production-readiness/](production-readiness/)** end-to-end. The
[Deployment Runbook](production-readiness/05-deployment-runbook.md) is the
single source of truth for go-live.

### If you are building the CRM layer
Start with **[crm-features/01-data-model-and-migrations.md](crm-features/01-data-model-and-migrations.md)**
— it defines the new Prisma models (`Pipeline`, `Stage`, `Deal`, `Activity`,
`Segment`) that everything else builds on.

### If you are improving the UI
Follow **[ui-expansion/02-installation-and-setup.md](ui-expansion/02-installation-and-setup.md)**
to install the expanded component set, then reference
[01-component-catalog.md](ui-expansion/01-component-catalog.md) for usage.

### If you are a QA engineer
Execute the tests in **[manual-testing/](manual-testing/)** in order. Each file
contains a table of test cases with clear steps, expected results, and pass/fail
recording columns.

---

## Quick-start implementation order

For a team converting the app to robust + CRM-enabled production in ~6–8 weeks:

| Week | Track | Deliverable |
|---|---|---|
| 1 | Infra | Observability stack (Prometheus + Grafana + Loki), structured logging, health checks |
| 1 | UI | Install full shadcn/ui component catalog (see [ui-expansion/](ui-expansion/)) |
| 2 | CRM | Data model migration — pipelines, stages, deals, activities (see [crm-features/](crm-features/)) |
| 2 | Analytics | Executive dashboard with real KPIs (see [analytics/](analytics/)) |
| 3 | CRM | Pipeline board UI (Kanban), deal detail page, activity timeline |
| 3 | Hardening | Rate limiting, CSRF, audit log expansion, secrets rotation (see [production-readiness/](production-readiness/)) |
| 4 | Analytics | Funnel/cohort analysis, cost attribution, custom report builder |
| 4 | CRM | Segmentation engine, lead scoring v2 |
| 5 | Testing | Execute full manual test plan (see [manual-testing/](manual-testing/)) |
| 5 | Features | Real-time coaching MVP (see [new-features/](new-features/)) |
| 6 | Launch | Deployment runbook dry-run, disaster recovery drill, load test |
| 6–8 | Polish | Bug bash, performance tuning, documentation review |

---

## Conventions

- **INR-first**: all monetary values are in **paise** (integer, 1 INR = 100 paise) unless stated otherwise.
- **E.164**: all phone numbers are stored and validated in E.164 format (`+91…`).
- **Multi-tenant**: every query must filter by `workspaceId` — no exceptions.
- **Server-first**: prefer React Server Components; use `"use client"` only when interactivity is required.
- **shadcn/ui pattern**: components are **owned source files** under `src/components/ui/` (not an npm package), giving full control.

---

## Glossary

| Term | Meaning |
|---|---|
| **Workspace** | A tenant — one business's isolated data silo |
| **Agent** | An AI voice persona with a system prompt, voice, and tools |
| **Dograh** | The self-hosted voice orchestration engine (FastAPI + Pipecat) |
| **DID** | Direct Inward Dial — a phone number rented by a tenant |
| **CDR** | Call Detail Record — the `Call` model row with all call metadata |
| **DNC** | Do-Not-Call list entry |
| **AMD** | Answering Machine Detection |
| **Pacing** | Outbound dial rate cap (calls per minute) |
| **KYC** | Know-Your-Customer document verification (India regulatory) |
| **GST** | Goods & Services Tax (India) — applied to all B2B invoices |