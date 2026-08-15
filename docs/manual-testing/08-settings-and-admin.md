# 08 — Settings & Admin Tests

> Test cases for workspace settings, members & roles, API keys, webhooks, audit
> log, security (2FA/sessions), retention, GDPR, and admin functionality. Uses
> role accounts from [00-test-strategy.md](00-test-strategy.md).

---

## A. Members & Roles

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| SET-01 | Invite member | 1. `/settings/members` → Invite `agent@test.vaani.ai` with AGENT role. | Invite sent; `WorkspaceInvite` created with token. | ☐ |
| SET-02 | Accept invite | 1. Open invite link `/invite/[token]` in fresh browser. | Membership created; user lands in workspace. | ☐ |
| SET-03 | Invite expiry | 1. Set invite expiry to past (or use expired token). | Invite link shows expired; new invite required. | ☐ |
| SET-04 | Change member role | 1. Members list → change agent → MANAGER. | Permission set updates; agent can now manage campaigns. | ☐ |
| SET-05 | Per-member permission override | 1. Grant `campaigns:write` to a viewer; revoke from a manager. | Overrides applied; effective permissions follow matrix. | ☐ |
| SET-06 | Remove member | 1. Remove a member from workspace. | Membership deleted; user loses access to all workspace data. | ☐ |
| SET-07 | Role-based access | 1. Log in as each role and visit `/settings/members`. | Only OWNER/ADMIN can view; others see 403/redirect. | ☐ |
| SET-08 | Reseller child workspace | 1. As reseller, open `/reseller` → create child workspace. | Child workspace created; wholesale rate card applied. | ☐ |

## B. API Keys & Public API

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| SET-09 | Create API key | 1. `/settings/api-keys` → Create key with `calls:read` scope. | Key shown once; `ApiKey` stored as hash (`keyHash`). | ☐ |
| SET-10 | Call API v1 with key | 1. `curl -H "Authorization: Bearer <key>" /api/v1/calls`. | 200 with workspace-scoped CDRs. | ☐ |
| SET-11 | Scope enforcement | 1. Use `calls:read` key against `POST /api/v1/agents`. | 403 — scope not granted. | ☐ |
| SET-12 | IP allowlist | 1. Set allowlist to a different IP, call API. | 403 — request blocked outside allowlist (CIDR match). | ☐ |
| SET-13 | Revoke API key | 1. Revoke key, call API again. | 401 — key rejected. | ☐ |
| SET-14 | Trigger call via API | 1. `POST /api/v1/calls` with `campaigns:launch` key + number. | Outbound call triggered via Dograh; CDR created. | ☐ |

## C. Webhooks

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| SET-15 | Create webhook subscription | 1. `/settings/webhooks` → add endpoint URL + event `call.completed`. | `WebhookSubscription` created with HMAC secret. | ☐ |
| SET-16 | Receive webhook | 1. Trigger a completed call (or replay). 2. Check receiver endpoint. | Delivery logged; payload signed with HMAC; signature verifies. | ☐ |
| SET-17 | Delivery retry/backoff | 1. Point webhook at a down endpoint, trigger event. | `WebhookDelivery` retries with backoff; attempt log shows timeline. | ☐ |
| SET-18 | Delivery log | 1. Open `/deliveries/[id]`. | Request/response bodies, status codes, timestamps shown. | ☐ |
| SET-19 | Disable webhook | 1. Disable subscription, trigger event. | No delivery attempts; subscription marked disabled. | ☐ |

## D. Security & Sessions

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| SET-20 | Enable 2FA from settings | 1. `/settings/security` → Enable 2FA → scan QR → enter code. | `TotpSecret` status = ENABLED; backup codes shown. | ☐ |
| SET-21 | Session list | 1. Log in on 2 devices. 2. `/settings/sessions`. | Both sessions listed with device info. | ☐ |
| SET-22 | Revoke session | 1. Revoke one session. 2. Try to use it. | Session invalid; user forced to re-login. | ☐ |
| SET-23 | Revoke all sessions | 1. Click "Log out all devices". | All sessions revoked; current one re-authenticated. | ☐ |
| SET-24 | Password change | 1. Settings → change password. 2. Log out, log in with new. | New password works; old fails. | ☐ |
| SET-25 | Audit log capture | 1. Perform actions (invite member, create API key, delete deal). 2. Open `/settings/audit-log`. | Each action logged with actor, action, target, timestamp. | ☐ |

## E. Branding, KYC & Integrations

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| SET-26 | White-label branding | 1. `/settings/branding` → upload logo, set brand color. 2. Check login + dashboard. | Logo/color applied (branding files served via `/api/branding/logo`). | ☐ |
| SET-27 | Custom domain | 1. `/settings/branding` → add custom domain, run DNS verify. | Verification passes (Caddy on-demand TLS); domain serves app. | ☐ |
| SET-28 | KYC submission | 1. `/settings/kyc` → upload GST/PAN. | `KycRecord` created PENDING → VERIFIED (or rejected). | ☐ |
| SET-29 | KYC gating effect | 1. Verify KYC → try to rent 140-number. | Gating opens (`TrialState` KYC-gated). | ☐ |
| SET-30 | CRM integration connect | 1. `/settings/integrations` → connect HubSpot (test). | OAuth flow completes; `CrmConnection` created. | ☐ |
| SET-31 | Calendar integration | 1. Connect Google Calendar. 2. Book a slot via agent. | `CalendarConnection` created; booking appears in calendar. | ☐ |

## F. Data Rights & Retention

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| SET-32 | Retention policy config | 1. `/settings/retention` → set recordings 90d, transcripts 1y. | `RetentionPolicy` saved. | ☐ |
| SET-33 | Retention job runs | 1. Trigger retention job (or run script). | Old recordings/transcripts deleted per policy (MinIO + DB). | ☐ |
| SET-34 | GDPR export request | 1. `/settings/data-rights` → request export. | `GdprRequest` (EXPORT) created; export ZIP generated. | ☐ |
| SET-35 | GDPR erasure request | 1. Request erasure. | Data purged per policy; confirmation sent; record kept. | ☐ |
| SET-36 | Scheduled digests | 1. `/settings/digests` → create weekly digest. | `ScheduledDigest` saved; digest email arrives on schedule. | ☐ |

---

## Prerequisites

- All role accounts (owner, admin, manager, agent, viewer) from the strategy doc.
- A public receiver endpoint (e.g., `webhook.site`) for webhook tests.
- Test OAuth credentials for HubSpot/Google in section E.

## Notes

- For SET-10/11/12/13, use Postman or `curl` — record status codes.
- For SET-25, verify `AuditLog` rows in `psql` after each action.
- Cross-browser: run SET-01, SET-25 on Chrome, Firefox, Safari.
