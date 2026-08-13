# 00 — Manual Test Strategy

> **Goal:** A structured manual testing approach that verifies Vaani AI works
> end-to-end before every release. Each module has its own test plan with
> step-by-step instructions and pass/fail criteria.

---

## 1. Testing Pyramid

```
         ┌─────────┐
         │  E2E    │  ← Playwright (automated, ~20 critical paths)
         ├─────────┤
         │ Manual  │  ← THIS DOCUMENT (50+ test cases per release)
         ├─────────┤
         │   API   │  ← Vitest route tests (automated)
         ├─────────┤
         │  Unit   │  ← Vitest lib tests (automated)
         └─────────┘
```

Manual testing covers what automation can't: real voice calls, payment flows,
multi-tenant isolation, visual UI correctness, and edge cases.

---

## 2. Test Environment

### 2.1 Staging environment

All manual testing happens on **staging** (never production):

| Item | Value |
|---|---|
| URL | `https://staging.vaani.ai` |
| DB | Separate staging database (reset before each cycle) |
| Razorpay | **Test mode** keys |
| Vobiz | Test DID (or sandbox) |
| OpenRouter | Test API key with low spend limit |
| MinIO | Staging bucket |

### 2.2 Test accounts

Pre-seed these accounts:

| Account | Role | Purpose |
|---|---|---|
| `owner@test.vaani.ai` | OWNER | Full access tests |
| `admin@test.vaani.ai` | ADMIN | Admin-level tests |
| `manager@test.vaani.ai` | MANAGER | Manager tests |
| `agent@test.vaani.ai` | AGENT | Limited access tests |
| `viewer@test.vaani.ai` | VIEWER | Read-only tests |
| `tenant2@other.vaani.ai` | OWNER | Cross-tenant isolation tests |

All accounts use password `Test@1234!` (staging only).

### 2.3 Test data

Run `prisma db seed -- --environment staging` to load:
- 3 agents (clinic, loan, support templates)
- 100 contacts across 2 lists
- 500 calls (mixed statuses, directions)
- 2 campaigns (one completed, one draft)
- 10 deals in various stages

---

## 3. Test Cycle Process

### 3.1 When to test

| Trigger | Scope | Duration |
|---|---|---|
| **Pre-release** (RC → prod) | Full regression | 4–6 hours |
| **Post-deploy** (prod) | Smoke tests only | 30 min |
| **Hotfix** | Affected module + regression | 2 hours |
| **Weekly** | Critical path only | 1 hour |

### 3.2 How to record results

Use a spreadsheet (or GitHub Issues checklist) with columns:

| Test ID | Module | Test Case | Steps | Expected | Status | Notes |
|---|---|---|---|---|---|---|
| AUTH-01 | Auth | Login with valid credentials | 1. Go to /login... | Redirect to /dashboard | PASS | |
| AUTH-02 | Auth | Login with wrong password | 1. ... | Error "Invalid..." | FAIL | No error shown |

**Status values**: `PASS`, `FAIL`, `BLOCKED`, `SKIP`

### 3.3 Bug reporting

For each FAIL, file a bug:

```
Title: [AUTH-02] No error message shown on wrong password
Severity: SEV2
Steps: 1. Go to /login, 2. Enter wrong password, 3. Click Login
Expected: "Invalid email or password" error
Actual: Page reloads, no message
Screenshot: <attach>
Environment: staging.vaani.ai, Chrome 127
```

---

## 4. Test Plan Index

| File | Module | Test Cases |
|---|---|---|
| [01-auth-and-onboarding.md](01-auth-and-onboarding.md) | Auth, registration, onboarding wizard | ~25 |
| [02-agent-builder.md](02-agent-builder.md) | Agent CRUD, tools, knowledge, publish | ~20 |
| [03-inbound-receptionist.md](03-inbound-receptionist.md) | Inbound calls, voicemail, transfers | ~15 |
| [04-outbound-campaigns.md](04-outbound-campaigns.md) | Campaign create, start, pacing, DNC | ~20 |
| [05-crm-module.md](05-crm-module.md) | Pipeline, deals, tasks, segments | ~25 |
| [06-analytics-module.md](06-analytics-module.md) | Dashboard, funnel, reports | ~15 |
| [07-billing-and-wallet.md](07-billing-and-wallet.md) | Wallet, Razorpay, invoices | ~15 |
| [08-settings-and-admin.md](08-settings-and-admin.md) | Members, API keys, webhooks, audit | ~20 |
| [09-regression-checklist.md](09-regression-checklist.md) | Cross-cutting regression | ~30 |

**Total: ~185 test cases**

---

## 5. Testing Tools

| Tool | Purpose |
|---|---|
| Browser | Chrome + Firefox + Safari (cross-browser) |
| DevTools | Network tab (API responses), Console (errors) |
| Phone | A real phone (or SIP client) for voice call tests |
| Postman | API testing for `/api/v1/*` endpoints |
| Redis CLI | Inspect queue state (`redis-cli LRANGE bull:call-events:wait 0 10`) |
| `psql` | Verify DB state after actions |
| Lighthouse | Performance + accessibility audit |

---

## 6. Definition of Done (Release Gate)

A release is **ready for production** when:

- [ ] All P0/SEV1 test cases PASS
- [ ] ≥ 95% of all test cases PASS
- [ ] No known SEV1 or SEV2 bugs open
- [ ] Smoke tests pass on staging
- [ ] Load test completed (no regressions)
- [ ] Backup verified
- [ ] Rollback plan documented

---

## Next

→ [01 — Auth & Onboarding Tests](01-auth-and-onboarding.md)