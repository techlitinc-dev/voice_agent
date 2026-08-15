# 03 — Inbound Receptionist Tests

> Test cases for inbound call handling: greeting, routing, smart fallback,
> voicemail, transfers, and live supervisor features. Requires a published
> inbound agent with a test DID on staging.

---

## A. Basic Inbound Flow

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| INBOUND-01 | Call agent on DID | 1. Call the staging DID from a real phone. 2. Wait for greeting. | Call answered by agent with configured greeting within ~3s. | ☐ |
| INBOUND-02 | Returning caller greeting | 1. Call from a number with prior call history. | Different (returning-caller) greeting played; context recalled. | ☐ |
| INBOUND-03 | Spam filter block | 1. Add caller number to manual block / spam prefix. 2. Call again. | Call rejected before agent; no CDR, or CDR with blocked disposition. | ☐ |
| INBOUND-04 | Caller asks common question | 1. Call, ask "what are your opening hours?" | Agent answers from knowledge/script. | ☐ |
| INBOUND-05 | Caller speaks a different language | 1. Call, greet in Hindi. | Agent switches to Hindi (language-mode pre-flow). | ☐ |
| INBOUND-06 | Call disconnects mid-conversation | 1. Call, hang up mid-sentence. | Call marked ended; CDR has `duration` and ended status. | ☐ |

## B. Call Detail & Recording

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| INBOUND-07 | CDR created with transcript | 1. Complete a short inbound call. 2. Go to `/calls`. 3. Open the call. | CDR row + full transcript with speaker turns; sentiment per turn. | ☐ |
| INBOUND-08 | Recording playback | 1. Open call detail → play recording. | Audio streams from MinIO; PII redaction applied if enabled. | ☐ |
| INBOUND-09 | QA score & flags | 1. Open a completed call with an objection. | QA score shown; hallucination/dead-air flags populated. | ☐ |
| INBOUND-10 | Call report export | 1. Open call detail → Print report (`/calls/[id]/report`). | Print-friendly PDF with summary, transcript, cost. | ☐ |
| INBOUND-11 | Highlight reel | 1. Open a call with an objection + resolution. | Highlight clip generated and playable. | ☐ |
| INBOUND-12 | Interest score | 1. Make call where caller expresses intent to buy. | `interestScore` reflected on call detail / funnel. | ☐ |

## C. Transfers & Fallback

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| INBOUND-13 | Ask for human | 1. Call, say "I want to talk to a human". | Call transferred via `TransferRequest`; human queue updated. | ☐ |
| INBOUND-14 | Skill-based routing | 1. Call, ask for "billing". 2. Have only a billing-skilled agent available. | Transfer routes to the billing-skilled agent. | ☐ |
| INBOUND-15 | No human available | 1. Ask for human while all agents offline. | Voicemail prompt offered; `VoicemailMessage` recorded. | ☐ |
| INBOUND-16 | VIP customer transfer | 1. Call from a VIP-tagged number, ask for human. | Transfer decision is VIP (direct to human, no script attempt). | ☐ |
| INBOUND-17 | Misunderstanding fallback | 1. Ask something ambiguous repeatedly (low confidence). | Fallback policy kicks in (transfer/voicemail) instead of looping. | ☐ |
| INBOUND-18 | Voicemail capture | 1. Call after hours (outside schedule) or no agents. | Voicemail prompt; message saved; callback task auto-created. | ☐ |

## D. Live Supervisor Features

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| INBOUND-19 | Live calls board | 1. While a call is active, open `/live` as supervisor. | Active call listed with live transcript tail (SSE). | ☐ |
| INBOUND-20 | Listen mode | 1. On `/live/[callId]`, click Listen. | Supervisor hears audio, cannot speak. | ☐ |
| INBOUND-21 | Whisper mode | 1. Click Whisper, type "ask about the discount". | Agent hears whisper; caller does not; agent acts on it. | ☐ |
| INBOUND-22 | Barge mode | 1. Click Barge, speak to caller. | Both hear supervisor; agent pauses. | ☐ |
| INBOUND-23 | Takeover | 1. Click Takeover. | Supervisor takes over the call; agent stops. `LiveCallState` updated. | ☐ |
| INBOUND-24 | Live call permissions | 1. Log in as `viewer@test.vaani.ai`, open `/live`. | Viewer blocked (requires AGENT role or higher). | ☐ |

## E. Post-Call Automation

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| INBOUND-25 | Missed call callback | 1. Call when agent busy, hang up. 2. Wait for callback window. | `CallbackTask` created; callback dialed at scheduled time. | ☐ |
| INBOUND-26 | CRM automation | 1. Caller gives name + intent (e.g., "want loan"). 2. Check CRM after call. | Deal/contact auto-created from call extraction. | ☐ |
| INBOUND-27 | WhatsApp linkage | 1. Complete call with a number that has WhatsApp. 2. Send follow-up. | Conversation linked across voice + WhatsApp channels. | ☐ |
| INBOUND-28 | Opt-out detection | 1. Caller says "please don't call me again". | Deterministic opt-out detected; DNC entry created; caller flagged. | ☐ |

---

## Prerequisites

- Published inbound agent, assigned to a staging DID (`/numbers`).
- Real phone or SIP client for all call tests.
- Supervisor account (AGENT role) + viewer account for section D.
- At least one human agent available (with skills) for C section tests.

## Notes

- For INBOUND-02, make a prior call first so the number is a "returning" caller.
- For INBOUND-03, manage block list via contacts DNC toggle or spam list.
- Verify CDRs with `psql` (select from `Call` where direction = 'INBOUND').
- Cross-browser: run INBOUND-19 on Chrome and Firefox (SSE behavior).
