# Voice Agent Monorepo — Autonomous QA Suite

Zero-human-intervention testing guide for the `/root/voice_agent` monorepo
(vaani-ai + dograh + CRM-AI-V2).

## The One Command

```bash
./qa/orchestrator.sh                 # full chain, phases 1→7
./qa/orchestrator.sh --phase 3       # single phase
./qa/orchestrator.sh --continue-on-fail --json-only
```

Everything below is driven by that script. No manual gates.

## Deliverables

| Deliverable | Path |
|-------------|------|
| A. Master Orchestrator | `qa/orchestrator.sh` + `qa/scripts/phase{1..7}-*.sh` |
| B. Test Cards (every phase, every module) | `qa/test-cards/00..07-*.md` |
| C. Mock/Fixture Data | `qa/docs/fixtures.md` |
| D. Environment Matrix | `qa/docs/env-matrix.md` |
| E. Rollback & Recovery | `qa/docs/rollback-recovery.md` + `qa/scripts/rollback.sh` |
| F. Go/No-Go Matrix | `qa/docs/go-no-go.md` |

## Chain

Setup (GS-SETUP) → 7 phases, unbroken `NEXT TEST ID` chain (see
`qa/test-cards/00-global-state.md`) → GS-TEARDOWN. Output JSON per phase lands
in `qa/state/phase-<N>.json`; final verdict in `qa/state/report.json`.

## What's tested (real modules)

- **vaani-ai** (Next.js 14 + Prisma + BullMQ + Vitest/Playwright):
  billing, auth/TOTP, campaign engine, dial jobs, analytics, PII, webhooks,
  rate limits, CRM sync, knowledge, retention, exports.
- **dograh** (FastAPI + pipecat + pytest + MCP): auth, workflows, MCP server,
  telephony, service factories, pipeline engine, embed/chat, quota/billing,
  WebRTC signaling, worker sync.
- **CRM-AI-V2**: planning docs (product spec drives threshold assertions).

## Exit codes

- `0` GO — deploy
- `1` NO-GO — block deploy, run rollback
- `2` BLOCKED — environment/setup failure
