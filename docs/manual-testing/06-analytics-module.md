# 06 — Analytics Module Tests

> Test cases for the analytics suite: executive dashboard, call analytics, funnel
> & cohorts, campaign reports, cost attribution, and custom reports. Requires
> seeded calls (500 mixed) from [00-test-strategy.md](00-test-strategy.md).

---

## A. Dashboard

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| ANALYTICS-01 | Dashboard loads KPIs | 1. Go to `/dashboard`. | KPIs (calls, ASR, AHT, margin) render with trend vs last period. | ☐ |
| ANALYTICS-02 | Live tiles update | 1. Keep dashboard open. 2. Make a test call from a phone. | Live call tile updates via SSE (`/api/internal/dashboard/stream`). | ☐ |
| ANALYTICS-03 | Wallet balance shown | 1. Check wallet card on dashboard. | Balance matches `Wallet` in DB. | ☐ |
| ANALYTICS-04 | Dashboard date range | 1. Switch range 7d → 30d. | KPIs and charts recompute; labels correct. | ☐ |
| ANALYTICS-05 | Dashboard alerts | 1. Trigger a low-balance or failed-call alert (e.g., set balance low). | Alert banner appears on dashboard. | ☐ |

## B. Call Analytics

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| ANALYTICS-06 | Call analytics 30-day view | 1. Go to `/analytics`. | ASR, AHT, margin, volume charts correct vs `Call` data. | ☐ |
| ANALYTICS-07 | Filter by agent | 1. `/analytics` → filter by agent. | All metrics recompute for selected agent. | ☐ |
| ANALYTICS-08 | Filter by date | 1. Set custom date range with no calls. | Empty state shown, no divide-by-zero errors. | ☐ |
| ANALYTICS-09 | Transcript search | 1. `/calls` → search a keyword from a known transcript. | Full-text search returns matching calls (`src/lib/fts.ts`). | ☐ |
| ANALYTICS-10 | CSV export | 1. `/analytics` → Export CSV. | `/api/exports/analytics-summary.csv` streams; opens in spreadsheet. | ☐ |

## C. Funnel & Cohorts

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| ANALYTICS-11 | Call→deal funnel | 1. Go to `/analytics/funnel`. | Funnel steps (call → qualified → deal → won) with drop-off % correct. | ☐ |
| ANALYTICS-12 | Cohort retention | 1. `/analytics/funnel` → Cohorts tab. | Cohort table by first-call month; retention % computed. | ☐ |
| ANALYTICS-13 | Funnel date filter | 1. Narrow funnel to last 7 days. | Funnel recomputes; no NaN/missing rows. | ☐ |

## D. Campaign Reports

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| ANALYTICS-14 | Campaign report renders | 1. Go to `/analytics/campaigns`. 2. Pick a completed campaign. | Reach, connect rate, conversion shown. | ☐ |
| ANALYTICS-15 | Time-to-call heatmap | 1. Open campaign report → heatmap. | Heatmap by hour/day matches `CallEvent` timestamps. | ☐ |
| ANALYTICS-16 | Campaign compare | 1. Select 2 campaigns. | Side-by-side metrics render; totals consistent. | ☐ |

## E. Agent Performance & QA

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| ANALYTICS-17 | Agent performance page | 1. Go to `/analytics/agents`. | Script adherence, escalations, hallucinations per agent. | ☐ |
| ANALYTICS-18 | QA score drill-down | 1. Click a QA score on agent page. | Links to call detail with `QaScore` rubric breakdown. | ☐ |
| ANALYTICS-19 | Hallucination flag filter | 1. `/calls` → filter hallucination flag = true. | Only flagged calls shown; count matches DB. | ☐ |

## F. Cost & Attribution

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| ANALYTICS-20 | Cost & margins page | 1. Go to `/analytics/cost`. | Per-agent/campaign cost, margin, ROI shown in ₹. | ☐ |
| ANALYTICS-21 | Revenue recognition | 1. Open cost page → revenue tab. | Recognized revenue per deal matches won deals; MRR accurate. | ☐ |
| ANALYTICS-22 | Voice attribution | 1. Open `/crm/analytics` → voice attribution. | Deals attributed to voice source; attributed revenue correct. | ☐ |
| ANALYTICS-23 | Unit economics per call | 1. Open any call detail. | Cost breakdown (STT/LLM/TTS/telephony) sums to `billedPaise`. | ☐ |

## G. Custom Reports

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| ANALYTICS-24 | Create custom report | 1. `/reports/new`. 2. Pick metric + dimension + date range. 3. Save. | Report saved with correct row/column layout. | ☐ |
| ANALYTICS-25 | Run report | 1. Open saved report → Run. | Rows computed from live data; preview via `/api/internal/reports/preview`. | ☐ |
| ANALYTICS-26 | Export report CSV | 1. Report → Export. | `/api/reports/[id]/export.csv` streams; numbers match on-screen. | ☐ |
| ANALYTICS-27 | Report access control | 1. As `viewer@test.vaani.ai`, open a report owned by owner. | Blocked or read-only per permission matrix (no mutation). | ☐ |

---

## Prerequisites

- Seeded 500 calls with mixed statuses/directions (from strategy doc).
- At least one completed campaign with events for D section.
- A live call in progress for ANALYTICS-02 (or simulate).

## Notes

- For ANALYTICS-09, use a phrase you know exists in a seeded transcript.
- Verify funnel numbers with `psql` (count `Call`/`Deal` by stage).
- Cross-browser: run ANALYTICS-01 and ANALYTICS-14 on Chrome, Firefox, Safari.
