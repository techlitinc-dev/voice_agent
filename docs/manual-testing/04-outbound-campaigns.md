# 04 — Outbound Campaign Tests

> Test cases for outbound campaign creation, launching, pacing, retries, DNC
> compliance, number pools, and the dialer. Uses seeded contacts from
> [00-test-strategy.md](00-test-strategy.md).

---

## A. Campaign Creation

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| CAMP-01 | Create campaign from scratch | 1. Go to `/campaigns/new`. 2. Name "Test Camp", pick agent, upload contact list. 3. Save draft. | Campaign saved as DRAFT; `CampaignContact` rows created. | ☐ |
| CAMP-02 | Create campaign from preset | 1. `/campaigns/new` → choose "Clinic Follow-up" preset. | Pacing, retry, windows, opening hook pre-filled from preset. | ☐ |
| CAMP-03 | Validate missing fields | 1. Submit campaign without agent or contacts. | Validation errors; form does not submit. | ☐ |
| CAMP-04 | Add contacts via CSV | 1. Open campaign → "Add contacts" → upload CSV with 50 rows. | Contacts imported; duplicates skipped or flagged. | ☐ |
| CAMP-05 | Duplicate contact handling | 1. Upload a CSV with numbers already in the campaign. | Duplicates not re-added; counts reported. | ☐ |
| CAMP-06 | Edit campaign details | 1. Open draft campaign → change opening hook, retry policy. 2. Save. | Changes persisted (mid-flight script edit also applies to queued). | ☐ |

## B. Launch, Pacing & Windows

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| CAMP-07 | Launch campaign | 1. Click Start on a draft campaign. | Status = RUNNING; dialer jobs enqueued in BullMQ. | ☐ |
| CAMP-08 | Pacing limit respected | 1. Set pacing to 5 calls/min. 2. Start with 100 contacts. 3. Watch dialer. | No more than ~5 dials/minute (check `redis-cli LRANGE bull:campaign-dialer:wait 0 10`). | ☐ |
| CAMP-09 | Pause & resume | 1. Click Pause mid-campaign. 2. Wait 2 min. 3. Resume. | Dials stop on pause; resume continues from remaining contacts. | ☐ |
| CAMP-10 | Cancel campaign | 1. Click Cancel on running campaign. | Status = CANCELLED; remaining contacts marked cancelled; no further dials. | ☐ |
| CAMP-11 | Calling window (TRAI) | 1. Set windows 09:00–21:00. 2. Schedule next attempt outside window. | Call deferred to next window (`nextAttemptAt`); TRAI guardrail enforced. | ☐ |
| CAMP-12 | Timezone-aware windows | 1. Import contacts with different timezones. 2. Start campaign. | Each contact called within its local calling window. | ☐ |
| CAMP-13 | Adaptive pacing ramp-up | 1. Start with high answer rate. 2. Watch dial rate over 10 min. | Dial rate ramps up as answer rate stays high. | ☐ |

## C. Retry & Disposition

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| CAMP-14 | Retry on no-answer | 1. Let a contact's number ring without answer. 2. Check retry policy (e.g., retry 3x). | Contact retried per policy with backoff + jitter. | ☐ |
| CAMP-15 | Retry on busy/AMD | 1. Call a busy number, then a voicemail. | Disposition-specific retries applied (busy sooner, AMD maybe not retried). | ☐ |
| CAMP-16 | Max attempts reached | 1. Let a contact exhaust all retries. | Contact status = FAILED; removed from queue; no further calls. | ☐ |
| CAMP-17 | Smart retry window | 1. Enable Smart Retries v2; let a contact get no-answer twice. | Next attempt scheduled at learned optimal window for that contact. | ☐ |
| CAMP-18 | Disposition recorded | 1. Complete several calls with different outcomes. 2. Check campaign detail. | Disposition breakdown (ANSWERED, NO_ANSWER, BUSY, AMD…) shown per contact. | ☐ |

## D. Compliance & DNC

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| CAMP-19 | DNC scrub on launch | 1. Add a contact to DNC. 2. Launch campaign containing that contact. | Contact skipped with status = DNC; not dialed. | ☐ |
| CAMP-20 | Opt-out during call | 1. Contact says "stop calling". 2. Check DNC after call. | DNC entry created; contact removed from active queue. | ☐ |
| CAMP-21 | Series 140/1600 prefix rules | 1. Rent a 140-number, launch campaign. 2. Verify per-number daily/lifetime caps configured. | Dialing stops at cap; caps configurable in `/campaigns/pools`. | ☐ |
| CAMP-22 | Consent tracking | 1. Call contact with no consent record. 2. Ask consent question. | Consent captured with timestamp; `consentAt` set; opt-out respected. | ☐ |

## E. Number Pools & Dialer

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| CAMP-23 | Pool DID rotation | 1. Create pool with 3 DIDs. 2. Launch campaign using pool. | Caller IDs rotate across pool DIDs. | ☐ |
| CAMP-24 | Per-number daily cap | 1. Set daily cap 50 on pool. 2. Let campaign exceed. | Pool number pauses for the day; dialer switches to next DID. | ☐ |
| CAMP-25 | Manual dial | 1. Go to `/dialer`. 2. Enter number, pick agent, dial. | Manual call placed via `manual-dial` job; CDR created. | ☐ |
| CAMP-26 | Web dialer call state | 1. In dialer, answer a manual call. | Call status transitions RINGING → IN_PROGRESS → COMPLETED. | ☐ |

## F. WhatsApp Campaigns

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| CAMP-27 | WhatsApp template approval | 1. Go to `/campaigns/whatsapp`. 2. Create template, submit for approval. | Template shows PENDING → APPROVED (or rejected with reason). | ☐ |
| CAMP-28 | Send WhatsApp campaign | 1. Create approved template + contact list. 2. Launch. | Messages sent; delivery status per contact tracked. | ☐ |
| CAMP-29 | DLT ID validation | 1. Create template with missing/invalid DLT id. | Validation error; template cannot be submitted. | ☐ |

---

## Prerequisites

- Seeded contact lists (100 contacts across 2 lists) from the strategy doc.
- At least 3 rented DIDs for pool tests (E section).
- A real phone to answer calls (C/D section disposition tests).
- Redis CLI access to inspect BullMQ queue state.

## Notes

- For CAMP-08/13, watch the queue with `redis-cli LRANGE bull:campaign-dialer:wait 0 10` and campaign progress bar on `/campaigns/[id]`.
- For CAMP-19, seed a `DncEntry` via contacts page DNC toggle before launching.
- Verify campaign statuses and `CampaignContact.status` with `psql`.
- Cross-browser: run CAMP-07, CAMP-25 on Chrome and Safari.
