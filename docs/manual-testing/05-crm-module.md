# 05 — CRM Module Tests

> Test cases for the CRM layer: pipelines, deals, tasks, segments, lead scoring,
> approvals, and contacts. Seed data from [00-test-strategy.md](00-test-strategy.md)
> includes 10 deals in various stages.

---

## A. Pipeline & Deals

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| CRM-01 | Pipeline board renders | 1. Go to `/crm/pipeline`. | Kanban board shows stages with deal cards; counts per stage match DB. | ☐ |
| CRM-02 | Create pipeline | 1. `/crm/pipeline` → New pipeline. 2. Add stages with probabilities. 3. Save. | Pipeline appears in selector; default stages present. | ☐ |
| CRM-03 | Reorder stages | 1. Open pipeline → drag stages to reorder. | Order persisted; probability stays with stage. | ☐ |
| CRM-04 | Create deal | 1. `/crm/deals/new`. 2. Fill name, value ₹50,000, stage, owner. 3. Save. | Deal created and appears on board + list. | ☐ |
| CRM-05 | Move deal across stages | 1. Drag a deal card from New to Qualified. | Stage updated; `Activity` logged; pipeline value recalculated. | ☐ |
| CRM-06 | Mark deal won | 1. Drag deal to Won stage (or click Mark Won). | Deal status WON; revenue counted in funnel; `isWonStage` honored. | ☐ |
| CRM-07 | Mark deal lost | 1. Drag deal to Lost stage. 2. Enter reason. | Deal status LOST; reason recorded in `DealNote`. | ☐ |
| CRM-08 | Edit deal | 1. Open `/crm/deals/[id]/edit`. 2. Change value/owner/close date. 3. Save. | Values updated; edit activity logged. | ☐ |
| CRM-09 | Delete deal | 1. Open deal → Delete. 2. Confirm. | Deal removed; related activities cleaned or preserved. | ☐ |
| CRM-10 | Deal filters | 1. `/crm/deals` → filter by stage, owner, value range. | Filters applied; empty state when no matches. | ☐ |
| CRM-11 | Deal from call | 1. Make a call where caller shows purchase intent. 2. Check CRM. | Deal auto-created with `createdFromCallId` set. | ☐ |
| CRM-12 | Deal notes & activity timeline | 1. Open deal → add note. 2. Move stage. | Timeline shows note + stage change entries. | ☐ |

## B. Tasks

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| CRM-13 | Create task | 1. `/crm/tasks` → New task. 2. Set type, due date, assignee. 3. Save. | Task appears in Today bucket (or Upcoming by date). | ☐ |
| CRM-14 | Task reminder | 1. Create task with reminder 15 min ahead. | Reminder fires (email/in-app notification). | ☐ |
| CRM-15 | Complete task | 1. Mark task done. | Task moves to Completed bucket with timestamp. | ☐ |
| CRM-16 | Overdue task | 1. Set due date in past (or wait). | Task shows in Overdue bucket. | ☐ |
| CRM-17 | Auto-create from call | 1. Make call with "call me back Tuesday" intent. | `Task` auto-created from `CallbackTask`/post-call extraction. | ☐ |
| CRM-18 | Task ownership visibility | 1. As `agent@test.vaani.ai`, view tasks. | Agent sees only own/assigned tasks (role-scoped). | ☐ |

## C. Segments & Lead Scoring

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| CRM-19 | Create static segment | 1. `/crm/segments/new`. 2. Add rule: city = "Mumbai". 3. Save. | Segment created; member count correct. | ☐ |
| CRM-20 | Segment live preview | 1. In segment builder, add rule and click Preview. | `/api/crm/segments/preview` returns matching contacts. | ☐ |
| CRM-21 | Dynamic segment updates | 1. Create dynamic segment (e.g., deal value > ₹1L). 2. Add a matching deal. | Segment membership updates automatically. | ☐ |
| CRM-22 | Segment used in campaign | 1. Create campaign from a segment. | Contacts resolved from segment at launch time. | ☐ |
| CRM-23 | Lead score displayed | 1. Open contact with scoring enabled. | Score 0–100 with grade and top factors listed. | ☐ |
| CRM-24 | Score factors explanation | 1. Hover/expand score on a contact. | Reasons shown (engagement, fit, recency); `LeadScore.reasons` populated. | ☐ |
| CRM-25 | Segment export | 1. On a segment, click Export CSV. | CSV streams via `/api/exports/contacts.csv` filtered to segment. | ☐ |

## D. Approvals

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| CRM-26 | Approval workflow config | 1. `/settings/crm` → set threshold ₹1,00,000 and stage gate "Qualified". | Config saved to Workspace. | ☐ |
| CRM-27 | Deal triggers approval | 1. Create deal > threshold. 2. Move it past the gated stage. | `ApprovalRequest` created; deal blocked pending approval. | ☐ |
| CRM-28 | Approve deal | 1. As manager, open approval → Approve. | Deal proceeds; approval event in activity timeline. | ☐ |
| CRM-29 | Reject deal | 1. As manager, reject with reason. | Deal stays at gated stage; rejection noted. | ☐ |
| CRM-30 | Approval notifications | 1. Trigger approval while manager logged in. | Manager sees pending badge/notification. | ☐ |

## E. Contacts

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| CRM-31 | Contact detail | 1. Open `/contacts/[phone]`. | Profile with call history, deals, consent status, DNC status. | ☐ |
| CRM-32 | CSV import | 1. `/contacts` → Import CSV. 2. Upload 100-row file. | Contacts upserted; duplicates merged; summary shown. | ☐ |
| CRM-33 | Contact DNC toggle | 1. Open contact → toggle DNC. | `DncEntry` created; contact excluded from campaigns. | ☐ |
| CRM-34 | Contact consent | 1. Open contact → record consent. | `consentAt` set; consent history visible. | ☐ |
| CRM-35 | CRM import | 1. Connect HubSpot (or stub) → Import contacts. | Contacts pulled from CRM provider; `crmExternalId` set. | ☐ |
| CRM-36 | Cross-tenant isolation | 1. As `tenant2@other.vaani.ai`, search for a contact owned by tenant 1. | No results — data strictly workspace-scoped. | ☐ |

---

## Prerequisites

- Seeded deals/contacts from the strategy doc.
- A manager account for approval tests (C section).
- Connected CRM integration (or stub provider) for CRM-35.

## Notes

- For CRM-05/06/07, verify `Activity` rows via `psql` (ActivityType includes stage moves, approvals).
- For CRM-24, confirm `LeadScore` factors render — this is a QA-focused feature; report as bug if factors are empty.
- Cross-browser: run CRM-01, CRM-19 on Chrome and Firefox (drag & drop).
