# 02 — Agent Builder Tests

> Test cases for agent CRUD, the builder tabs (general/voice/llm/knowledge/tools),
> versioning, A/B testing, and publishing. Assumes staging environment with seeded
> accounts from [00-test-strategy.md](00-test-strategy.md).

---

## A. Agent CRUD

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| AGENT-01 | Create agent from blank | 1. Go to `/agents`. 2. Click "New agent". 3. Fill name "Test Agent", system prompt, select language/voice. 4. Save. | Agent created, appears in `/agents` list with status DRAFT. | ☐ |
| AGENT-02 | Create agent from template | 1. Go to `/agents/new`. 2. Pick "Clinic Receptionist" template. 3. Review populated fields. 4. Save. | Template fields (prompt, voice, tools) pre-filled, editable. | ☐ |
| AGENT-03 | Edit agent general settings | 1. Open agent → General tab. 2. Change name + description. 3. Save. | Name/description updated in list and detail. | ☐ |
| AGENT-04 | Edit system prompt | 1. Open agent → LLM tab. 2. Update system prompt. 3. Save. | Prompt saved, version snapshot created. | ☐ |
| AGENT-05 | Delete agent | 1. Open agent → Danger zone. 2. Click Delete, confirm. | Agent removed from list; no active calls on it (delete blocked if live). | ☐ |
| AGENT-06 | Search/filter agents | 1. On `/agents`, type in search box, filter by status. | List filters correctly, empty state shown when no match. | ☐ |
| AGENT-07 | Agent list pagination | 1. With 25+ agents, navigate to page 2. | Page 2 loads, counts consistent. | ☐ |

## B. Voice, LLM & Language

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| AGENT-08 | Select language mode | 1. Open agent → Voice tab. 2. Set language mode to "Hindi". 3. Save. | Language saved; workflow config reflects it. | ☐ |
| AGENT-09 | Voice preview | 1. Voice tab → click "Preview voice". | Sample audio plays (presigned URL from `/api/voices/[id]/sample`). | ☐ |
| AGENT-10 | Custom voice (plan-gated) | 1. With Starter plan, open Voice tab → "Clone voice". | Upsell/blocked message shown. 2. Upgrade to Pro, retry. | Cloning UI available on Pro; ₹5,000/mo add-on gate enforced. | ☐ |
| AGENT-11 | LLM model switch | 1. LLM tab → change model from default to a cheaper model. 2. Save. | Model saved; "Test conversation" uses new model. | ☐ |
| AGENT-12 | LLM failover | 1. Set primary model to a key with zero balance. 2. Make a test call. | Call still completes using fallback model (`src/lib/dograh.ts` failover chain). | ☐ |
| AGENT-13 | Temperature/generation config | 1. LLM tab → change temperature, max tokens. 2. Save. | Values persisted and applied to conversation. | ☐ |

## C. Knowledge Base

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| AGENT-14 | Attach knowledge doc | 1. Go to `/knowledge`. 2. Upload PDF. 3. Attach to agent from Knowledge tab. | Document status PENDING → INDEXING → INDEXED. | ☐ |
| AGENT-15 | Knowledge retrieval in call | 1. Ask agent a question whose answer is only in uploaded PDF. | Agent answers from knowledge (guardrail not triggered). | ☐ |
| AGENT-16 | Knowledge guardrail | 1. Ask question outside knowledge scope. | Agent says it doesn't know / stays on script (KB guardrail node). | ☐ |
| AGENT-17 | Re-index document | 1. Update PDF, click "Re-index". | Status goes back through INDEXING → INDEXED; new content retrievable. | ☐ |
| AGENT-18 | Delete knowledge doc | 1. Delete doc from agent's Knowledge tab. | Doc removed; agent no longer answers from it. | ☐ |
| AGENT-19 | Shared vs per-agent KB | 1. Create shared doc, assign to 2 agents. 2. Edit doc. | Both agents retrieve updated content. | ☐ |

## D. Tools

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| AGENT-20 | Enable booking tool | 1. Tools tab → enable Calendar Booking. 2. Connect Google Calendar. 3. In test call, ask "book an appointment for tomorrow 4pm". | Slot booked in calendar; confirmation read back to caller. | ☐ |
| AGENT-21 | Human transfer tool | 1. Enable Human Transfer with skill "sales". 2. In call, ask to speak to a human. | Transfer request created (`TransferRequest`), routed to available agent. | ☐ |
| AGENT-22 | SMS/WhatsApp tool | 1. Enable SMS + WhatsApp tools. 2. In call, say "send me the details on WhatsApp". | Outbound message sent to caller's number; linked to conversation. | ☐ |
| AGENT-23 | Payment link tool | 1. Enable Payment Link. 2. In call, say "I want to pay". | Payment link generated and sent; link opens in browser. | ☐ |
| AGENT-24 | CRM write tool | 1. Enable CRM Write. 2. In call, give name + intent. | Deal/contact created or updated in CRM; `createdFromCallId` set. | ☐ |
| AGENT-25 | Tool off-state | 1. Disable all tools. 2. Make call. | No tool calls; agent answers conversationally only. | ☐ |

## E. Versioning, A/B & Publish

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| AGENT-26 | Publish agent | 1. Open agent → Publish. 2. Confirm. | Status = LIVE; version snapshot created in `AgentVersion`. | ☐ |
| AGENT-27 | Unpublish agent | 1. Open live agent → Unpublish. | Status = DRAFT; number assignment cleared or warned. | ☐ |
| AGENT-28 | Version history | 1. Versions tab → view history after 2 edits + publish. | Snapshots listed with timestamps and diffs; older version restorable. | ☐ |
| AGENT-29 | Rollback to version | 1. Versions tab → rollback to v1. 2. Publish. | Agent config matches v1; new version entry created. | ☐ |
| AGENT-30 | A/B variant creation | 1. Versions tab → create variant B, change opening line. 2. Set 50/50 split. | Two variants with `abTrafficPercent` saved. | ☐ |
| AGENT-31 | A/B call routing | 1. Make 10 test calls to the A/B agent. | ~50/50 split observed in calls; variant recorded per call. | ☐ |
| AGENT-32 | A/B split validation | 1. Set traffic split to 101%. | Validation error: must be 0–100. | ☐ |
| AGENT-33 | Agent version pinning | 1. Publish v2, keep v1 live for 10% of calls. | Calls routed to pinned versions per traffic percent. | ☐ |

## F. Marketplace

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| AGENT-34 | Install marketplace template | 1. Go to `/marketplace`. 2. Install "Loan Collection" template. | Template cloned into `/agents` as draft agent. | ☐ |
| AGENT-35 | Publish own template | 1. On a completed agent, click "Publish to marketplace". 2. Confirm. | Template listed in marketplace as public/unlisted per choice. | ☐ |
| AGENT-36 | Unpublish from marketplace | 1. On published template, click unpublish. | Template no longer visible in marketplace. | ☐ |

---

## Prerequisites

- Staging environment accessible, logged in as `owner@test.vaani.ai`.
- Dograh voice engine reachable (health check OK).
- Google Calendar account connected for AGENT-20.
- A real phone or SIP client for test calls (AGENT-15, 21–24, 31).
- Plan with voice cloning enabled (or upgrade) for AGENT-10.

## Notes

- For AGENT-12 (LLM failover), check the Dograh log/queue or call outcome — the
  call should complete with a non-error status even if the primary model fails.
- For AGENT-31, use `psql` to verify `variantId`/variant distribution on `Call` rows.
- Cross-browser: run AGENT-01, AGENT-09 on Chrome, Firefox, Safari.
