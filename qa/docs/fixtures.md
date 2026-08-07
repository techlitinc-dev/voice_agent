# Mock / Fixture Data Definitions

All fixtures are deterministic, generated at setup, and never contain real
secrets. They live in `qa/fixtures/` (created by `qa/scripts/setup-env.sh`).

## Users

| Fixture | email | password | role | used by |
|---------|-------|----------|------|---------|
| INTEG_TESTER | integ.test@vaani.local | TestPass123! | OWNER | P2-T01 |
| SEC_USER_A | sec.a@vaani.local | TestPass123! | OWNER | P5-T01 |
| SEC_USER_B | sec.b@vaani.local | TestPass123! | OWNER | P5-T01 |
| PERF_LOAD | perf.load@vaani.local | TestPass123! | OWNER | P4-T02 |
| CONT_PROBE | cont.probe@vaani.local | TestPass123! | OWNER | P7-T02 |
| E2E_DEMO | demo@vaani.local | DemoPass123! | OWNER | P3-* (from e2e/helpers.ts) |

Password policy under test: ≥8 chars, mixed case + digit + symbol — `TestPass123!`
satisfies it.

## Workspaces / Orgs

Each user gets an auto-created org via dograh signup (`org_{provider_id}`).
Cross-tenant isolation asserts A's org data never appears in B's responses.

## Payloads

```json
// signup
{ "email": "<fixture>", "password": "TestPass123!", "name": "<name>" }
// login
{ "email": "<fixture>", "password": "TestPass123!" }
// workflow create
{ "name": "Integ Test Agent", "config": {} }
```

## Injection / Fuzz corpus

```text
SQLi:       ' OR 1=1 --
XSS:        <script>alert(1)</script>
Path:       ../../etc/passwd
Fuzz set:   base64(urandom[1..60]) × 50  -> must never 500
```

## Webhook fixtures

- `DOGRAH_WEBHOOK_SECRET=test-secret` — HMAC-SHA256 signing key for dograh→vaani events.
- `STRIPE_WEBHOOK_SECRET=whsec_test` — Stripe event signature key (test mode).
- `RAZORPAY_WEBHOOK_SECRET=rzp_test` — Razorpay webhook signature key.

## PII corpus (must be masked by `src/lib/pii.ts`)

```text
VISA:     4111 1111 1111 1111
Mastercard: 5500 0000 0000 0004
Aadhaar:  2345 6789 0123
PAN:      ABCDE1234F
Email:    test@example.com
Phone:    +91 98765 43210
```

## Dograh MCP fixtures

- `X-API-Key: sk-test-mcp-key` (masked key rejection covered by `test_masked_key_rejection.py`).
- Tool schemas: JSON Schema objects matching `api/schemas/tool.py`.

## Seed data

`vaani-ai/prisma/seed.ts` creates the demo workspace + E2E_DEMO user. Idempotent
by `upsert`. Reseed after P3 to clear journey artifacts:
`cd vaani-ai && npx prisma db seed`.

## Time fixtures

- TOTP: `otplib` with fixed secret `JBSWY3DPEHPK3PXP` and time-stepping mocked (see `tests/totp.test.ts`).
- Campaign windows: `TRAI_HOURS_ENFORCE=true`, fixed contact TZ `Asia/Kolkata`.
