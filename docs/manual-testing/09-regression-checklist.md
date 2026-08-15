# 09 — Regression Checklist

> Cross-cutting regression suite run before every release (RC → prod). Verifies
> tenant isolation, RBAC, performance, and end-to-end workflows across modules.
> Run after all module plans ([01](01-auth-and-onboarding.md)–[08](08-settings-and-admin.md)).

---

## A. Tenant Isolation & Security

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| REG-01 | Cross-tenant data leak (agents) | 1. As `tenant2@other.vaani.ai`, open `/agents`. | Only tenant-2 agents; tenant-1 agents invisible (no API leak). | ☐ |
| REG-02 | Cross-tenant data leak (calls) | 1. As tenant 2, open `/calls` + `/api/v1/calls`. | No tenant-1 CDRs returned in UI or API. | ☐ |
| REG-03 | Cross-tenant deal access | 1. As tenant 2, guess tenant-1 deal URL `/crm/deals/<id>`. | 404/403 — not found, no data rendered. | ☐ |
| REG-04 | Role escalation | 1. As `agent@test.vaani.ai`, visit `/settings/api-keys`, `/billing`, `/reseller`. | Access denied (403/redirect) — roles enforced server-side. | ☐ |
| REG-05 | Permission override respected | 1. Revoke `calls:read` from manager, refresh `/calls`. | Calls list blocked for that member. | ☐ |
| REG-06 | Direct API with session cookie | 1. Call `/api/internal/dashboard` without session cookie. | 401 — middleware gate. | ☐ |
| REG-07 | Webhook unauthenticated | 1. POST to `/api/webhooks/dograh` with wrong secret. | 401 — signature/secret rejected. | ☐ |

## B. Authentication & Session

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| REG-08 | Login → dashboard → logout | 1. Full auth round trip on staging. | Redirects correct; session revoked on logout. | ☐ |
| REG-09 | Session expiry redirect | 1. Expire session in DB, refresh `/dashboard`. | Redirect to `/login` with `next` param preserved. | ☐ |
| REG-10 | Active workspace switch | 1. User with 2 workspaces → switch workspace. | Data scope switches; no cross-workspace bleed. | ☐ |
| REG-11 | 2FA still enforced after change | 1. Login with 2FA user after password change. | TOTP step still required. | ☐ |

## C. End-to-End Workflows

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| REG-12 | Full inbound call journey | 1. Call DID → agent answers → ask question → hang up. 2. Check `/calls`. | CDR, transcript, recording, QA score all present. | ☐ |
| REG-13 | Full outbound journey | 1. Launch small campaign (10 contacts) → let it complete. | Dispositions recorded; wallet debited correctly; CSV export matches. | ☐ |
| REG-14 | Call → deal → pipeline → analytics | 1. Make call with purchase intent → check deal → move to won → check funnel. | Deal created from call; funnel counts it after win. | ☐ |
| REG-15 | Invoice → payment reconciliation | 1. Top up ₹500 → check wallet, invoice, transactions. | Wallet + invoice + payment order all reconcile to ₹500. | ☐ |
| REG-16 | Agent edit → republish → call | 1. Edit live agent prompt, republish, make call. | New prompt active on next call (not cached old version). | ☐ |
| REG-17 | Webhook → CRM automation | 1. Connect webhook, complete a call with intent. | Webhook fired AND CRM updated (both paths). | ☐ |

## D. Performance & Reliability

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| REG-18 | Page load budget | 1. Lighthouse on `/dashboard`, `/agents`, `/calls`. | LCP < 2.5s on staging; no console errors. | ☐ |
| REG-19 | Large list rendering | 1. Open `/calls` with 500 seeded calls, filter + paginate. | No jank; pagination/filter under 500ms. | ☐ |
| REG-20 | Queue backlog | 1. Check BullMQ wait queues during campaign. | `redis-cli LLEN bull:campaign-dialer:wait` stays bounded (pacing holds). | ☐ |
| REG-21 | Concurrent live streams | 1. Open `/live` + `/live/[callId]` on 3 browsers for one call. | All streams update; no duplicate events/errors. | ☐ |
| REG-22 | API latency | 1. Time `/api/internal/dashboard`, `/api/v1/calls`. | p95 < 500ms on staging (with cache where applicable). | ☐ |
| REG-23 | Error boundary | 1. Force a 500 (e.g., stop Dograh, load `/live`). | Graceful error page; no white screen; no crash loop. | ☐ |

## E. Multi-Channel & Integrations

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| REG-24 | WhatsApp inbound → inbox | 1. Send a WhatsApp message to the staging number. | Conversation appears in `/inbox`; AI reply (if enabled). | ☐ |
| REG-25 | SMS inbound | 1. Send SMS to staging number. | Message in inbox; linked to contact. | ☐ |
| REG-26 | Web widget | 1. Open `/widget/[slug]` (public) → send message. | SSE reply streams without login. | ☐ |
| REG-27 | Sheets export | 1. Push a call export to Google Sheets (connected). | Rows appear in linked sheet. | ☐ |

## F. Data & Backup

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| REG-28 | Backup exists | 1. Check staging backup job log. | Recent backup verified restorable (per [DR plan](../production-readiness/04-disaster-recovery.md)). | ☐ |
| REG-29 | MinIO objects intact | 1. Verify a known recording + invoice PDF in MinIO. | Objects present, presigned URLs work. | ☐ |
| REG-30 | Retention enforced | 1. Check that deleted (retention-expired) objects are gone. | No orphaned `recordingKey`/`pdfKey` references. | ☐ |
| REG-31 | Health endpoint | 1. GET `/api/health`. | 200 with db/redis/minio/dograh all OK. | ☐ |

---

## Prerequisites

- Fresh staging DB reset + seeded (`prisma db seed -- --environment staging`).
- All role + tenant-2 accounts available.
- Dograh, Redis, MinIO reachable and healthy.
- Real phone for REG-12/13.

## Notes

- Run A–C first (functional), then D (performance), then E–F (integrations/data).
- Any FAIL here blocks release unless it's an accepted known issue with a SEV2 or lower.
- Record results in the release spreadsheet with Test ID column (see [00-test-strategy.md](00-test-strategy.md) §3.2).
