# 09 — Billing: Plans, Wallet, Metering, Razorpay + Stripe, GST Invoices, Rental, Add-ons, Trial, Reseller

> **KICKOFF PROMPT — copy everything between the lines and paste into Hermes:**
>
> ---
> You are the EXECUTOR for the Vaani AI project. Read
> `/root/vaani-ai/plan/00_MASTER_PLAN.md` and execute
> `/root/vaani-ai/plan/09_billing_wallet_razorpay.md` exactly. Create files with the
> EXACT contents shown. Run every Verify, compare with Expected, max 2 fix attempts,
> then STOP and report. Money rules: integer paise only, wallet ledger is append-only,
> every balance change writes a WalletTransaction row in the SAME DB transaction. Never
> use real Razorpay/Stripe keys — TEST mode only. End with the FINAL REPORT.
> ---

---

## Goal

The full monetization layer (readme §10):

1. **Subscription tiers + feature gating** — Starter/Growth/Enterprise plans (seeded
   in guide 02), `checkFeatureGate()` enforcing maxAgents/maxSeats/concurrentLines/
   whiteLabel/premiumVoices + plan page with upgrade/downgrade.
2. **Usage metering with markup** — per-second metering across telephony+STT+LLM+TTS
   from a typed rate card (`lib/ratecard.ts`), per-plan markup override, writes
   `Call.billedPaise`, debits the wallet with a ledger row.
3. **Wallet** — top-ups via **Razorpay AND Stripe** (test mode), low-balance alerts
   (email + `wallet.low_balance` webhook event + dashboard banner), auto top-up
   settings + sweep (Razorpay tokenization is OPERATOR GATED).
4. **Number rental** — monthly debit per rented DID with margin, via worker cron.
5. **Add-ons** — extra concurrent lines, premium voices, white-label, dedicated
   infra; purchase flips feature gates; recurring monthly debit.
6. **INR + GST invoicing** — monthly invoice from wallet debits, CGST/SGST/IGST via
   `splitGst`, sequential invoice numbers (`VAANI/2526/0001`), print-friendly invoice
   page, HTML stored in MinIO (`Invoice.pdfKey`).
7. **Free trial** — `TrialState` provisioning, trial minutes consumed before wallet
   debit, KYC gate on regulated number series.
8. **Reseller/agency panel** — child workspaces, wholesale rate card JSON, per-child
   usage rollup + margin report, gated by `reseller:manage`.

**Time estimate:** 6 hours. **Prerequisites:** guides 01–08 green. Operator has
Razorpay TEST keys in `.env` (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
`RAZORPAY_WEBHOOK_SECRET`). Stripe TEST keys (`STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`) optional — Stripe steps degrade gracefully without them.
Money is integer paise everywhere; the wallet ledger is append-only.

**Design decisions (already made — do not re-litigate):**
- Plan change proration: **immediate switch, no proration math**. Upgrade charges the
  new plan's full monthly fee from the wallet now (`PLAN_FEE`); downgrade switches
  immediately and the new (lower) price applies from the next monthly cron charge.
  No refunds.
- Wallet prices are **GST-inclusive retail**. Invoices split the GST component out of
  the debited totals (base = total × 100/118 at 18%).
- Wallet may go **negative** (postpaid-style) — calls are never blocked mid-month;
  low-balance alerts + auto top-up exist to prevent that.
- Trial calls consume **whole minutes** (`ceil(durationSec/60)`); a call that does not
  fit entirely in the remaining trial minutes is billed to the wallet in full (no
  split billing).
- Invoice PDF: HTML invoice page (browser print → PDF) + HTML stored in MinIO.
  wkhtmltopdf/puppeteer is OPERATOR-OPTIONAL later — no heavy dependency in this guide.

---

## Step 0: Sanity checks + installs

```bash
cd /root/vaani-ai

# 1. Plans were seeded in guide 02 — verify all three exist with gates.
docker exec vaani-db psql -U vaani -d vaani -c \
  "SELECT code, \"monthlyPricePaise\", \"maxAgents\", \"maxSeats\", \"concurrentLines\", \"whiteLabel\", \"premiumVoices\", \"dedicatedInfra\", \"markupPercent\" FROM \"Plan\" ORDER BY \"monthlyPricePaise\";"

# 2. Stripe (canonical pin from 00_MASTER_PLAN §3). Razorpay/node-cron/nodemailer
#    are already installed by earlier guides — the installs below are idempotent.
npm install stripe@17.3.1
npm install razorpay@2.9.4 node-cron@3.0.3 nodemailer@6.9.16
npm ls stripe razorpay node-cron nodemailer 2>&1 | tail -n 5

# 3. New env vars (STRIPE_* already exist from guide 01's .env template — the grep
#    will show them). Grep-guarded appends to BOTH .env and .env.example — guide 01
#    requires .env.example to document every variable.
grep -c "STRIPE_SECRET_KEY\|STRIPE_WEBHOOK_SECRET" .env
for f in .env .env.example; do
  grep -q '^AUTOTOPUP_ENABLED=' "$f" || echo 'AUTOTOPUP_ENABLED=false               # true = attempt real Razorpay off-session token charges (OPERATOR GATE, Step 7)' >> "$f"
  grep -q '^BILLING_COMPANY_NAME=' "$f" || echo 'BILLING_COMPANY_NAME=Vaani AI Pvt Ltd # seller name printed on GST invoices' >> "$f"
  grep -q '^BILLING_COMPANY_GSTIN=' "$f" || echo 'BILLING_COMPANY_GSTIN=CHANGE_ME       # seller GSTIN printed on invoices (set before going live)' >> "$f"
  grep -q '^BILLING_COMPANY_STATE_CODE=' "$f" || echo 'BILLING_COMPANY_STATE_CODE=29    # seller GST state code (29 = Karnataka) — drives IGST vs CGST+SGST' >> "$f"
done
grep -c "AUTOTOPUP_ENABLED\|BILLING_COMPANY_" .env .env.example

# 4. Remove stale test files from any earlier attempt at this guide (they reference
#    symbols that this rewrite removes). Safe even if absent.
rm -f src/lib/money.test.ts src/lib/billing.test.ts
```

**Expected:**
1. Three rows: `starter 299900 2 2 2 f f f 40`, `growth 799900 10 10 10 f t f 45`,
   `enterprise 2499900 100 50 100 t t t 50`.
2. `stripe@17.3.1`, `razorpay@2.9.4`, `node-cron@3.0.3`, `nodemailer@6.9.16` (no
   `UNMET`).
3. First grep: `2`. Second grep: `.env:4` and `.env.example:4` (both files document
   all four new variables).
**If it fails:** plans missing → re-run `npm run prisma:seed` (idempotent upserts).
Wrong stripe version → `npm install stripe@17.3.1` again; never a newer version.

---

## Step 1: Additive DB migration — add-on purchases, plan-fee/add-on ledger types, workspace GST profile

One small additive migration (no existing model is redefined):

**Edit `prisma/schema.prisma`:**

1. In `enum TxnType`, directly after the line `  TRIAL_CREDIT` add:
```prisma
  ADDON_DEBIT
  PLAN_FEE
```

2. In `model Workspace`, directly after the line `  trialState          TrialState?` add:
```prisma
  addOnPurchases      AddOnPurchase[]
  // GST billing profile (B2B invoices, spec 10) — set from /billing/settings
  billingGstin         String?
  billingPlaceOfSupply String? // e.g. "Karnataka (29)"
  billingHsnSac        String? // e.g. "998314"
```

3. At the END of the file, append:
```prisma
// ---------- Billing add-ons (guide 09) ----------

model AddOnPurchase {
  id                String   @id @default(cuid())
  workspaceId       String
  code              String   // extra_line | premium_voices | white_label | dedicated_infra
  monthlyPricePaise Int
  active            Boolean  @default(true)
  createdAt         DateTime @default(now())
  cancelledAt       DateTime?

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, code])
  @@index([workspaceId])
}
```

**Do:**
```bash
cd /root/vaani-ai
npx prisma migrate dev --name billing_extras
npx prisma generate
npm run typecheck
```
**Expected:** migration `..._billing_extras` applied; `Generated Prisma Client`;
typecheck exit 0.
**If it fails:** `TrialsState`/`AddOnPurchase` name error → re-check the appended
block character-for-character. Drift error → STOP and report (do NOT run
`migrate reset` — it wipes data).

---

## Step 2: Rate card — wholesale provider rates + markup math

**File `src/lib/ratecard.ts`** (full content):

```ts
import { z } from "zod";
import { billForSeconds, withMarkup } from "./money";

/**
 * Wholesale per-MINUTE rates in paise — WHAT WE PAY Vobiz/Sarvam/OpenRouter.
 * Update these when provider pricing changes. Retail = wholesale × (1 + markup%),
 * markup comes from Plan.markupPercent (per-plan override of DEFAULT_MARKUP_PERCENT).
 * Reseller child workspaces can override the wholesale card via
 * ResellerAccount.wholesaleRateCard JSON.
 */
export interface RateCard {
  telephonyPerMinPaise: number;
  sttPerMinPaise: number;
  llmPerMinPaise: number;
  ttsPerMinPaise: number;
}

export const DEFAULT_RATE_CARD: RateCard = {
  telephonyPerMinPaise: 30, // ₹0.30/min blended Vobiz
  sttPerMinPaise: 18,       // ₹0.18/min Sarvam STT
  llmPerMinPaise: 12,       // ₹0.12/min OpenRouter blended
  ttsPerMinPaise: 24,       // ₹0.24/min Sarvam TTS
};

export const DEFAULT_MARKUP_PERCENT = 40;

const rateCardOverrideSchema = z
  .object({
    telephonyPerMinPaise: z.number().int().min(0),
    sttPerMinPaise: z.number().int().min(0),
    llmPerMinPaise: z.number().int().min(0),
    ttsPerMinPaise: z.number().int().min(0),
  })
  .partial();

/** Parse a reseller wholesale-rate-card JSON onto the defaults. Never throws. */
export function parseRateCardJson(json: unknown, base: RateCard = DEFAULT_RATE_CARD): RateCard {
  if (!json || typeof json !== "object") return base;
  const parsed = rateCardOverrideSchema.safeParse(json);
  if (!parsed.success) return base;
  return { ...base, ...parsed.data };
}

export interface CallCostParts {
  costTelephonyPaise: number;
  costSttPaise: number;
  costLlmPaise: number;
  costTtsPaise: number;
}

/** Per-second wholesale metering across all 4 components (spec §10). */
export function componentCosts(durationSec: number, rateCard: RateCard = DEFAULT_RATE_CARD): CallCostParts {
  const sec = Math.max(0, Math.floor(durationSec));
  return {
    costTelephonyPaise: billForSeconds(sec, rateCard.telephonyPerMinPaise),
    costSttPaise: billForSeconds(sec, rateCard.sttPerMinPaise),
    costLlmPaise: billForSeconds(sec, rateCard.llmPerMinPaise),
    costTtsPaise: billForSeconds(sec, rateCard.ttsPerMinPaise),
  };
}

/** Wholesale total (what we pay) for a call. */
export function wholesaleTotalPaise(parts: CallCostParts): number {
  return (
    parts.costTelephonyPaise + parts.costSttPaise + parts.costLlmPaise + parts.costTtsPaise
  );
}

/** Retail total (what the tenant pays): markup applied PER COMPONENT, then summed. */
export function retailTotalPaise(parts: CallCostParts, markupPercent: number): number {
  return (
    withMarkup(parts.costTelephonyPaise, markupPercent) +
    withMarkup(parts.costSttPaise, markupPercent) +
    withMarkup(parts.costLlmPaise, markupPercent) +
    withMarkup(parts.costTtsPaise, markupPercent)
  );
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 3: Billing library v2 — metering, trial enforcement, wallet ledger, low-balance alerts

Full rewrite of `src/lib/billing.ts` (replaces the guide-09-original version).

**File `src/lib/billing.ts`** (full content):

```ts
import nodemailer from "nodemailer";
import { db } from "./db";
import { emitWebhookEvent } from "./webhooks";
import {
  componentCosts,
  retailTotalPaise,
  parseRateCardJson,
  DEFAULT_RATE_CARD,
  DEFAULT_MARKUP_PERCENT,
} from "./ratecard";

export type DebitType = "CALL_DEBIT" | "NUMBER_RENT" | "ADDON_DEBIT" | "PLAN_FEE";

/**
 * Trial-vs-wallet decision (pure, unit-tested). Whole-minute accounting; a call
 * that does not fit entirely in the remaining trial minutes is wallet-billed.
 */
export function decideTrialBilling(args: {
  trialMinutesUsed: number;
  trialMinutesLimit: number;
  expiresAt: Date | null;
  now: Date;
  callMinutes: number;
}): { useTrial: boolean } {
  if (args.expiresAt !== null && args.expiresAt.getTime() <= args.now.getTime()) {
    return { useTrial: false };
  }
  return { useTrial: args.trialMinutesUsed + args.callMinutes <= args.trialMinutesLimit };
}

/**
 * Debit the wallet with an append-only ledger row, in ONE transaction.
 * Idempotent when `reference` is given (a second call with the same reference is a
 * no-op). After the debit, fires the low-balance alert exactly on threshold crossing
 * (previous balance >= threshold, new balance < threshold): email to workspace
 * OWNERs + `wallet.low_balance` webhook event.
 */
export async function debitWallet(input: {
  workspaceId: string;
  amountPaise: number;
  type: DebitType;
  reference?: string;
  note?: string;
}): Promise<{ newBalance: number; skipped: boolean; lowBalanceAlert: boolean }> {
  const result = await db.$transaction(async (tx) => {
    if (input.reference) {
      const dup = await tx.walletTransaction.findFirst({
        where: {
          wallet: { workspaceId: input.workspaceId },
          reference: input.reference,
        },
      });
      if (dup) {
        return { newBalance: dup.balanceAfterPaise, skipped: true, lowBalanceAlert: false };
      }
    }
    const wallet = await tx.wallet.findUnique({ where: { workspaceId: input.workspaceId } });
    if (!wallet) throw new Error(`no wallet for workspace ${input.workspaceId}`);
    const newBalance = wallet.balancePaise - input.amountPaise;
    await tx.wallet.update({ where: { id: wallet.id }, data: { balancePaise: newBalance } });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: input.type,
        amountPaise: -input.amountPaise,
        balanceAfterPaise: newBalance,
        reference: input.reference,
        note: input.note,
      },
    });
    const lowBalanceAlert =
      wallet.balancePaise >= wallet.lowBalanceAlertPaise &&
      newBalance < wallet.lowBalanceAlertPaise;
    return { newBalance, skipped: false, lowBalanceAlert };
  });
  if (result.lowBalanceAlert) {
    await notifyLowBalance(input.workspaceId, result.newBalance);
  }
  return result;
}

/** Low-balance alert: webhook event + email to OWNERs. Never throws. */
export async function notifyLowBalance(workspaceId: string, balancePaise: number): Promise<void> {
  await emitWebhookEvent(workspaceId, "wallet.low_balance", { balancePaise });
  try {
    const owners = await db.membership.findMany({
      where: { workspaceId, role: "OWNER" },
      include: { user: { select: { email: true, fullName: true } } },
    });
    const to = owners.map((m) => m.user.email);
    const host = process.env.SMTP_HOST;
    if (to.length === 0 || !host) {
      console.log(`[billing] low-balance email skipped (no SMTP_HOST): workspace ${workspaceId}`);
      return;
    }
    const transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      ...(process.env.SMTP_USER
        ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
        : {}),
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? "Vaani AI <no-reply@vaani.ai>",
      to: to.join(", "),
      subject: "Vaani AI: wallet balance is low",
      text:
        `Your Vaani AI wallet balance is ₹${(balancePaise / 100).toFixed(2)}, below your ` +
        `alert threshold. Top up at ${process.env.NEXT_PUBLIC_APP_URL ?? ""}/billing to avoid interruption.`,
    });
  } catch (e) {
    console.error("notifyLowBalance email failed", e);
  }
}

/**
 * Bill a completed call (spec §10 usage metering):
 * wholesale rate card (reseller override → default) → per-second components →
 * per-plan markup → TrialState minutes FIRST, wallet debit otherwise.
 * Idempotent: skips when billedPaise > 0 or a `billed` CallEvent already exists.
 * Returns the retail billed amount in paise (0 for trial calls), or null if skipped.
 */
export async function billCall(callId: string): Promise<number | null> {
  const call = await db.call.findUnique({ where: { id: callId } });
  if (!call || call.billedPaise > 0 || call.durationSec <= 0) return null;
  const already = await db.callEvent.findFirst({
    where: { callId: call.id, type: "billed" },
    select: { id: true },
  });
  if (already) return null;

  const [sub, ws] = await Promise.all([
    db.subscription.findUnique({
      where: { workspaceId: call.workspaceId },
      include: { plan: true },
    }),
    db.workspace.findUnique({
      where: { id: call.workspaceId },
      include: { reseller: true },
    }),
  ]);
  const markup = sub?.plan.markupPercent ?? DEFAULT_MARKUP_PERCENT;
  const rateCard = parseRateCardJson(ws?.reseller?.wholesaleRateCard, DEFAULT_RATE_CARD);
  const costs = componentCosts(call.durationSec, rateCard);
  const billed = retailTotalPaise(costs, markup);
  const callMinutes = Math.ceil(call.durationSec / 60);

  const outcome = await db.$transaction(async (tx) => {
    const trial = await tx.trialState.findUnique({
      where: { workspaceId: call.workspaceId },
    });
    const useTrial = trial
      ? decideTrialBilling({
          trialMinutesUsed: trial.trialMinutesUsed,
          trialMinutesLimit: trial.trialMinutesLimit,
          expiresAt: trial.expiresAt,
          now: new Date(),
          callMinutes,
        }).useTrial
      : false;

    if (useTrial && trial) {
      await tx.trialState.update({
        where: { id: trial.id },
        data: { trialMinutesUsed: trial.trialMinutesUsed + callMinutes },
      });
      await tx.call.update({
        where: { id: call.id },
        data: { ...costs, billedPaise: 0 },
      });
      await tx.callEvent.create({
        data: {
          callId: call.id,
          type: "billed",
          payload: { trial: true, minutes: callMinutes, billedPaise: 0 },
        },
      });
      return { trial: true as const };
    }

    const wallet = await tx.wallet.findUnique({ where: { workspaceId: call.workspaceId } });
    if (!wallet) throw new Error(`no wallet for workspace ${call.workspaceId}`);
    const newBalance = wallet.balancePaise - billed;
    await tx.wallet.update({ where: { id: wallet.id }, data: { balancePaise: newBalance } });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "CALL_DEBIT",
        amountPaise: -billed,
        balanceAfterPaise: newBalance,
        reference: call.id,
        note: `Call ${call.fromNumber} → ${call.toNumber} (${call.durationSec}s)`,
      },
    });
    await tx.call.update({
      where: { id: call.id },
      data: { ...costs, billedPaise: billed },
    });
    await tx.callEvent.create({
      data: {
        callId: call.id,
        type: "billed",
        payload: { trial: false, billedPaise: billed, markupPercent: markup },
      },
    });
    const lowBalanceAlert =
      wallet.balancePaise >= wallet.lowBalanceAlertPaise &&
      newBalance < wallet.lowBalanceAlertPaise;
    return { trial: false as const, newBalance, lowBalanceAlert };
  });

  if (!outcome.trial && outcome.lowBalanceAlert) {
    await notifyLowBalance(call.workspaceId, outcome.newBalance);
  }
  return outcome.trial ? 0 : billed;
}

/** Credit the wallet (top-up / refund). Ledger row in same transaction. */
export async function creditWallet(input: {
  workspaceId: string;
  amountPaise: number;
  type: "TOPUP" | "REFUND";
  reference?: string;
  note?: string;
}): Promise<number> {
  return db.$transaction(async (tx) => {
    if (input.reference) {
      const dup = await tx.walletTransaction.findFirst({
        where: {
          wallet: { workspaceId: input.workspaceId },
          reference: input.reference,
          type: input.type,
        },
      });
      if (dup) return dup.balanceAfterPaise; // idempotent replay
    }
    const wallet = await tx.wallet.findUnique({ where: { workspaceId: input.workspaceId } });
    if (!wallet) throw new Error("wallet not found");
    const newBalance = wallet.balancePaise + input.amountPaise;
    await tx.wallet.update({ where: { id: wallet.id }, data: { balancePaise: newBalance } });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: input.type,
        amountPaise: input.amountPaise,
        balanceAfterPaise: newBalance,
        reference: input.reference,
        note: input.note,
      },
    });
    return newBalance;
  });
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.
**If it fails:** `Property 'addOnPurchase' does not exist` → Step 1 migration not
applied; run `npx prisma generate`. `Cannot find module './webhooks'` → guide 06
Step 10 file missing; confirm `ls src/lib/webhooks.ts` — do NOT recreate it, report.

---

## Step 4: Feature gates — `checkFeatureGate()` for plan enforcement

This is the single entry point other guides call. Consumers: guide 05 (maxAgents),
guide 07 worker (concurrentLines), guide 03 invites (maxSeats), white-label and
premium-voice UI checks.

**File `src/lib/addons.ts`** (add-on catalog — pure constants, imported by gates):

```ts
/**
 * Add-on catalog (spec §10). Purchase = AddOnPurchase row + immediate first-month
 * wallet debit; recurring monthly debit by the worker cron (Step 16).
 * kind "counter" adds `amount` to a numeric plan limit; kind "flag" turns a
 * boolean plan feature on.
 */
export const ADDON_CATALOG = [
  {
    code: "extra_line",
    name: "Extra concurrent line",
    description: "+1 simultaneous call on top of your plan's lines.",
    monthlyPricePaise: 49900, // ₹499/mo per extra line
    kind: "counter",
    gate: "concurrentLines",
    amount: 1,
  },
  {
    code: "premium_voices",
    name: "Premium voices",
    description: "Unlock all 39 Sarvam Bulbul v3 voices on any plan.",
    monthlyPricePaise: 99900, // ₹999/mo
    kind: "flag",
    gate: "premiumVoices",
    amount: 0,
  },
  {
    code: "white_label",
    name: "White-label",
    description: "Your logo, colors and custom domain for your customers.",
    monthlyPricePaise: 499900, // ₹4,999/mo
    kind: "flag",
    gate: "whiteLabel",
    amount: 0,
  },
  {
    code: "dedicated_infra",
    name: "Dedicated infrastructure",
    description: "Dedicated Dograh worker pool + priority telephony routes.",
    monthlyPricePaise: 999900, // ₹9,999/mo
    kind: "flag",
    gate: "dedicatedInfra",
    amount: 0,
  },
] as const;

export type AddOnCode = (typeof ADDON_CATALOG)[number]["code"];

export function getAddOn(code: string): (typeof ADDON_CATALOG)[number] | undefined {
  return ADDON_CATALOG.find((a) => a.code === code);
}

/** Combined effect of active add-ons on one gate (pure, unit-tested). */
export function addonGateEffect(
  activeCodes: string[],
  gate: string
): { limitBonus: number; flag: boolean } {
  let limitBonus = 0;
  let flag = false;
  for (const code of activeCodes) {
    const def = getAddOn(code);
    if (!def || def.gate !== gate) continue;
    if (def.kind === "counter") limitBonus += def.amount;
    else flag = true;
  }
  return { limitBonus, flag };
}

/** Monthly total for a set of catalog codes (pure, unit-tested). */
export function monthlyAddOnTotal(codes: string[]): number {
  return codes.reduce((sum, code) => sum + (getAddOn(code)?.monthlyPricePaise ?? 0), 0);
}
```

**File `src/lib/feature-gates.ts`** (full content):

```ts
import { db } from "./db";
import { addonGateEffect } from "./addons";

export interface PlanGateFields {
  code: string;
  maxAgents: number;
  maxSeats: number;
  concurrentLines: number;
  whiteLabel: boolean;
  premiumVoices: boolean;
  dedicatedInfra: boolean;
  featureGates: unknown;
}

/** No active subscription → starter-equivalent limits (matches seed). */
export const STARTER_DEFAULTS: PlanGateFields = {
  code: "starter",
  maxAgents: 2,
  maxSeats: 2,
  concurrentLines: 2,
  whiteLabel: false,
  premiumVoices: false,
  dedicatedInfra: false,
  featureGates: null,
};

export interface GateResult {
  gate: string;
  allowed: boolean;
  limit: number | null; // numeric gates: effective limit (plan + add-on bonus)
  used: number | null;
  planCode: string;
  source: "plan" | "addon" | "default";
}

const NUMERIC_GATES = ["maxAgents", "maxSeats", "concurrentLines"] as const;
const FLAG_GATES = ["whiteLabel", "premiumVoices", "dedicatedInfra"] as const;

/**
 * Pure gate evaluation (unit-tested). Gates:
 * - numeric plan limits (maxAgents / maxSeats / concurrentLines): allowed when
 *   used < limit; active "counter" add-ons raise the limit;
 * - boolean plan features (whiteLabel / premiumVoices / dedicatedInfra): plan flag
 *   OR active "flag" add-on;
 * - any other key: looked up in Plan.featureGates JSON (e.g. "qa_scoring",
 *   "api_access", "reseller_panel") — allowed only when explicitly true.
 */
export function evaluateGate(args: {
  plan: PlanGateFields | null;
  activeAddOns: string[];
  gate: string;
  used?: number;
}): GateResult {
  const plan = args.plan ?? STARTER_DEFAULTS;
  const effect = addonGateEffect(args.activeAddOns, args.gate);

  if ((NUMERIC_GATES as readonly string[]).includes(args.gate)) {
    const key = args.gate as (typeof NUMERIC_GATES)[number];
    const limit = plan[key] + effect.limitBonus;
    const used = args.used ?? 0;
    return {
      gate: args.gate,
      allowed: used < limit,
      limit,
      used,
      planCode: plan.code,
      source: effect.limitBonus > 0 ? "addon" : "plan",
    };
  }

  if ((FLAG_GATES as readonly string[]).includes(args.gate)) {
    const key = args.gate as (typeof FLAG_GATES)[number];
    const allowed = plan[key] || effect.flag;
    return {
      gate: args.gate,
      allowed,
      limit: null,
      used: null,
      planCode: plan.code,
      source: plan[key] ? "plan" : effect.flag ? "addon" : "default",
    };
  }

  const gates =
    plan.featureGates && typeof plan.featureGates === "object"
      ? (plan.featureGates as Record<string, unknown>)
      : {};
  return {
    gate: args.gate,
    allowed: gates[args.gate] === true,
    limit: null,
    used: null,
    planCode: plan.code,
    source: "default",
  };
}

/**
 * The exported contract for other guides. Examples:
 *   const g = await checkFeatureGate(workspaceId, "maxAgents", currentAgentCount);
 *   const g = await checkFeatureGate(workspaceId, "concurrentLines", activeCalls);
 *   const g = await checkFeatureGate(workspaceId, "premiumVoices");
 */
export async function checkFeatureGate(
  workspaceId: string,
  gate: string,
  used?: number
): Promise<GateResult> {
  const [sub, addOns] = await Promise.all([
    db.subscription.findUnique({ where: { workspaceId }, include: { plan: true } }),
    db.addOnPurchase.findMany({
      where: { workspaceId, active: true },
      select: { code: true },
    }),
  ]);
  const plan = sub && sub.status === "active" ? sub.plan : null;
  return evaluateGate({
    plan,
    activeAddOns: addOns.map((a) => a.code),
    gate,
    used,
  });
}

/** Throwing variant — Error("PLAN_GATE:<gate>") when not allowed. */
export async function assertFeatureGate(
  workspaceId: string,
  gate: string,
  used?: number
): Promise<GateResult> {
  const result = await checkFeatureGate(workspaceId, gate, used);
  if (!result.allowed) throw new Error(`PLAN_GATE:${gate}`);
  return result;
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 5: Free trial — provisioning, trial status, KYC gate

`TrialState` (guide 02 schema) holds trialMinutesUsed/Limit, kycStatus and the
sandbox number. This step adds the lib and wires provisioning into guide 03's
register helper with an EXACT patch.

**File `src/lib/trial.ts`** (full content):

```ts
import { db } from "./db";
import type { TrialState } from "@prisma/client";

export const TRIAL_MINUTES_LIMIT = 30;
export const TRIAL_DAYS = 14;

/** Regulated India number series that require KYC before purchase (spec §10/§13). */
export const REGULATED_NUMBER_TYPES = ["SERIES_140", "SERIES_1600"] as const;

/**
 * Provision the free trial for a new workspace: 30 trial minutes, 14-day expiry,
 * KYC NOT_STARTED, no sandbox number yet (the sandbox DID is assigned lazily by
 * the onboarding wizard — guide 10 — which sets TrialState.sandboxNumberId).
 * Idempotent upsert. Called by guide 03's provisioning (patch below).
 */
export async function provisionTrial(workspaceId: string): Promise<TrialState> {
  return db.trialState.upsert({
    where: { workspaceId },
    update: {},
    create: {
      workspaceId,
      trialMinutesLimit: TRIAL_MINUTES_LIMIT,
      kycStatus: "NOT_STARTED",
      expiresAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
    },
  });
}

/** Remaining trial minutes (pure, unit-tested). 0 when expired or exhausted. */
export function trialMinutesRemaining(
  trial: { trialMinutesUsed: number; trialMinutesLimit: number; expiresAt: Date | null },
  now: Date
): number {
  if (trial.expiresAt !== null && trial.expiresAt.getTime() <= now.getTime()) return 0;
  return Math.max(0, trial.trialMinutesLimit - trial.trialMinutesUsed);
}

/**
 * KYC gate for regulated number purchase (pure, unit-tested).
 * Returns an error message to show the user, or null when purchase is allowed.
 */
export function kycGateError(numberType: string, kycStatus: string | null): string | null {
  if (!(REGULATED_NUMBER_TYPES as readonly string[]).includes(numberType)) return null;
  if (kycStatus === "VERIFIED") return null;
  return "KYC verification is required before buying 140/1600-series numbers. Complete KYC in Settings → KYC.";
}

/** Is this workspace KYC-verified? */
export async function isKycVerified(workspaceId: string): Promise<boolean> {
  const trial = await db.trialState.findUnique({ where: { workspaceId } });
  return trial?.kycStatus === "VERIFIED";
}
```

**Patch 1 of 2 — guide 03's provisioning helper** (`src/lib/provision.ts`, shared by
register + Google SSO auto-provision): inside `provisionUserWithWorkspace`, in the
same `db.$transaction` callback that begins with `const user = await tx.user.create(...)`
and `const workspace = await tx.workspace.create(...)`, find this exact block (near
the end of the transaction):

```ts
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balancePaise: 100000 },
    });
    return { user, workspace };
```

Replace it with:

```ts
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balancePaise: 100000 },
    });
    // Free trial (spec §10): 30 trial minutes, 14 days, KYC-gated (guide 09).
    await tx.trialState.create({
      data: {
        workspaceId: workspace.id,
        trialMinutesLimit: 30,
        kycStatus: "NOT_STARTED",
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });
    return { user, workspace };
```

**Patch 2 of 2 — guide 06's number action** (`src/server/actions/numbers.ts`):
KYC-gate regulated series + create the `NumberRental` row the rental cron bills.
Find this exact block inside `registerNumberAction`:

```ts
    await db.phoneNumber.create({
      data: { ...parsed.data, workspaceId: ctx.workspaceId },
    });
```

Replace it with:

```ts
    // KYC gate (spec §10/§13): 140/1600 series require a VERIFIED KycStatus.
    const kycError = kycGateError(
      parsed.data.numberType,
      (await db.trialState.findUnique({ where: { workspaceId: ctx.workspaceId } }))?.kycStatus ?? null
    );
    if (kycError) return { ok: false, error: kycError };

    const created = await db.phoneNumber.create({
      data: { ...parsed.data, workspaceId: ctx.workspaceId },
    });
    // Monthly rental record (guide 09 cron bills it; margin already inside rent).
    if (created.monthlyRentPaise > 0) {
      await db.numberRental.create({
        data: {
          workspaceId: ctx.workspaceId,
          phoneNumberId: created.id,
          monthlyPricePaise: created.monthlyRentPaise,
          marginPercent: 20,
        },
      });
    }
```

And add the import at the top of `src/server/actions/numbers.ts`, directly after
the line `import { audit } from "@/lib/audit";`:

```ts
import { kycGateError } from "@/lib/trial";
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.
**If it fails:** the anchor block is not found → guide 03/06 drifted; make the
minimal equivalent edit (trialState.create inside the same transaction; KYC check
before phoneNumber.create) and note the deviation in your report. Do NOT rewrite
those files wholesale.

---

## Step 6: Wire billing into the post-call pipeline (EVERY exit path)

Guide 06's `src/lib/postcall.ts` owns `processCompletedCall`. Billing must run on
**every** exit path: the no-transcript early return can still be an ANSWERED call
with `durationSec > 0` (e.g. STT failure) — wiring `billCall` only at the function
end would leak that revenue. The clean fix is to bill immediately after the Call
row is loaded (the `call.ended` webhook has already written `durationSec` by the
time post-call runs). Re-entry is safe: `billCall` is idempotent (`billedPaise > 0`
or an existing `billed` CallEvent → no-op; `debitWallet` also dedupes by ledger
reference).

**Edit `src/lib/postcall.ts`:** add the import directly after the existing
`import { emitWebhookEvent } from "./webhooks";` line:

```ts
import { billCall } from "./billing";
```

Then find this exact block near the top of `processCompletedCall`:

```ts
  if (!call) return;

  // --- Missed-call path: inbound call that never got answered -----------------
```

Replace it with:

```ts
  if (!call) return;

  // Meter FIRST (guide 09): wholesale rate card + plan markup → trial minutes or
  // wallet debit. Runs before every early return so answered calls without a
  // transcript (STT failure) are still billed. No-ops on unanswered calls
  // (durationSec = 0). Billing failures must never break post-call processing.
  try {
    await billCall(call.id);
  } catch (e) {
    console.error("billing failed for call", call.id, e);
  }

  // --- Missed-call path: inbound call that never got answered -----------------
```

Do NOT add a second `billCall` anywhere else in the function — one call, right
here, covers all paths. If the anchor block differs (guide 06 drifted), place the
same `try { await billCall(call.id); } catch …` block immediately after the first
`if (!call) return;` inside `processCompletedCall` and note the deviation.

**Verify:**
```bash
grep -c "billCall" src/lib/postcall.ts
grep -n "billCall(call.id)" src/lib/postcall.ts
npm run typecheck
```
**Expected:** `2` (import + call); the call site line number is BELOW the
`if (!call) return;` line and ABOVE the `if (!call.transcript)` line; typecheck
exit 0.

---

## Step 7: Auto top-up — settings + execution scaffold (Razorpay tokenization OPERATOR GATED)

When the wallet falls below the workspace's `AutoTopUp.thresholdPaise`, charge the
saved Razorpay token for `amountPaise`. Razorpay off-session charges need the
**Card Tokenization / e-mandate feature enabled on your Razorpay account** —
OPERATOR GATE: request it via Razorpay dashboard → Settings → Configuration (or
support), then save the `token` id from a first customer payment into
`AutoTopUp.paymentMethodRef` and set `AUTOTOPUP_ENABLED=true`. Until then the flow
runs in dry-run mode (logs the intent, charges nothing) — everything else
(settings UI, trigger condition, sweep cron) is fully functional.

**File `src/lib/autotopup.ts`** (full content):

```ts
import Razorpay from "razorpay";
import { db } from "./db";
import { creditWallet } from "./billing";

/** Trigger condition (pure, unit-tested). */
export function shouldAutoTopUp(
  cfg: { active: boolean; thresholdPaise: number } | null,
  balancePaise: number
): boolean {
  return cfg !== null && cfg.active && balancePaise < cfg.thresholdPaise;
}

export type AutoTopUpResult = {
  ok: boolean;
  skipped?: boolean;
  dryRun?: boolean;
  charged?: boolean;
  error?: string;
};

/**
 * Execute one auto top-up for a workspace. Dry-run unless AUTOTOPUP_ENABLED=true
 * AND a Razorpay token is saved (OPERATOR GATE — Razorpay tokenization must be
 * enabled on the account). The wallet credit happens here (charge is synchronous);
 * a duplicate sweep is harmless because the balance will be above threshold after
 * the first successful charge.
 */
export async function runAutoTopUp(workspaceId: string): Promise<AutoTopUpResult> {
  const [cfg, wallet] = await Promise.all([
    db.autoTopUp.findUnique({ where: { workspaceId } }),
    db.wallet.findUnique({ where: { workspaceId } }),
  ]);
  if (!cfg || !wallet || !shouldAutoTopUp(cfg, wallet.balancePaise)) {
    return { ok: true, skipped: true };
  }

  const enabled = process.env.AUTOTOPUP_ENABLED === "true";
  if (!enabled || !cfg.paymentMethodRef) {
    console.log(
      `[autotopup] DRY RUN would charge ${cfg.amountPaise} paise for workspace ${workspaceId} ` +
        `(balance ${wallet.balancePaise} < threshold ${cfg.thresholdPaise})`
    );
    return { ok: true, dryRun: true };
  }

  try {
    const rzp = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!,
      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    });
    const order = await rzp.orders.create({
      amount: cfg.amountPaise,
      currency: "INR",
      receipt: `autotopup_${workspaceId.slice(-8)}_${Date.now()}`,
      notes: { workspaceId },
    });
    // Off-session charge against the saved token (Razorpay recurring payments API).
    const auth = Buffer.from(
      `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
    ).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/payments/create/recurring", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({
        amount: cfg.amountPaise,
        currency: "INR",
        order_id: order.id,
        token: cfg.paymentMethodRef,
        recurring: "1",
        description: "Vaani AI wallet auto top-up",
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `razorpay recurring charge failed: ${res.status}` };
    }
    const body = (await res.json()) as { razorpay_payment_id?: string };
    await db.paymentOrder.create({
      data: {
        workspaceId,
        provider: "RAZORPAY",
        providerOrderId: order.id,
        amountPaise: cfg.amountPaise,
        status: "paid",
      },
    });
    await creditWallet({
      workspaceId,
      amountPaise: cfg.amountPaise,
      type: "TOPUP",
      reference: body.razorpay_payment_id ?? order.id,
      note: "Auto top-up",
    });
    return { ok: true, charged: true };
  } catch (e) {
    console.error("runAutoTopUp failed", e);
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

/** Sweep every workspace with auto top-up enabled (called by the worker cron). */
export async function runAutoTopUpSweep(): Promise<void> {
  const configs = await db.autoTopUp.findMany({ where: { active: true } });
  for (const cfg of configs) {
    const r = await runAutoTopUp(cfg.workspaceId);
    if (!r.ok) console.error(`[autotopup] ${cfg.workspaceId}: ${r.error}`);
  }
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 8: GST invoicing — numbering, GST split, monthly generation, HTML storage

**File `src/lib/invoice.ts`** (full content):

```ts
import { db } from "./db";
import { splitGst } from "./money";
import { putInvoiceHtml } from "./invoice-store";

/**
 * Indian financial year runs April→March. Tag = "<startYY><endYY>", e.g. FY
 * 2025-26 → "2526" (pure, unit-tested).
 */
export function financialYearTag(date: Date): string {
  const start = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${String(start % 100).padStart(2, "0")}${String((start + 1) % 100).padStart(2, "0")}`;
}

/** First day (local) of the financial year containing `date`. */
export function fyStartDate(date: Date): Date {
  const start = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return new Date(start, 3, 1);
}

/** Sequential per-workspace invoice number: VAANI/<fyTag>/<seq 4dp> (unit-tested). */
export function formatInvoiceNumber(sequence: number, date: Date): string {
  return `VAANI/${financialYearTag(date)}/${String(sequence).padStart(4, "0")}`;
}

/** Next sequence = count of this workspace's invoices this FY + 1 (no schema field
 *  needed — the number is derived, never stored). */
export async function nextInvoiceSequence(workspaceId: string, date: Date): Promise<number> {
  const count = await db.invoice.count({
    where: { workspaceId, createdAt: { gte: fyStartDate(date) } },
  });
  return count + 1;
}

/**
 * GST on GST-inclusive retail totals (pure, unit-tested): back out the taxable
 * base (total × 100/118 at 18%), then splitGst — IGST for inter-state supply,
 * CGST+SGST otherwise. base + totalGst always equals `totalPaise` up to ±1 paise.
 */
export function gstInclusiveSplit(
  totalPaise: number,
  interState: boolean,
  ratePercent = 18
): { basePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalGstPaise: number } {
  const basePaise = Math.round((totalPaise * 100) / (100 + ratePercent));
  return { basePaise, ...splitGst(basePaise, interState, ratePercent) };
}

/**
 * Place-of-supply → inter-state decision (pure, unit-tested).
 * placeOfSupply format: "Karnataka (29)". B2C with no place recorded → intra-state
 * (documented simplification).
 */
export function isInterState(
  placeOfSupply: string | null | undefined,
  companyStateCode: string
): boolean {
  if (!placeOfSupply) return false;
  const m = placeOfSupply.match(/\((\d{2})\)/);
  return m ? m[1] !== companyStateCode : false;
}

const BILLABLE_TYPES = ["CALL_DEBIT", "NUMBER_RENT", "ADDON_DEBIT", "PLAN_FEE"] as const;

export function renderInvoiceHtml(args: {
  invoiceNumber: string;
  date: Date;
  companyName: string;
  companyGstin: string;
  customerName: string;
  customerGstin: string | null;
  placeOfSupply: string | null;
  hsnSac: string;
  lines: { label: string; amountPaise: number }[];
  basePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}): string {
  const inr = (p: number) => `₹${(p / 100).toFixed(2)}`;
  const rows = args.lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 12px;border:1px solid #ccc">${l.label}</td>` +
        `<td style="padding:6px 12px;border:1px solid #ccc;text-align:right">${inr(l.amountPaise)}</td></tr>`
    )
    .join("");
  const gstRow =
    args.igstPaise > 0
      ? `<tr><td style="padding:6px 12px;border:1px solid #ccc">IGST @18%</td><td style="padding:6px 12px;border:1px solid #ccc;text-align:right">${inr(args.igstPaise)}</td></tr>`
      : `<tr><td style="padding:6px 12px;border:1px solid #ccc">CGST @9%</td><td style="padding:6px 12px;border:1px solid #ccc;text-align:right">${inr(args.cgstPaise)}</td></tr>` +
        `<tr><td style="padding:6px 12px;border:1px solid #ccc">SGST @9%</td><td style="padding:6px 12px;border:1px solid #ccc;text-align:right">${inr(args.sgstPaise)}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Tax Invoice ${args.invoiceNumber}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;color:#111">
<h1 style="margin-bottom:0">Tax Invoice</h1>
<p style="color:#555">${args.invoiceNumber} · ${args.date.toLocaleDateString("en-IN")}</p>
<table style="width:100%;margin:16px 0"><tr>
<td><strong>From</strong><br>${args.companyName}<br>GSTIN: ${args.companyGstin}</td>
<td><strong>Billed to</strong><br>${args.customerName}<br>${args.customerGstin ? `GSTIN: ${args.customerGstin}<br>` : ""}Place of supply: ${args.placeOfSupply ?? "—"}</td>
</tr></table>
<p>HSN/SAC: ${args.hsnSac}</p>
<table style="width:100%;border-collapse:collapse">
<tr><th style="padding:6px 12px;border:1px solid #ccc;text-align:left">Description</th><th style="padding:6px 12px;border:1px solid #ccc;text-align:right">Amount</th></tr>
${rows}
<tr><td style="padding:6px 12px;border:1px solid #ccc"><strong>Taxable value</strong></td><td style="padding:6px 12px;border:1px solid #ccc;text-align:right">${inr(args.basePaise)}</td></tr>
${gstRow}
<tr><td style="padding:6px 12px;border:1px solid #ccc"><strong>Total (GST-inclusive)</strong></td><td style="padding:6px 12px;border:1px solid #ccc;text-align:right"><strong>${inr(args.totalPaise)}</strong></td></tr>
</table>
<p style="color:#555;font-size:12px;margin-top:24px">Generated by Vaani AI. This is a computer-generated invoice.</p>
</body></html>`;
}

/**
 * Generate the monthly GST invoice for a workspace from its wallet debits
 * (calls + rentals + add-ons + plan fee) in the given month. Stores the HTML in
 * MinIO and the key in Invoice.pdfKey. Returns null when there is nothing to bill.
 */
export async function generateMonthlyInvoice(
  workspaceId: string,
  month: Date
): Promise<{ invoiceId: string; invoiceNumber: string; totalPaise: number } | null> {
  const periodStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const periodEnd = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const wallet = await db.wallet.findUnique({ where: { workspaceId } });
  if (!wallet) return null;

  const txns = await db.walletTransaction.findMany({
    where: {
      walletId: wallet.id,
      createdAt: { gte: periodStart, lt: periodEnd },
      type: { in: [...BILLABLE_TYPES] },
    },
  });
  const byType = new Map<string, number>();
  for (const t of txns) {
    byType.set(t.type, (byType.get(t.type) ?? 0) + Math.abs(t.amountPaise));
  }
  const total = [...byType.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return null;

  const ws = await db.workspace.findUnique({ where: { id: workspaceId } });
  const interState = isInterState(
    ws?.billingPlaceOfSupply,
    process.env.BILLING_COMPANY_STATE_CODE ?? "29"
  );
  const gst = gstInclusiveSplit(total, interState);
  const seq = await nextInvoiceSequence(workspaceId, periodStart);
  const invoiceNumber = formatInvoiceNumber(seq, periodStart);

  const labels: Record<string, string> = {
    CALL_DEBIT: "AI call usage",
    NUMBER_RENT: "Phone number rental",
    ADDON_DEBIT: "Add-ons",
    PLAN_FEE: "Subscription plan fee",
  };
  const lines = [...byType.entries()].map(([type, amountPaise]) => ({
    label: labels[type] ?? type,
    amountPaise,
  }));

  const invoice = await db.invoice.create({
    data: {
      workspaceId,
      amountPaise: gst.basePaise,
      gstPaise: gst.totalGstPaise,
      cgstPaise: gst.cgstPaise,
      sgstPaise: gst.sgstPaise,
      igstPaise: gst.igstPaise,
      gstin: ws?.billingGstin,
      placeOfSupply: ws?.billingPlaceOfSupply,
      hsnSac: ws?.billingHsnSac ?? "998314",
      status: "paid", // already collected via wallet debits
    },
  });

  const html = renderInvoiceHtml({
    invoiceNumber,
    date: periodEnd,
    companyName: process.env.BILLING_COMPANY_NAME ?? "Vaani AI",
    companyGstin: process.env.BILLING_COMPANY_GSTIN ?? "—",
    customerName: ws?.name ?? "Customer",
    customerGstin: ws?.billingGstin ?? null,
    placeOfSupply: ws?.billingPlaceOfSupply ?? null,
    hsnSac: ws?.billingHsnSac ?? "998314",
    lines,
    basePaise: gst.basePaise,
    cgstPaise: gst.cgstPaise,
    sgstPaise: gst.sgstPaise,
    igstPaise: gst.igstPaise,
    totalPaise: total,
  });
  const key = `invoices/${workspaceId}/${invoice.id}.html`;
  await putInvoiceHtml(key, html);
  await db.invoice.update({ where: { id: invoice.id }, data: { pdfKey: key } });

  return { invoiceId: invoice.id, invoiceNumber, totalPaise: total };
}
```

**File `src/lib/invoice-store.ts`** (full content — MinIO storage for invoice HTML,
kept separate so guide 08's `storage.ts` is not touched):

```ts
import { s3, RECORDINGS_BUCKET, ensureBucket } from "./storage";

/** Store the rendered invoice HTML (browser print → PDF; wkhtmltopdf optional). */
export async function putInvoiceHtml(key: string, html: string): Promise<void> {
  await ensureBucket();
  const buf = Buffer.from(html, "utf8");
  await s3.putObject(RECORDINGS_BUCKET, key, buf, buf.length, {
    "Content-Type": "text/html",
  });
}

/** Presigned URL to download the stored invoice HTML (15 min). */
export async function invoiceFileUrl(key: string): Promise<string> {
  await ensureBucket();
  return s3.presignedGetObject(RECORDINGS_BUCKET, key, 15 * 60);
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 9: Reseller panel — lib + guard convention

**File `src/lib/reseller.ts`** (full content):

```ts
import { z } from "zod";
import { db } from "./db";

/** Wholesale rate card JSON editor validation (per-minute paise, partial). */
export const wholesaleRateCardSchema = z
  .object({
    telephonyPerMinPaise: z.coerce.number().int().min(0),
    sttPerMinPaise: z.coerce.number().int().min(0),
    llmPerMinPaise: z.coerce.number().int().min(0),
    ttsPerMinPaise: z.coerce.number().int().min(0),
  })
  .partial();

/** Per-child usage rollup (pure, unit-tested). revenue = billed to the child;
 *  cost = our wholesale cost; margin = revenue − cost. */
export function summarizeUsage(input: {
  calls: { durationSec: number; billedPaise: number; wholesalePaise: number }[];
}): {
  totalCalls: number;
  totalMinutes: number;
  revenuePaise: number;
  costPaise: number;
  marginPaise: number;
} {
  const totalCalls = input.calls.length;
  const totalMinutes = input.calls.reduce((a, c) => a + Math.ceil(c.durationSec / 60), 0);
  const revenuePaise = input.calls.reduce((a, c) => a + c.billedPaise, 0);
  const costPaise = input.calls.reduce((a, c) => a + c.wholesalePaise, 0);
  return { totalCalls, totalMinutes, revenuePaise, costPaise, marginPaise: revenuePaise - costPaise };
}

export interface ChildRollupRow {
  workspaceId: string;
  name: string;
  slug: string;
  totalCalls: number;
  totalMinutes: number;
  revenuePaise: number;
  costPaise: number;
  marginPaise: number;
}

/** Usage rollup across all child workspaces of a reseller since a date. */
export async function childUsageRollup(
  parentWorkspaceId: string,
  since: Date
): Promise<ChildRollupRow[]> {
  const reseller = await db.resellerAccount.findUnique({
    where: { parentWorkspaceId },
    include: { children: { select: { id: true, name: true, slug: true } } },
  });
  if (!reseller) return [];
  const rows: ChildRollupRow[] = [];
  for (const child of reseller.children) {
    const calls = await db.call.findMany({
      where: { workspaceId: child.id, createdAt: { gte: since } },
      select: {
        durationSec: true,
        billedPaise: true,
        costTelephonyPaise: true,
        costSttPaise: true,
        costLlmPaise: true,
        costTtsPaise: true,
      },
    });
    const s = summarizeUsage({
      calls: calls.map((c) => ({
        durationSec: c.durationSec,
        billedPaise: c.billedPaise,
        wholesalePaise:
          c.costTelephonyPaise + c.costSttPaise + c.costLlmPaise + c.costTtsPaise,
      })),
    });
    rows.push({ workspaceId: child.id, name: child.name, slug: child.slug, ...s });
  }
  return rows;
}
```

**Reseller guard convention (canonical — do NOT invent new permission keys):**
guide 03's permission vocabulary is final; there is no `reseller:manage` key. Guard
every reseller page and server action with:

1. `requirePermission("billing:read")` (pages/reports) or
   `requirePermission("billing:write")` (mutations), then
2. a `ResellerAccount`-exists check for the current workspace
   (`db.resellerAccount.findUnique({ where: { parentWorkspaceId: ctx.workspaceId } })`)
   — non-resellers get `{ ok: false, error: "Reseller panel is not enabled for this workspace." }`.

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 10: Unit tests (Vitest)

All files under `tests/` (the `vitest.config.ts` from guide 06 already includes
`tests/**/*.test.ts` with the `@` alias — do not recreate it).

**File `tests/billing-ratecard.test.ts`:**

```ts
import { describe, expect, it } from "vitest";
import {
  componentCosts,
  retailTotalPaise,
  wholesaleTotalPaise,
  parseRateCardJson,
  DEFAULT_RATE_CARD,
} from "../src/lib/ratecard";
import { decideTrialBilling } from "../src/lib/billing";

describe("componentCosts (per-second metering)", () => {
  it("computes the canonical 200s call from the default rate card", () => {
    const c = componentCosts(200);
    expect(c.costTelephonyPaise).toBe(100); // ceil(200*30/60)
    expect(c.costSttPaise).toBe(60); // ceil(200*18/60)
    expect(c.costLlmPaise).toBe(40); // ceil(200*12/60)
    expect(c.costTtsPaise).toBe(80); // ceil(200*24/60)
    expect(wholesaleTotalPaise(c)).toBe(280);
  });
  it("rounds partial paise UP per second (31s at ₹0.30/min)", () => {
    expect(componentCosts(31).costTelephonyPaise).toBe(16); // ceil(31*30/60)=15.5→16
  });
  it("bills 0 for zero/negative duration", () => {
    expect(wholesaleTotalPaise(componentCosts(0))).toBe(0);
    expect(wholesaleTotalPaise(componentCosts(-5))).toBe(0);
  });
  it("scales per-second, not per-minute (1s call is not a full minute)", () => {
    expect(componentCosts(1).costTelephonyPaise).toBe(1); // ceil(1*30/60)=0.5→1
    expect(componentCosts(60).costTelephonyPaise).toBe(30);
  });
});

describe("retailTotalPaise (markup per component)", () => {
  it("applies the plan markup (starter 40% on the 200s call → 392)", () => {
    expect(retailTotalPaise(componentCosts(200), 40)).toBe(392);
  });
  it("honours per-plan override (enterprise 50%)", () => {
    expect(retailTotalPaise(componentCosts(200), 50)).toBe(420); // 280*1.5
  });
  it("zero cost → zero billed regardless of markup", () => {
    expect(retailTotalPaise(componentCosts(0), 45)).toBe(0);
  });
});

describe("parseRateCardJson (reseller wholesale override)", () => {
  it("falls back to defaults on garbage", () => {
    expect(parseRateCardJson(null)).toEqual(DEFAULT_RATE_CARD);
    expect(parseRateCardJson("junk")).toEqual(DEFAULT_RATE_CARD);
    expect(parseRateCardJson({ telephonyPerMinPaise: -1 })).toEqual(DEFAULT_RATE_CARD);
  });
  it("merges a partial override", () => {
    const r = parseRateCardJson({ telephonyPerMinPaise: 45 });
    expect(r.telephonyPerMinPaise).toBe(45);
    expect(r.sttPerMinPaise).toBe(DEFAULT_RATE_CARD.sttPerMinPaise);
  });
});

describe("decideTrialBilling (trial-minute enforcement)", () => {
  const base = { trialMinutesUsed: 0, trialMinutesLimit: 30, expiresAt: null, callMinutes: 4 };
  const now = new Date("2026-01-10T00:00:00Z");
  it("uses trial minutes when they fit", () => {
    expect(decideTrialBilling({ ...base, now }).useTrial).toBe(true);
  });
  it("bills the wallet when the call does not fit ENTIRELY", () => {
    expect(
      decideTrialBilling({ ...base, trialMinutesUsed: 28, now }).useTrial
    ).toBe(false); // 28+4 > 30
  });
  it("boundary: exact fit is allowed", () => {
    expect(
      decideTrialBilling({ ...base, trialMinutesUsed: 26, now }).useTrial
    ).toBe(true); // 26+4 = 30
  });
  it("expired trial never applies", () => {
    expect(
      decideTrialBilling({ ...base, expiresAt: new Date("2026-01-01"), now }).useTrial
    ).toBe(false);
  });
});
```

**File `tests/feature-gates.test.ts`:**

```ts
import { describe, expect, it } from "vitest";
import { evaluateGate, STARTER_DEFAULTS } from "../src/lib/feature-gates";
import type { PlanGateFields } from "../src/lib/feature-gates";

const growth: PlanGateFields = {
  code: "growth",
  maxAgents: 10,
  maxSeats: 10,
  concurrentLines: 10,
  whiteLabel: false,
  premiumVoices: true,
  dedicatedInfra: false,
  featureGates: { qa_scoring: true, api_access: true },
};

describe("evaluateGate — numeric plan limits", () => {
  it("blocks at the plan limit (starter maxAgents=2)", () => {
    const g = evaluateGate({ plan: null, activeAddOns: [], gate: "maxAgents", used: 2 });
    expect(g.allowed).toBe(false);
    expect(g.limit).toBe(2);
    expect(g.planCode).toBe("starter"); // no subscription → starter defaults
  });
  it("allows below the limit", () => {
    expect(evaluateGate({ plan: null, activeAddOns: [], gate: "maxAgents", used: 1 }).allowed).toBe(true);
  });
  it("extra_line add-on raises concurrentLines", () => {
    const g = evaluateGate({
      plan: null,
      activeAddOns: ["extra_line", "extra_line"],
      gate: "concurrentLines",
      used: 3,
    });
    expect(g.limit).toBe(4); // 2 + 2 add-on lines
    expect(g.allowed).toBe(true);
    expect(g.source).toBe("addon");
  });
});

describe("evaluateGate — boolean features", () => {
  it("whiteLabel off on starter, on via add-on", () => {
    expect(evaluateGate({ plan: null, activeAddOns: [], gate: "whiteLabel" }).allowed).toBe(false);
    const g = evaluateGate({ plan: null, activeAddOns: ["white_label"], gate: "whiteLabel" });
    expect(g.allowed).toBe(true);
    expect(g.source).toBe("addon");
  });
  it("premiumVoices on from the plan itself", () => {
    const g = evaluateGate({ plan: growth, activeAddOns: [], gate: "premiumVoices" });
    expect(g.allowed).toBe(true);
    expect(g.source).toBe("plan");
  });
});

describe("evaluateGate — featureGates JSON keys", () => {
  it("reads arbitrary keys from Plan.featureGates", () => {
    expect(evaluateGate({ plan: growth, activeAddOns: [], gate: "qa_scoring" }).allowed).toBe(true);
    expect(evaluateGate({ plan: growth, activeAddOns: [], gate: "reseller_panel" }).allowed).toBe(false);
  });
  it("starter defaults expose nothing", () => {
    expect(STARTER_DEFAULTS.featureGates).toBeNull();
    expect(evaluateGate({ plan: null, activeAddOns: [], gate: "api_access" }).allowed).toBe(false);
  });
});
```

**File `tests/invoice.test.ts`:**

```ts
import { describe, expect, it } from "vitest";
import {
  financialYearTag,
  formatInvoiceNumber,
  gstInclusiveSplit,
  isInterState,
  renderInvoiceHtml,
} from "../src/lib/invoice";

describe("invoice numbering (VAANI/<fy>/<seq>)", () => {
  it("computes the financial year tag (April→March)", () => {
    expect(financialYearTag(new Date("2025-04-01T00:00:00"))).toBe("2526");
    expect(financialYearTag(new Date("2026-03-31T00:00:00"))).toBe("2526");
    expect(financialYearTag(new Date("2025-01-15T00:00:00"))).toBe("2425");
  });
  it("formats with 4-digit sequence padding", () => {
    expect(formatInvoiceNumber(1, new Date("2025-06-01"))).toBe("VAANI/2526/0001");
    expect(formatInvoiceNumber(42, new Date("2026-02-01"))).toBe("VAANI/2526/0042");
  });
});

describe("gstInclusiveSplit (both GST branches)", () => {
  it("intra-state → CGST + SGST on the backed-out base", () => {
    const g = gstInclusiveSplit(100000, false); // ₹1,000 incl.
    expect(g.basePaise).toBe(84746); // round(100000*100/118)
    expect(g.igstPaise).toBe(0);
    expect(g.cgstPaise + g.sgstPaise).toBe(g.totalGstPaise);
    expect(g.basePaise + g.totalGstPaise).toBe(100000); // 18% of 84746 = 15254
  });
  it("inter-state → IGST only", () => {
    const g = gstInclusiveSplit(100000, true);
    expect(g.igstPaise).toBe(g.totalGstPaise);
    expect(g.cgstPaise).toBe(0);
    expect(g.sgstPaise).toBe(0);
    expect(g.basePaise + g.igstPaise).toBe(100000);
  });
  it("keeps cgst+sgst == total on odd amounts", () => {
    const g = gstInclusiveSplit(101, false);
    expect(g.cgstPaise + g.sgstPaise).toBe(g.totalGstPaise);
  });
});

describe("isInterState (place of supply parsing)", () => {
  it("compares the (NN) state code with the company state", () => {
    expect(isInterState("Maharashtra (27)", "29")).toBe(true);
    expect(isInterState("Karnataka (29)", "29")).toBe(false);
  });
  it("no place of supply → intra-state (B2C default)", () => {
    expect(isInterState(null, "29")).toBe(false);
    expect(isInterState(undefined, "29")).toBe(false);
  });
});

describe("renderInvoiceHtml", () => {
  const base = {
    invoiceNumber: "VAANI/2526/0001",
    date: new Date("2025-06-30"),
    companyName: "Vaani AI Pvt Ltd",
    companyGstin: "29AAAAA0000A1Z5",
    customerName: "Demo Dental Clinic",
    customerGstin: null,
    placeOfSupply: "Karnataka (29)",
    hsnSac: "998314",
    lines: [{ label: "AI call usage", amountPaise: 392 }],
    cgstPaise: 0,
    sgstPaise: 0,
    igstPaise: 0,
    totalPaise: 392,
  };
  it("shows CGST+SGST rows for intra-state", () => {
    const html = renderInvoiceHtml({ ...base, basePaise: 333, cgstPaise: 30, sgstPaise: 29, totalPaise: 392 });
    expect(html).toContain("CGST @9%");
    expect(html).toContain("SGST @9%");
    expect(html).not.toContain("IGST @18%");
    expect(html).toContain("VAANI/2526/0001");
  });
  it("shows a single IGST row for inter-state", () => {
    const html = renderInvoiceHtml({ ...base, basePaise: 333, igstPaise: 59, totalPaise: 392 });
    expect(html).toContain("IGST @18%");
    expect(html).not.toContain("CGST @9%");
  });
});
```

**File `tests/stripe-sig.test.ts`:**

```ts
import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { verifyStripeSignature } from "../src/lib/stripe-sig";

const SECRET = "whsec_test_secret_123";
const PAYLOAD = JSON.stringify({
  id: "evt_1",
  type: "checkout.session.completed",
  data: { object: { id: "cs_test_1" } },
});

function sign(payload: string, secret: string, t: number): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

describe("verifyStripeSignature", () => {
  const now = 1_800_000_000_000; // fixed "now" in ms
  const t = Math.floor(now / 1000);

  it("accepts a correctly signed payload", () => {
    expect(verifyStripeSignature(PAYLOAD, sign(PAYLOAD, SECRET, t), SECRET, 300, now)).toBe(true);
  });
  it("rejects a wrong secret", () => {
    expect(verifyStripeSignature(PAYLOAD, sign(PAYLOAD, "whsec_wrong", t), SECRET, 300, now)).toBe(false);
  });
  it("rejects a tampered payload", () => {
    const evil = PAYLOAD.replace("cs_test_1", "cs_test_evil");
    expect(verifyStripeSignature(evil, sign(PAYLOAD, SECRET, t), SECRET, 300, now)).toBe(false);
  });
  it("rejects an old timestamp (replay protection)", () => {
    const oldT = t - 3600;
    expect(verifyStripeSignature(PAYLOAD, sign(PAYLOAD, SECRET, oldT), SECRET, 300, now)).toBe(false);
  });
  it("rejects a malformed header", () => {
    expect(verifyStripeSignature(PAYLOAD, "garbage", SECRET, 300, now)).toBe(false);
  });
});
```

**File `src/lib/stripe-sig.ts`** (full content — the route and the test share this):

```ts
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verify a Stripe webhook `Stripe-Signature` header without the SDK (pure,
 * unit-testable): header is "t=<unix>,v1=<hmac256 hex of `${t}.${payload}`>".
 * Rejects timestamps older than toleranceSec (replay protection).
 */
export function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  toleranceSec = 300,
  nowMs = Date.now()
): boolean {
  if (!secret || !header) return false;
  const parts = header.split(",");
  const tPart = parts.find((p) => p.startsWith("t="));
  const v1Parts = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!tPart || v1Parts.length === 0) return false;
  const t = Number(tPart.slice(2));
  if (!Number.isFinite(t)) return false;
  if (Math.abs(nowMs - t * 1000) > toleranceSec * 1000) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return v1Parts.some((v1) => {
    const a = Buffer.from(v1);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
```

**File `tests/addons-autotopup-reseller.test.ts`:**

```ts
import { describe, expect, it } from "vitest";
import { ADDON_CATALOG, addonGateEffect, getAddOn, monthlyAddOnTotal } from "../src/lib/addons";
import { shouldAutoTopUp } from "../src/lib/autotopup";
import { summarizeUsage } from "../src/lib/reseller";
import { trialMinutesRemaining, kycGateError } from "../src/lib/trial";

describe("add-on catalog", () => {
  it("covers the four spec add-ons with unique codes", () => {
    expect(ADDON_CATALOG.map((a) => a.code)).toEqual([
      "extra_line",
      "premium_voices",
      "white_label",
      "dedicated_infra",
    ]);
    expect(new Set(ADDON_CATALOG.map((a) => a.code)).size).toBe(4);
    for (const a of ADDON_CATALOG) expect(a.monthlyPricePaise).toBeGreaterThan(0);
  });
  it("computes monthly totals and gate effects", () => {
    expect(monthlyAddOnTotal(["extra_line", "premium_voices"])).toBe(49900 + 99900);
    expect(monthlyAddOnTotal(["nonsense"])).toBe(0);
    expect(addonGateEffect(["extra_line"], "concurrentLines")).toEqual({ limitBonus: 1, flag: false });
    expect(addonGateEffect(["white_label"], "whiteLabel")).toEqual({ limitBonus: 0, flag: true });
    expect(addonGateEffect(["extra_line"], "whiteLabel")).toEqual({ limitBonus: 0, flag: false });
  });
  it("proration-free purchase: getAddOn prices are the full monthly price", () => {
    expect(getAddOn("extra_line")?.monthlyPricePaise).toBe(49900);
  });
});

describe("shouldAutoTopUp (trigger condition)", () => {
  it("fires only when active AND below threshold", () => {
    expect(shouldAutoTopUp({ active: true, thresholdPaise: 50000 }, 49999)).toBe(true);
    expect(shouldAutoTopUp({ active: true, thresholdPaise: 50000 }, 50000)).toBe(false);
    expect(shouldAutoTopUp({ active: false, thresholdPaise: 50000 }, 100)).toBe(false);
    expect(shouldAutoTopUp(null, 100)).toBe(false);
  });
});

describe("summarizeUsage (reseller rollup aggregation)", () => {
  it("aggregates calls, minutes, revenue, margin", () => {
    const s = summarizeUsage({
      calls: [
        { durationSec: 200, billedPaise: 392, wholesalePaise: 280 },
        { durationSec: 61, billedPaise: 100, wholesalePaise: 70 },
      ],
    });
    expect(s.totalCalls).toBe(2);
    expect(s.totalMinutes).toBe(6); // ceil(200/60)+ceil(61/60) = 4+2
    expect(s.revenuePaise).toBe(492);
    expect(s.costPaise).toBe(350);
    expect(s.marginPaise).toBe(142);
  });
  it("empty input → all zeros", () => {
    expect(summarizeUsage({ calls: [] })).toEqual({
      totalCalls: 0, totalMinutes: 0, revenuePaise: 0, costPaise: 0, marginPaise: 0,
    });
  });
});

describe("trial helpers", () => {
  const now = new Date("2026-01-10T00:00:00Z");
  it("trialMinutesRemaining respects usage and expiry", () => {
    expect(
      trialMinutesRemaining({ trialMinutesUsed: 10, trialMinutesLimit: 30, expiresAt: null }, now)
    ).toBe(20);
    expect(
      trialMinutesRemaining(
        { trialMinutesUsed: 0, trialMinutesLimit: 30, expiresAt: new Date("2026-01-01") },
        now
      )
    ).toBe(0);
    expect(
      trialMinutesRemaining({ trialMinutesUsed: 99, trialMinutesLimit: 30, expiresAt: null }, now)
    ).toBe(0);
  });
  it("kycGateError blocks regulated series until VERIFIED", () => {
    expect(kycGateError("SERIES_140", "NOT_STARTED")).toContain("KYC");
    expect(kycGateError("SERIES_1600", "PENDING")).toContain("KYC");
    expect(kycGateError("SERIES_140", "VERIFIED")).toBeNull();
    expect(kycGateError("LOCAL", "NOT_STARTED")).toBeNull();
  });
});
```

**Do:**
```bash
cd /root/vaani-ai && npm test
```
**Expected:** `Test Files` all passed (7+ files incl. guide-02/06/07/08 suites),
`Tests ... passed`, zero failed.
**If it fails:** read the failing assertion; fix the TEST file to match this guide
exactly (never weaken an expectation), re-run once more, then STOP and report.

---

## Step 11: Server actions — top-ups (Razorpay + Stripe), plan change, add-ons, settings, reseller

**File `src/server/actions/billing.ts`** (full content — replaces the
guide-09-original version):

```ts
"use server";

import Razorpay from "razorpay";
import Stripe from "stripe";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { debitWallet } from "@/lib/billing";
import { getAddOn } from "@/lib/addons";
import { generateMonthlyInvoice } from "@/lib/invoice";

export type ActionResult = { ok: boolean; error?: string };
export type OrderResult = ActionResult & { orderId?: string; amountPaise?: number; keyId?: string };
export type StripeResult = ActionResult & { url?: string };

const TOPUP_AMOUNTS = [50000, 100000, 250000, 500000]; // ₹500 / ₹1,000 / ₹2,500 / ₹5,000

// ---------- Top-ups ----------

export async function createTopupOrderAction(amountPaise: number): Promise<OrderResult> {
  try {
    const ctx = await requirePermission("billing:write");
    if (!TOPUP_AMOUNTS.includes(amountPaise)) {
      return { ok: false, error: "Pick one of the preset top-up amounts." };
    }
    const rzp = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!,
      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    });
    const order = await rzp.orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt: `topup_${ctx.workspaceId.slice(-8)}_${Date.now()}`,
      notes: { workspaceId: ctx.workspaceId },
    });
    await db.paymentOrder.create({
      data: {
        workspaceId: ctx.workspaceId,
        provider: "RAZORPAY",
        providerOrderId: order.id,
        amountPaise,
        status: "created",
      },
    });
    return { ok: true, orderId: order.id, amountPaise, keyId: process.env.RAZORPAY_KEY_ID };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not create payment order. Check Razorpay keys." };
  }
}

export async function createStripeCheckoutAction(amountPaise: number): Promise<StripeResult> {
  try {
    const ctx = await requirePermission("billing:write");
    if (!TOPUP_AMOUNTS.includes(amountPaise)) {
      return { ok: false, error: "Pick one of the preset top-up amounts." };
    }
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key || key === "CHANGE_ME") {
      return { ok: false, error: "Stripe is not configured (STRIPE_SECRET_KEY)." };
    }
    const stripe = new Stripe(key);
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "inr",
            unit_amount: amountPaise,
            product_data: { name: "Vaani AI wallet top-up" },
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/billing?topup=success`,
      cancel_url: `${appUrl}/billing?topup=cancelled`,
      metadata: { workspaceId: ctx.workspaceId },
    });
    await db.paymentOrder.create({
      data: {
        workspaceId: ctx.workspaceId,
        provider: "STRIPE",
        providerSessionId: session.id,
        amountPaise,
        status: "created",
      },
    });
    if (!session.url) return { ok: false, error: "Stripe returned no checkout URL." };
    return { ok: true, url: session.url };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not create Stripe checkout session." };
  }
}

// ---------- Plan change (immediate switch, no proration — see guide header) ----------

const planChangeSchema = z.object({ planCode: z.enum(["starter", "growth", "enterprise"]) });

export async function changePlanAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("billing:write");
    const parsed = planChangeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Unknown plan." };
    const plan = await db.plan.findUnique({ where: { code: parsed.data.planCode } });
    if (!plan) return { ok: false, error: "Unknown plan." };
    const sub = await db.subscription.findUnique({
      where: { workspaceId: ctx.workspaceId },
      include: { plan: true },
    });
    if (sub?.planId === plan.id) return { ok: false, error: "You are already on this plan." };

    const isDowngrade = sub !== null && plan.monthlyPricePaise < sub.plan.monthlyPricePaise;
    await db.subscription.upsert({
      where: { workspaceId: ctx.workspaceId },
      update: { planId: plan.id, status: "active" },
      create: {
        workspaceId: ctx.workspaceId,
        planId: plan.id,
        status: "active",
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    if (!isDowngrade) {
      // Upgrade: charge the new plan's full month NOW from the wallet.
      await debitWallet({
        workspaceId: ctx.workspaceId,
        amountPaise: plan.monthlyPricePaise,
        type: "PLAN_FEE",
        note: `Plan: ${plan.name} (monthly, immediate upgrade)`,
      });
    }
    revalidatePath("/billing");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not change plan." };
  }
}

// ---------- Add-ons (proration-free: full month charged on purchase) ----------

const addOnSchema = z.object({ code: z.string().min(1) });

export async function purchaseAddOnAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("billing:write");
    const parsed = addOnSchema.safeParse(input);
    const def = parsed.success ? getAddOn(parsed.data.code) : undefined;
    if (!def) return { ok: false, error: "Unknown add-on." };
    const existing = await db.addOnPurchase.findUnique({
      where: { workspaceId_code: { workspaceId: ctx.workspaceId, code: def.code } },
    });
    if (existing?.active) return { ok: false, error: "Add-on already active." };
    await db.addOnPurchase.upsert({
      where: { workspaceId_code: { workspaceId: ctx.workspaceId, code: def.code } },
      update: { active: true, cancelledAt: null, monthlyPricePaise: def.monthlyPricePaise },
      create: {
        workspaceId: ctx.workspaceId,
        code: def.code,
        monthlyPricePaise: def.monthlyPricePaise,
      },
    });
    await debitWallet({
      workspaceId: ctx.workspaceId,
      amountPaise: def.monthlyPricePaise,
      type: "ADDON_DEBIT",
      reference: `addon-first-${ctx.workspaceId}-${def.code}-${Date.now()}`,
      note: `Add-on: ${def.name} (first month)`,
    });
    revalidatePath("/billing");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not purchase add-on." };
  }
}

export async function cancelAddOnAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("billing:write");
    const parsed = addOnSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Unknown add-on." };
    await db.addOnPurchase.updateMany({
      where: { workspaceId: ctx.workspaceId, code: parsed.data.code, active: true },
      data: { active: false, cancelledAt: new Date() },
    });
    revalidatePath("/billing");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not cancel add-on." };
  }
}

// ---------- Billing settings: GST profile, low-balance threshold, auto top-up ----------

const gstSchema = z.object({
  gstin: z
    .string()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Invalid GSTIN format")
    .or(z.literal("")),
  placeOfSupply: z.string().max(60),
  hsnSac: z.string().max(8),
});

export async function saveGstSettingsAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("billing:write");
    const parsed = gstSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid GST details." };
    }
    await db.workspace.update({
      where: { id: ctx.workspaceId },
      data: {
        billingGstin: parsed.data.gstin || null,
        billingPlaceOfSupply: parsed.data.placeOfSupply || null,
        billingHsnSac: parsed.data.hsnSac || null,
      },
    });
    revalidatePath("/billing");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not save GST settings." };
  }
}

const autoTopUpSchema = z.object({
  thresholdPaise: z.coerce.number().int().min(10000),
  amountPaise: z.coerce.number().int().min(50000),
  active: z.coerce.boolean(),
});

export async function saveAutoTopUpAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("billing:write");
    const parsed = autoTopUpSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Threshold ≥ ₹100, amount ≥ ₹500." };
    await db.autoTopUp.upsert({
      where: { workspaceId: ctx.workspaceId },
      update: { ...parsed.data },
      create: { workspaceId: ctx.workspaceId, ...parsed.data },
    });
    revalidatePath("/billing");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not save auto top-up." };
  }
}

const thresholdSchema = z.object({ lowBalanceAlertPaise: z.coerce.number().int().min(0) });

export async function saveLowBalanceThresholdAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("billing:write");
    const parsed = thresholdSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid threshold." };
    await db.wallet.update({
      where: { workspaceId: ctx.workspaceId },
      data: { lowBalanceAlertPaise: parsed.data.lowBalanceAlertPaise },
    });
    revalidatePath("/billing");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not save threshold." };
  }
}

// ---------- Manual invoice generation (current month) ----------

export async function generateInvoiceNowAction(): Promise<ActionResult & { invoiceNumber?: string }> {
  try {
    const ctx = await requirePermission("billing:write");
    const r = await generateMonthlyInvoice(ctx.workspaceId, new Date());
    if (!r) return { ok: false, error: "Nothing to invoice this month yet." };
    revalidatePath("/billing");
    return { ok: true, invoiceNumber: r.invoiceNumber };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not generate invoice." };
  }
}
```

**File `src/server/actions/reseller.ts`** (full content):

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { slugify } from "@/lib/provision";
import { provisionTrial } from "@/lib/trial";
import { checkFeatureGate } from "@/lib/feature-gates";
import { wholesaleRateCardSchema } from "@/lib/reseller";

export type ActionResult = { ok: boolean; error?: string };

async function requireReseller() {
  const ctx = await requirePermission("billing:write");
  const reseller = await db.resellerAccount.findUnique({
    where: { parentWorkspaceId: ctx.workspaceId },
  });
  if (!reseller || !reseller.active) {
    throw new Error("Reseller panel is not enabled for this workspace.");
  }
  return { ctx, reseller };
}

/**
 * Enable this workspace as a reseller/agency (spec §3.1 white-label, §10 reseller
 * panel). Requires the plan's `reseller_panel` feature gate (Enterprise) — the
 * commercial enablement of the gate itself is an operator decision.
 */
export async function enableResellerAction(): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("billing:write");
    const gate = await checkFeatureGate(ctx.workspaceId, "reseller_panel");
    if (!gate.allowed) {
      return { ok: false, error: "The reseller panel requires the Enterprise plan." };
    }
    await db.resellerAccount.upsert({
      where: { parentWorkspaceId: ctx.workspaceId },
      update: { active: true },
      create: { parentWorkspaceId: ctx.workspaceId },
    });
    revalidatePath("/reseller");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not enable reseller panel." };
  }
}

const childSchema = z.object({ name: z.string().min(2).max(80) });

/**
 * Create a child (sub-account) workspace under this reseller: workspace +
 * Workspace.resellerId link + starter subscription + wallet + trial. The current
 * user becomes OWNER of the child so the agency can operate it.
 */
export async function createChildWorkspaceAction(input: unknown): Promise<ActionResult> {
  try {
    const { ctx, reseller } = await requireReseller();
    const parsed = childSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Name must be 2–80 characters." };

    const starter = await db.plan.findUnique({ where: { code: "starter" } });
    const child = await db.$transaction(async (tx) => {
      const ws = await tx.workspace.create({
        data: { name: parsed.data.name, slug: slugify(parsed.data.name), resellerId: reseller.id },
      });
      await tx.membership.create({
        data: { userId: ctx.user.id, workspaceId: ws.id, role: "OWNER" },
      });
      if (starter) {
        await tx.subscription.create({
          data: {
            workspaceId: ws.id,
            planId: starter.id,
            status: "active",
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
      }
      await tx.wallet.create({ data: { workspaceId: ws.id, balancePaise: 0 } });
      return ws;
    });
    await provisionTrial(child.id);
    revalidatePath("/reseller");
    return { ok: true };
  } catch (e) {
    if (String(e).includes("not enabled")) return { ok: false, error: String(e) };
    console.error(e);
    return { ok: false, error: "Could not create child workspace." };
  }
}

/** Save the wholesale rate card JSON (what the reseller pays us per minute). */
export async function saveRateCardAction(input: unknown): Promise<ActionResult> {
  try {
    const { ctx, reseller } = await requireReseller();
    const parsed = wholesaleRateCardSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Rates must be non-negative integers (paise/min)." };
    await db.resellerAccount.update({
      where: { id: reseller.id },
      data: { wholesaleRateCard: parsed.data },
    });
    revalidatePath("/reseller");
    return { ok: true };
  } catch (e) {
    if (String(e).includes("not enabled")) return { ok: false, error: String(e) };
    console.error(e);
    return { ok: false, error: "Could not save rate card." };
  }
}
```

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** both exit 0.
**If it fails:** `workspaceId_code` unique-input error → Step 1 migration missing
`@@unique([workspaceId, code])` on AddOnPurchase; re-check the schema block.
`slugify` import error → guide 03's `src/lib/provision.ts` missing; confirm
`ls src/lib/provision.ts` — do NOT recreate it, report.

---

## Step 12: Razorpay webhook — verified crediting via PaymentOrder + GST receipt

Full rewrite (the guide-09-original keyed off `Invoice`; this keys off
`PaymentOrder` and creates the GST receipt invoice on success).

**File `src/app/api/webhooks/razorpay/route.ts`** (full content):

```ts
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { creditWallet } from "@/lib/billing";
import { gstInclusiveSplit, isInterState } from "@/lib/invoice";

/** Create the paid GST receipt invoice for a successful top-up. */
async function createTopupReceipt(args: {
  workspaceId: string;
  amountPaise: number;
  orderId: string;
  paymentId: string;
}) {
  const ws = await db.workspace.findUnique({ where: { id: args.workspaceId } });
  const interState = isInterState(
    ws?.billingPlaceOfSupply,
    process.env.BILLING_COMPANY_STATE_CODE ?? "29"
  );
  const gst = gstInclusiveSplit(args.amountPaise, interState);
  await db.invoice.create({
    data: {
      workspaceId: args.workspaceId,
      razorpayOrderId: args.orderId,
      amountPaise: gst.basePaise,
      gstPaise: gst.totalGstPaise,
      cgstPaise: gst.cgstPaise,
      sgstPaise: gst.sgstPaise,
      igstPaise: gst.igstPaise,
      gstin: ws?.billingGstin,
      placeOfSupply: ws?.billingPlaceOfSupply,
      hsnSac: ws?.billingHsnSac ?? "998314",
      status: "paid",
    },
  });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
  const sig = req.headers.get("x-razorpay-signature") ?? "";
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false, error: "bad signature" }, { status: 401 });
  }

  let body: {
    event?: string;
    payload?: { payment?: { entity?: { id?: string; order_id?: string; status?: string } } };
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (body.event !== "payment.captured") {
    return NextResponse.json({ ok: true, ignored: body.event });
  }

  const payment = body.payload?.payment?.entity;
  const orderId = payment?.order_id;
  const paymentId = payment?.id;
  if (!orderId || !paymentId) return NextResponse.json({ ok: true, ignored: "no ids" });

  const order = await db.paymentOrder.findFirst({ where: { providerOrderId: orderId } });
  if (!order) return NextResponse.json({ ok: true, ignored: "unknown order" });
  if (order.status === "paid") return NextResponse.json({ ok: true, already: true });

  try {
    await db.paymentOrder.update({ where: { id: order.id }, data: { status: "paid" } });
    await creditWallet({
      workspaceId: order.workspaceId,
      amountPaise: order.amountPaise,
      type: "TOPUP",
      reference: paymentId,
      note: `Razorpay top-up ${paymentId}`,
    });
    await createTopupReceipt({
      workspaceId: order.workspaceId,
      amountPaise: order.amountPaise,
      orderId,
      paymentId,
    });
  } catch (e) {
    if (String(e).includes("Unique constraint")) {
      return NextResponse.json({ ok: true, already: true }); // duplicate delivery
    }
    console.error(e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

**Operator action (Razorpay dashboard):** Settings → Webhooks → add webhook URL
`https://<your-domain>/api/webhooks/razorpay` (after guide 12; the Step 16
simulation covers local testing) with secret = `RAZORPAY_WEBHOOK_SECRET` from
`.env`, event `payment.captured`.

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 13: Stripe webhook — `checkout.session.completed` with signature verify + idempotency

**File `src/app/api/webhooks/stripe/route.ts`** (full content):

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { creditWallet } from "@/lib/billing";
import { verifyStripeSignature } from "@/lib/stripe-sig";
import { gstInclusiveSplit, isInterState } from "@/lib/invoice";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  const sig = req.headers.get("stripe-signature") ?? "";
  if (!verifyStripeSignature(raw, sig, secret)) {
    return NextResponse.json({ ok: false, error: "bad signature" }, { status: 401 });
  }

  let body: {
    type?: string;
    data?: { object?: { id?: string; payment_intent?: string | null; metadata?: { workspaceId?: string } } };
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (body.type !== "checkout.session.completed") {
    return NextResponse.json({ ok: true, ignored: body.type });
  }

  const session = body.data?.object;
  const sessionId = session?.id;
  if (!sessionId) return NextResponse.json({ ok: true, ignored: "no session id" });

  const order = await db.paymentOrder.findFirst({
    where: { providerSessionId: sessionId, provider: "STRIPE" },
  });
  if (!order) return NextResponse.json({ ok: true, ignored: "unknown session" });
  if (order.status === "paid") return NextResponse.json({ ok: true, already: true });

  const paymentIntent = session?.payment_intent ?? null;
  try {
    await db.paymentOrder.update({
      where: { id: order.id },
      data: { status: "paid", providerOrderId: paymentIntent },
    });
    await creditWallet({
      workspaceId: order.workspaceId,
      amountPaise: order.amountPaise,
      type: "TOPUP",
      reference: paymentIntent ?? sessionId,
      note: `Stripe top-up ${sessionId}`,
    });
    const ws = await db.workspace.findUnique({ where: { id: order.workspaceId } });
    const interState = isInterState(
      ws?.billingPlaceOfSupply,
      process.env.BILLING_COMPANY_STATE_CODE ?? "29"
    );
    const gst = gstInclusiveSplit(order.amountPaise, interState);
    await db.invoice.create({
      data: {
        workspaceId: order.workspaceId,
        amountPaise: gst.basePaise,
        gstPaise: gst.totalGstPaise,
        cgstPaise: gst.cgstPaise,
        sgstPaise: gst.sgstPaise,
        igstPaise: gst.igstPaise,
        gstin: ws?.billingGstin,
        placeOfSupply: ws?.billingPlaceOfSupply,
        hsnSac: ws?.billingHsnSac ?? "998314",
        status: "paid",
      },
    });
  } catch (e) {
    if (String(e).includes("Unique constraint")) {
      return NextResponse.json({ ok: true, already: true });
    }
    console.error(e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

**Operator action (Stripe dashboard, TEST mode):** Developers → Webhooks → add
endpoint `https://<your-domain>/api/webhooks/stripe` (after guide 12; locally use
`stripe listen --forward-to localhost:3000/api/webhooks/stripe`), event
`checkout.session.completed`; copy the signing secret (`whsec_...`) into
`STRIPE_WEBHOOK_SECRET`.

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** both exit 0; `/api/webhooks/stripe` in the route table.

---

## Step 14: Billing UI — overview, top-up tabs, plans, add-ons, settings, invoice view, reseller panel

**File `src/app/(app)/billing/page.tsx`** (full content — replaces the
guide-09-original):

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/money";
import { financialYearTag } from "@/lib/invoice";
import { trialMinutesRemaining } from "@/lib/trial";
import { generateInvoiceNowAction } from "@/server/actions/billing";
import { TopupButtons } from "./topup";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const [wallet, subscription, transactions, invoices, rentals, trial, addOns] = await Promise.all([
    db.wallet.findUnique({ where: { workspaceId: ctx.workspaceId } }),
    db.subscription.findUnique({ where: { workspaceId: ctx.workspaceId }, include: { plan: true } }),
    db.walletTransaction.findMany({
      where: { wallet: { workspaceId: ctx.workspaceId } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.invoice.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.numberRental.findMany({
      where: { workspaceId: ctx.workspaceId, status: "ACTIVE" },
      include: { phoneNumber: { select: { number: true, label: true } } },
    }),
    db.trialState.findUnique({ where: { workspaceId: ctx.workspaceId } }),
    db.addOnPurchase.findMany({ where: { workspaceId: ctx.workspaceId, active: true } }),
  ]);

  const balance = wallet?.balancePaise ?? 0;
  const lowThreshold = wallet?.lowBalanceAlertPaise ?? 50000;
  const trialRemaining = trial ? trialMinutesRemaining(trial, new Date()) : 0;

  async function generateInvoice() {
    "use server";
    await generateInvoiceNowAction();
  }

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Billing</h1>

      {trial && trialRemaining > 0 && (
        <div data-testid="trial-banner" className="rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
          Free trial: <strong>{trialRemaining} minute{trialRemaining === 1 ? "" : "s"}</strong> remaining
          {trial.expiresAt ? ` · expires ${trial.expiresAt.toLocaleDateString("en-IN")}` : ""}.
          Top up below to keep calling after the trial.
        </div>
      )}
      {balance < lowThreshold && (
        <div data-testid="low-balance-banner" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          Your wallet balance is below the alert threshold ({formatINR(lowThreshold)}). Top up now to avoid interruption.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Wallet balance</CardTitle></CardHeader>
          <CardContent>
            <p data-testid="wallet-balance" className="text-4xl font-bold text-primary">{formatINR(balance)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Low-balance alert at {formatINR(lowThreshold)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Plan</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{subscription?.plan.name ?? "—"}</p>
            <p className="text-sm text-muted-foreground">
              {subscription ? `${formatINR(subscription.plan.monthlyPricePaise)}/mo · ` : ""}
              {subscription?.plan.includedMinutes ?? 0} included min · {subscription?.plan.concurrentLines ?? 1} lines ·{" "}
              {subscription?.plan.markupPercent ?? 40}% usage rate
            </p>
            <div className="mt-3 flex gap-2">
              <Link href="/billing/plans"><Button data-testid="plans-link" variant="outline" size="sm">View plans</Button></Link>
              <Link href="/billing/addons"><Button data-testid="addons-link" variant="outline" size="sm">Add-ons ({addOns.length})</Button></Link>
              <Link href="/billing/settings"><Button data-testid="billing-settings-link" variant="outline" size="sm">Settings</Button></Link>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Top up wallet</CardTitle></CardHeader>
        <CardContent>
          <TopupButtons />
          <p className="mt-2 text-xs text-muted-foreground">
            TEST mode only — Razorpay card 4111 1111 1111 1111 (any future expiry/CVV); Stripe card 4242 4242 4242 4242.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Transactions (latest 50)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table data-testid="transaction-table" className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">When</th><th className="p-3">Type</th>
                <th className="p-3">Amount</th><th className="p-3">Balance after</th><th className="p-3">Note</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="p-3 text-muted-foreground whitespace-nowrap">
                    {t.createdAt.toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                  </td>
                  <td className="p-3">{t.type}</td>
                  <td className={`p-3 font-semibold ${t.amountPaise >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {t.amountPaise >= 0 ? "+" : ""}{formatINR(t.amountPaise)}
                  </td>
                  <td className="p-3">{formatINR(t.balanceAfterPaise)}</td>
                  <td className="max-w-64 truncate p-3 text-muted-foreground">{t.note ?? t.reference ?? "—"}</td>
                </tr>
              ))}
              {transactions.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No transactions yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Number rentals (monthly)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table data-testid="rental-table" className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Number</th><th className="p-3">Label</th><th className="p-3">Monthly rent</th><th className="p-3">Since</th>
              </tr>
            </thead>
            <tbody>
              {rentals.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="p-3 font-mono">{r.phoneNumber.number}</td>
                  <td className="p-3 text-muted-foreground">{r.phoneNumber.label ?? "—"}</td>
                  <td className="p-3">{formatINR(r.monthlyPricePaise)}</td>
                  <td className="p-3 text-muted-foreground">{r.startedAt.toLocaleDateString("en-IN")}</td>
                </tr>
              ))}
              {rentals.length === 0 && (
                <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No rented numbers.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Invoices</CardTitle>
            <form action={generateInvoice}>
              <Button data-testid="invoice-generate-button" size="sm" variant="outline">Generate this month&apos;s invoice</Button>
            </form>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table data-testid="invoice-table" className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">When</th><th className="p-3">Taxable</th><th className="p-3">GST</th>
                <th className="p-3">Total</th><th className="p-3">Status</th><th className="p-3">View</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-b last:border-0">
                  <td className="p-3 text-muted-foreground">{i.createdAt.toLocaleDateString("en-IN")}</td>
                  <td className="p-3">{formatINR(i.amountPaise)}</td>
                  <td className="p-3">{formatINR(i.gstPaise)}</td>
                  <td className="p-3 font-semibold">{formatINR(i.amountPaise + i.gstPaise)}</td>
                  <td className={`p-3 ${i.status === "paid" ? "text-green-400" : i.status === "failed" ? "text-red-400" : "text-yellow-400"}`}>
                    {i.status}
                  </td>
                  <td className="p-3">
                    <Link data-testid={`invoice-download-${i.id}`} href={`/billing/invoices/${i.id}`} className="text-primary underline">
                      View / PDF
                    </Link>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No invoices yet.</td></tr>
              )}
            </tbody>
          </table>
          <p className="p-3 text-xs text-muted-foreground">
            Invoice numbers run per financial year: VAANI/{financialYearTag(new Date())}/NNNN.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

**File `src/app/(app)/billing/topup.tsx`** (client component — Razorpay + Stripe
tabs, full content):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createTopupOrderAction, createStripeCheckoutAction } from "@/server/actions/billing";
import { Button } from "@/components/ui/button";

declare global {
  interface Window { Razorpay?: new (opts: Record<string, unknown>) => { open: () => void } }
}

const AMOUNTS = [
  { paise: 50000, label: "₹500" },
  { paise: 100000, label: "₹1,000" },
  { paise: 250000, label: "₹2,500" },
  { paise: 500000, label: "₹5,000" },
];

export function TopupButtons() {
  const router = useRouter();
  const [provider, setProvider] = useState<"razorpay" | "stripe">("razorpay");
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function payRazorpay(amountPaise: number) {
    setBusy(amountPaise); setError(null);
    const res = await createTopupOrderAction(amountPaise);
    if (!res.ok || !res.orderId) { setBusy(null); return setError(res.error ?? "Failed."); }
    if (!window.Razorpay) {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://checkout.razorpay.com/v1/checkout.js";
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("checkout.js failed to load"));
        document.body.appendChild(s);
      }).catch((e) => { setBusy(null); return setError(String(e)); });
    }
    const rzp = new window.Razorpay!({
      key: res.keyId,
      amount: res.amountPaise,
      currency: "INR",
      name: "Vaani AI",
      description: "Wallet top-up",
      order_id: res.orderId,
      theme: { color: "#2dd4bf" },
      handler: () => { setTimeout(() => { setBusy(null); router.refresh(); }, 2000); },
      modal: { ondismiss: () => setBusy(null) },
    });
    rzp.open();
  }

  async function payStripe(amountPaise: number) {
    setBusy(amountPaise); setError(null);
    const res = await createStripeCheckoutAction(amountPaise);
    if (!res.ok || !res.url) { setBusy(null); return setError(res.error ?? "Failed."); }
    window.location.href = res.url; // Stripe-hosted checkout; webhook credits the wallet.
  }

  return (
    <div data-testid="topup-dialog">
      <div className="mb-3 flex gap-2">
        <Button
          data-testid="topup-tab-razorpay"
          variant={provider === "razorpay" ? "default" : "outline"}
          size="sm"
          onClick={() => setProvider("razorpay")}
        >
          Razorpay (UPI/cards, INR)
        </Button>
        <Button
          data-testid="topup-tab-stripe"
          variant={provider === "stripe" ? "default" : "outline"}
          size="sm"
          onClick={() => setProvider("stripe")}
        >
          Stripe (international cards)
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {AMOUNTS.map((a) => (
          <Button
            key={a.paise}
            data-testid={provider === "razorpay" ? `topup-amount-${a.paise}` : `stripe-topup-amount-${a.paise}`}
            variant="outline"
            disabled={busy !== null}
            onClick={() => (provider === "razorpay" ? payRazorpay(a.paise) : payStripe(a.paise))}
          >
            {busy === a.paise ? "Opening…" : `+ ${a.label}`}
          </Button>
        ))}
      </div>
      {error && <p data-testid="topup-error" className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
```

**File `src/app/(app)/billing/plans/page.tsx`** (full content):

```tsx
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/money";
import { changePlanAction } from "@/server/actions/billing";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const [plans, sub, addOns] = await Promise.all([
    db.plan.findMany({ orderBy: { monthlyPricePaise: "asc" } }),
    db.subscription.findUnique({ where: { workspaceId: ctx.workspaceId }, include: { plan: true } }),
    db.addOnPurchase.findMany({ where: { workspaceId: ctx.workspaceId, active: true } }),
  ]);

  async function change(formData: FormData) {
    "use server";
    await changePlanAction({ planCode: String(formData.get("planCode")) });
  }

  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="text-2xl font-bold">Plans</h1>
      <p className="text-sm text-muted-foreground">
        Switching is immediate. Upgrades charge the new plan&apos;s full month from your wallet now;
        downgrades apply the lower price from the next monthly charge. No proration, no refunds.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const current = sub?.planId === p.id;
          const gates = (
            p.featureGates && typeof p.featureGates === "object" && !Array.isArray(p.featureGates)
              ? p.featureGates
              : {}
          ) as Record<string, unknown>;
          return (
            <Card key={p.id} data-testid={`plan-card-${p.code}`} className={current ? "border-primary" : ""}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {p.name}
                  {current && <span data-testid="plan-current-badge" className="text-xs text-primary">CURRENT</span>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-3xl font-bold">{formatINR(p.monthlyPricePaise)}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  <li>{p.includedMinutes} included minutes</li>
                  <li>{p.maxAgents} agents · {p.maxSeats} seats</li>
                  <li>{p.concurrentLines} concurrent lines</li>
                  <li>{p.markupPercent}% usage rate</li>
                  <li>{p.premiumVoices ? "✓" : "✗"} premium voices · {p.whiteLabel ? "✓" : "✗"} white-label · {p.dedicatedInfra ? "✓" : "✗"} dedicated infra</li>
                  {Object.keys(gates).length > 0 && (
                    <li>Gates: {Object.entries(gates).map(([k, v]) => `${k}:${v ? "✓" : "✗"}`).join(" ")}</li>
                  )}
                </ul>
                {!current && (
                  <form action={change}>
                    <input type="hidden" name="planCode" value={p.code} />
                    <Button data-testid={`plan-upgrade-${p.code}`} className="w-full">
                      {sub && p.monthlyPricePaise < sub.plan.monthlyPricePaise ? "Downgrade" : "Upgrade"} to {p.name}
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Active add-ons: {addOns.length === 0 ? "none" : addOns.map((a) => a.code).join(", ")} — manage them under Billing → Add-ons.
      </p>
    </div>
  );
}
```

**File `src/app/(app)/billing/addons/page.tsx`** (full content):

```tsx
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/money";
import { ADDON_CATALOG } from "@/lib/addons";
import { purchaseAddOnAction, cancelAddOnAction } from "@/server/actions/billing";

export const dynamic = "force-dynamic";

export default async function AddOnsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const purchases = await db.addOnPurchase.findMany({
    where: { workspaceId: ctx.workspaceId, active: true },
  });
  const active = new Set(purchases.map((p) => p.code));

  async function buy(formData: FormData) {
    "use server";
    await purchaseAddOnAction({ code: String(formData.get("code")) });
  }
  async function cancel(formData: FormData) {
    "use server";
    await cancelAddOnAction({ code: String(formData.get("code")) });
  }

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Add-ons</h1>
      <p className="text-sm text-muted-foreground">
        Charged in full for the current month on purchase, then monthly by the billing cron. Cancel anytime — the add-on stays active until the next monthly charge would have run.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {ADDON_CATALOG.map((a) => (
          <Card key={a.code} data-testid={`addon-card-${a.code}`}>
            <CardHeader><CardTitle className="text-base">{a.name}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{a.description}</p>
              <p className="text-2xl font-bold">{formatINR(a.monthlyPricePaise)}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
              {active.has(a.code) ? (
                <form action={cancel}>
                  <input type="hidden" name="code" value={a.code} />
                  <Button data-testid={`addon-cancel-${a.code}`} variant="outline" className="w-full">Active — cancel</Button>
                </form>
              ) : (
                <form action={buy}>
                  <input type="hidden" name="code" value={a.code} />
                  <Button data-testid={`addon-buy-${a.code}`} className="w-full">Buy add-on</Button>
                </form>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

**File `src/app/(app)/billing/settings/page.tsx`** (full content):

```tsx
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  saveGstSettingsAction,
  saveAutoTopUpAction,
  saveLowBalanceThresholdAction,
} from "@/server/actions/billing";

export const dynamic = "force-dynamic";

export default async function BillingSettingsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const [ws, wallet, autoTopUp] = await Promise.all([
    db.workspace.findUnique({ where: { id: ctx.workspaceId } }),
    db.wallet.findUnique({ where: { workspaceId: ctx.workspaceId } }),
    db.autoTopUp.findUnique({ where: { workspaceId: ctx.workspaceId } }),
  ]);

  async function saveGst(formData: FormData) {
    "use server";
    await saveGstSettingsAction({
      gstin: String(formData.get("gstin") ?? ""),
      placeOfSupply: String(formData.get("placeOfSupply") ?? ""),
      hsnSac: String(formData.get("hsnSac") ?? ""),
    });
  }
  async function saveThreshold(formData: FormData) {
    "use server";
    await saveLowBalanceThresholdAction({ lowBalanceAlertPaise: Number(formData.get("threshold") ?? 0) * 100 });
  }
  async function saveAutoTopUp(formData: FormData) {
    "use server";
    await saveAutoTopUpAction({
      thresholdPaise: Number(formData.get("threshold") ?? 0) * 100,
      amountPaise: Number(formData.get("amount") ?? 0) * 100,
      active: formData.get("active") === "on",
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Billing settings</h1>

      <Card>
        <CardHeader><CardTitle>GST details (printed on invoices)</CardTitle></CardHeader>
        <CardContent>
          <form data-testid="gst-settings-form" action={saveGst} className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">GSTIN (B2B customers; leave blank for B2C)</label>
              <Input data-testid="gstin-input" name="gstin" defaultValue={ws?.billingGstin ?? ""} placeholder="29AAAAA0000A1Z5" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Place of supply — &quot;State (code)&quot;</label>
              <Input data-testid="place-of-supply-input" name="placeOfSupply" defaultValue={ws?.billingPlaceOfSupply ?? ""} placeholder="Karnataka (29)" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">HSN/SAC</label>
              <Input data-testid="hsn-sac-input" name="hsnSac" defaultValue={ws?.billingHsnSac ?? "998314"} placeholder="998314" />
            </div>
            <Button data-testid="gst-settings-save">Save GST details</Button>
            <p className="text-xs text-muted-foreground">
              A state code different from the company state ({process.env.BILLING_COMPANY_STATE_CODE ?? "29"}) makes invoices IGST; same state → CGST+SGST.
            </p>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Low-balance alert</CardTitle></CardHeader>
        <CardContent>
          <form data-testid="threshold-form" action={saveThreshold} className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Alert when balance falls below (₹)</label>
              <Input data-testid="threshold-input" name="threshold" type="number" min={0} defaultValue={Math.round((wallet?.lowBalanceAlertPaise ?? 50000) / 100)} />
            </div>
            <Button data-testid="threshold-save" variant="outline">Save</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Auto top-up</CardTitle></CardHeader>
        <CardContent>
          <form data-testid="autotopup-form" action={saveAutoTopUp} className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Trigger when balance below (₹, min 100)</label>
              <Input data-testid="autotopup-threshold-input" name="threshold" type="number" min={100} defaultValue={Math.round((autoTopUp?.thresholdPaise ?? 50000) / 100)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Top-up amount (₹, min 500)</label>
              <Input data-testid="autotopup-amount-input" name="amount" type="number" min={500} defaultValue={Math.round((autoTopUp?.amountPaise ?? 100000) / 100)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input data-testid="autotopup-toggle" type="checkbox" name="active" defaultChecked={autoTopUp?.active ?? false} className="h-4 w-4" />
              Enable auto top-up
            </label>
            <Button data-testid="autotopup-save">Save auto top-up</Button>
            <p className="text-xs text-muted-foreground">
              Charging a saved card runs in dry-run mode until Razorpay tokenization is enabled on the account (operator task) and AUTOTOPUP_ENABLED=true.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

**File `src/app/(app)/billing/invoices/[id]/page.tsx`** (full content —
print-friendly invoice; browser Print → Save as PDF):

```tsx
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { formatINR } from "@/lib/money";
import { PrintButton } from "./print";

export const dynamic = "force-dynamic";

export default async function InvoicePage({ params }: { params: { id: string } }) {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  // Tenant scoping: an invoice id from another workspace must 404, never leak.
  const invoice = await db.invoice.findFirst({
    where: { id: params.id, workspaceId: ctx.workspaceId },
  });
  if (!invoice) notFound();
  const ws = await db.workspace.findUnique({ where: { id: ctx.workspaceId } });

  const total = invoice.amountPaise + invoice.gstPaise;
  const igst = invoice.igstPaise > 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4 rounded-lg bg-white p-8 text-black print:p-0">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tax Invoice</h1>
          <p className="text-sm text-gray-600">
            {invoice.createdAt.toLocaleDateString("en-IN")} · HSN/SAC {invoice.hsnSac ?? "998314"}
          </p>
        </div>
        <PrintButton />
      </div>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="font-semibold">From</p>
          <p>{process.env.BILLING_COMPANY_NAME ?? "Vaani AI"}</p>
          <p>GSTIN: {process.env.BILLING_COMPANY_GSTIN ?? "—"}</p>
        </div>
        <div>
          <p className="font-semibold">Billed to</p>
          <p>{ws?.name}</p>
          {invoice.gstin && <p>GSTIN: {invoice.gstin}</p>}
          <p>Place of supply: {invoice.placeOfSupply ?? "—"}</p>
        </div>
      </div>
      <table className="w-full border-collapse text-sm">
        <tbody>
          <tr className="border"><td className="p-2">Taxable value</td><td className="p-2 text-right">{formatINR(invoice.amountPaise)}</td></tr>
          {igst ? (
            <tr className="border"><td className="p-2">IGST @18%</td><td className="p-2 text-right">{formatINR(invoice.igstPaise)}</td></tr>
          ) : (
            <>
              <tr className="border"><td className="p-2">CGST @9%</td><td className="p-2 text-right">{formatINR(invoice.cgstPaise)}</td></tr>
              <tr className="border"><td className="p-2">SGST @9%</td><td className="p-2 text-right">{formatINR(invoice.sgstPaise)}</td></tr>
            </>
          )}
          <tr className="border font-bold"><td className="p-2">Total (GST-inclusive)</td><td className="p-2 text-right">{formatINR(total)}</td></tr>
        </tbody>
      </table>
      <p className="text-xs text-gray-500">
        Computer-generated invoice. Status: {invoice.status}.
        {invoice.pdfKey ? " Archived copy stored." : ""}
      </p>
    </div>
  );
}
```

**File `src/app/(app)/billing/invoices/[id]/print.tsx`** (client component):

```tsx
"use client";

import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button data-testid="invoice-print-button" variant="outline" onClick={() => window.print()}>
      Print / Save as PDF
    </Button>
  );
}
```

**File `src/app/(app)/reseller/page.tsx`** (full content):

```tsx
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatINR } from "@/lib/money";
import { childUsageRollup } from "@/lib/reseller";
import {
  enableResellerAction,
  createChildWorkspaceAction,
  saveRateCardAction,
} from "@/server/actions/reseller";

export const dynamic = "force-dynamic";

export default async function ResellerPage() {
  let ctx;
  try { ctx = await requirePermission("billing:read"); } catch { redirect("/login"); }

  const reseller = await db.resellerAccount.findUnique({
    where: { parentWorkspaceId: ctx.workspaceId },
    include: { children: { select: { id: true, name: true, slug: true, createdAt: true } } },
  });

  async function enable() {
    "use server";
    await enableResellerAction();
  }
  async function createChild(formData: FormData) {
    "use server";
    await createChildWorkspaceAction({ name: String(formData.get("name") ?? "") });
  }
  async function saveRateCard(formData: FormData) {
    "use server";
    await saveRateCardAction({
      telephonyPerMinPaise: Number(formData.get("telephony") || 0),
      sttPerMinPaise: Number(formData.get("stt") || 0),
      llmPerMinPaise: Number(formData.get("llm") || 0),
      ttsPerMinPaise: Number(formData.get("tts") || 0),
    });
  }

  if (!reseller) {
    return (
      <div className="max-w-xl space-y-6">
        <h1 className="text-2xl font-bold">Reseller / Agency panel</h1>
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="text-sm text-muted-foreground">
              Resell Vaani AI under your own brand: provision child workspaces, set wholesale
              rates, and track per-customer revenue and margin. Requires the Enterprise plan
              (reseller_panel gate).
            </p>
            <form action={enable}>
              <Button data-testid="reseller-enable-button">Enable reseller panel</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rollup = await childUsageRollup(ctx.workspaceId, since);
  const rc = (reseller.wholesaleRateCard ?? {}) as Record<string, number>;

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Reseller / Agency panel</h1>

      <Card>
        <CardHeader><CardTitle>Create child workspace (sub-account)</CardTitle></CardHeader>
        <CardContent>
          <form data-testid="reseller-create-child-form" action={createChild} className="flex gap-2">
            <Input data-testid="reseller-child-name-input" name="name" placeholder="Customer business name" required />
            <Button data-testid="reseller-create-child-submit">Create</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Wholesale rate card (paise/min — what you pay us)</CardTitle></CardHeader>
        <CardContent>
          <form data-testid="ratecard-editor" action={saveRateCard} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div>
              <label className="text-xs text-muted-foreground">Telephony</label>
              <Input data-testid="ratecard-telephony" name="telephony" type="number" min={0} defaultValue={rc.telephonyPerMinPaise ?? 30} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">STT</label>
              <Input data-testid="ratecard-stt" name="stt" type="number" min={0} defaultValue={rc.sttPerMinPaise ?? 18} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">LLM</label>
              <Input data-testid="ratecard-llm" name="llm" type="number" min={0} defaultValue={rc.llmPerMinPaise ?? 12} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">TTS</label>
              <Input data-testid="ratecard-tts" name="tts" type="number" min={0} defaultValue={rc.ttsPerMinPaise ?? 24} />
            </div>
            <div className="flex items-end">
              <Button data-testid="ratecard-save" className="w-full">Save</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Child workspaces</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table data-testid="reseller-child-table" className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Name</th><th className="p-3">Slug</th><th className="p-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {reseller.children.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="p-3">{c.name}</td>
                  <td className="p-3 font-mono text-xs">{c.slug}</td>
                  <td className="p-3 text-muted-foreground">{c.createdAt.toLocaleDateString("en-IN")}</td>
                </tr>
              ))}
              {reseller.children.length === 0 && (
                <tr><td colSpan={3} className="p-6 text-center text-muted-foreground">No child workspaces yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Revenue report (last 30 days, wholesale vs retail)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table data-testid="reseller-revenue-table" className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Child</th><th className="p-3">Calls</th><th className="p-3">Minutes</th>
                <th className="p-3">Revenue (retail)</th><th className="p-3">Cost (wholesale)</th><th className="p-3">Margin</th>
              </tr>
            </thead>
            <tbody>
              {rollup.map((r) => (
                <tr key={r.workspaceId} className="border-b last:border-0">
                  <td className="p-3">{r.name}</td>
                  <td className="p-3">{r.totalCalls}</td>
                  <td className="p-3">{r.totalMinutes}</td>
                  <td className="p-3">{formatINR(r.revenuePaise)}</td>
                  <td className="p-3">{formatINR(r.costPaise)}</td>
                  <td className={`p-3 font-semibold ${r.marginPaise >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {formatINR(r.marginPaise)}
                  </td>
                </tr>
              ))}
              {rollup.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No child usage yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Nav patch** — add the reseller link. Edit `src/app/(app)/layout.tsx`: in the
`NAV` array, directly after the line `{ href: "/billing", label: "Billing", icon: Wallet },`
add:

```tsx
  { href: "/reseller", label: "Reseller", icon: HandCoins },
```

and add `HandCoins` to the `lucide-react` import list (the same import statement
guide 06 extended — append it at the end of the name list). If the exact anchor
line differs, make the minimal equivalent change and note the deviation.

**Verify:**
```bash
grep -c '"/reseller"' "src/app/(app)/layout.tsx"
npm run typecheck && npm run build
```
**Expected:** `1`; both exit 0; route table includes `/billing`, `/billing/plans`,
`/billing/addons`, `/billing/settings`, `/billing/invoices/[id]`, `/reseller`.
**If it fails:** the compiler names the file — fix against the listings; once more,
then STOP and report.

---

## Step 15: Worker cron — monthly rentals / add-ons / plan fees / invoices + auto-top-up sweep

All recurring debits are idempotent via fixed ledger references (`<kind>-<id>-<yyyymm>`):
a re-run in the same month is a no-op, so cron overlap and restarts can never
double-charge.

**File `src/worker/billing.ts`** (full content — cron functions AND a CLI used by
the Step 16 tests):

```ts
/**
 * Billing cron (worker process) + CLI:
 *   tsx src/worker/billing.ts rentals|addons|planfees|autotopup|invoices [--dry-run]
 *   tsx src/worker/billing.ts invoice <workspaceSlug>     # current month, one workspace
 *   tsx src/worker/billing.ts rollup <parentSlug>         # reseller rollup JSON (30d)
 * Schedules live in src/worker/index.ts (monthly 1st 03:15/04:30; sweep every 15 min).
 */
import { db } from "../lib/db";
import { debitWallet } from "../lib/billing";
import { runAutoTopUpSweep } from "../lib/autotopup";
import { generateMonthlyInvoice } from "../lib/invoice";
import { childUsageRollup } from "../lib/reseller";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

/** "202601" for Jan 2026 — idempotency key component for monthly charges. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Monthly DID rental passthrough with margin (spec §10). */
export async function chargeMonthlyRentals(now = new Date(), dryRun = false): Promise<number> {
  const rentals = await db.numberRental.findMany({
    where: { status: "ACTIVE" },
    include: { phoneNumber: { select: { number: true, monthlyRentPaise: true } } },
  });
  let charged = 0;
  for (const r of rentals) {
    const amount = r.monthlyPricePaise > 0 ? r.monthlyPricePaise : r.phoneNumber.monthlyRentPaise;
    if (amount <= 0) continue;
    const ref = `rent-${r.id}-${monthKey(now)}`;
    if (dryRun) {
      log(`[dry-run] would debit ${amount} paise from workspace ${r.workspaceId} (${ref})`);
      charged++;
      continue;
    }
    const res = await debitWallet({
      workspaceId: r.workspaceId,
      amountPaise: amount,
      type: "NUMBER_RENT",
      reference: ref,
      note: `Number rental ${r.phoneNumber.number} (${monthKey(now)})`,
    });
    if (!res.skipped) charged++;
  }
  log(`[billing] rentals ${dryRun ? "dry-run" : "charged"}: ${charged}`);
  return charged;
}

/** Monthly recurring add-on fees (spec §10). */
export async function chargeMonthlyAddOns(now = new Date(), dryRun = false): Promise<number> {
  const purchases = await db.addOnPurchase.findMany({ where: { active: true } });
  let charged = 0;
  for (const p of purchases) {
    const ref = `addon-${p.id}-${monthKey(now)}`;
    if (dryRun) {
      log(`[dry-run] would debit ${p.monthlyPricePaise} paise (${ref})`);
      charged++;
      continue;
    }
    const res = await debitWallet({
      workspaceId: p.workspaceId,
      amountPaise: p.monthlyPricePaise,
      type: "ADDON_DEBIT",
      reference: ref,
      note: `Add-on ${p.code} (${monthKey(now)})`,
    });
    if (!res.skipped) charged++;
  }
  log(`[billing] add-ons ${dryRun ? "dry-run" : "charged"}: ${charged}`);
  return charged;
}

/** Monthly subscription plan fees for active subscriptions. */
export async function chargeMonthlyPlanFees(now = new Date(), dryRun = false): Promise<number> {
  const subs = await db.subscription.findMany({
    where: { status: "active" },
    include: { plan: true },
  });
  let charged = 0;
  for (const s of subs) {
    if (s.plan.monthlyPricePaise <= 0) continue;
    const ref = `plan-${s.id}-${monthKey(now)}`;
    if (dryRun) {
      log(`[dry-run] would debit ${s.plan.monthlyPricePaise} paise (${ref})`);
      charged++;
      continue;
    }
    const res = await debitWallet({
      workspaceId: s.workspaceId,
      amountPaise: s.plan.monthlyPricePaise,
      type: "PLAN_FEE",
      reference: ref,
      note: `Plan: ${s.plan.name} (${monthKey(now)})`,
    });
    if (!res.skipped) charged++;
  }
  log(`[billing] plan fees ${dryRun ? "dry-run" : "charged"}: ${charged}`);
  return charged;
}

/** Generate last month's GST invoice for every workspace that has debits. */
export async function generateAllMonthlyInvoices(now = new Date()): Promise<number> {
  const month = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const workspaces = await db.workspace.findMany({ select: { id: true } });
  let made = 0;
  for (const ws of workspaces) {
    const r = await generateMonthlyInvoice(ws.id, month);
    if (r) {
      made++;
      log(`[billing] invoice ${r.invoiceNumber} for workspace ${ws.id}`);
    }
  }
  log(`[billing] monthly invoices generated: ${made}`);
  return made;
}

// ---------- CLI (used by guide 09 Step 16 tests and by operators) ----------

async function cli() {
  const [cmd, ...args] = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((a) => a !== "--dry-run");
  try {
    if (cmd === "rentals") await chargeMonthlyRentals(new Date(), dryRun);
    else if (cmd === "addons") await chargeMonthlyAddOns(new Date(), dryRun);
    else if (cmd === "planfees") await chargeMonthlyPlanFees(new Date(), dryRun);
    else if (cmd === "autotopup") await runAutoTopUpSweep();
    else if (cmd === "invoices") await generateAllMonthlyInvoices();
    else if (cmd === "invoice") {
      const ws = await db.workspace.findUnique({ where: { slug: positional[0] } });
      if (!ws) throw new Error(`no workspace with slug ${positional[0]}`);
      const r = await generateMonthlyInvoice(ws.id, new Date());
      console.log(JSON.stringify(r));
    } else if (cmd === "rollup") {
      const ws = await db.workspace.findUnique({ where: { slug: positional[0] } });
      if (!ws) throw new Error(`no workspace with slug ${positional[0]}`);
      const rows = await childUsageRollup(ws.id, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
      console.log(JSON.stringify(rows, null, 2));
    } else {
      console.log("usage: tsx src/worker/billing.ts rentals|addons|planfees|autotopup|invoices|invoice <slug>|rollup <slug> [--dry-run]");
    }
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  cli().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
```

**Patch `src/worker/index.ts`** (guide 07's file). Add the import directly after
the line `import { resetDailyCaps, sweepDueCallbacks, sweepPostCalls } from "./maintenance";`:

```ts
import {
  chargeMonthlyRentals,
  chargeMonthlyAddOns,
  chargeMonthlyPlanFees,
  generateAllMonthlyInvoices,
} from "./billing";
import { runAutoTopUpSweep } from "../lib/autotopup";
```

Then find this exact block:

```ts
  cron.schedule("0 3 * * *", () => {
    resetDailyCaps().catch((e) => console.error("[cron] resetDailyCaps", e));
  });
```

and add directly after it:

```ts
  // Billing (guide 09): monthly charges on the 1st; auto-top-up sweep every 15 min.
  // All monthly debits are idempotent via fixed ledger references — overlap-safe.
  cron.schedule("15 3 1 * *", () => {
    chargeMonthlyRentals().catch((e) => console.error("[cron] chargeMonthlyRentals", e));
    chargeMonthlyAddOns().catch((e) => console.error("[cron] chargeMonthlyAddOns", e));
    chargeMonthlyPlanFees().catch((e) => console.error("[cron] chargeMonthlyPlanFees", e));
  });
  cron.schedule("30 4 1 * *", () => {
    generateAllMonthlyInvoices().catch((e) => console.error("[cron] generateAllMonthlyInvoices", e));
  });
  cron.schedule("*/15 * * * *", () => {
    runAutoTopUpSweep().catch((e) => console.error("[cron] runAutoTopUpSweep", e));
  });
```

**Verify:**
```bash
grep -c "chargeMonthlyRentals" src/worker/index.ts
npm run typecheck && npm run build
```
**Expected:** `2` (import + schedule); both exit 0.
**If it fails:** anchor not found → guide 07's worker drifted; add the same import
+ schedules next to the existing `cron.schedule` calls and note the deviation.

---

## Step 16: Scripted integration tests (curl + cron CLI)

Run all parts against the dev server. If `tsx src/worker/billing.ts` errors with
`require is not defined`, replace the `if (require.main === module)` guard in
`src/worker/billing.ts` with `if (process.argv[1]?.endsWith("billing.ts"))` and
note the deviation.

### Part A — Razorpay webhook: verified credit, idempotent replay, bad signature

```bash
cd /root/vaani-ai
(npm run dev > /tmp/next-dev.log 2>&1 &)
sleep 15

ORDER_ID="order_sim_$(date +%s)"
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"PaymentOrder\" (id, \"workspaceId\", provider, \"providerOrderId\", \"amountPaise\", status) SELECT 'po_sim_rzp', id, 'RAZORPAY', '$ORDER_ID', 100000, 'created' FROM \"Workspace\" WHERE slug='demo-clinic';"

BEFORE=$(docker exec vaani-db psql -U vaani -d vaani -t -c \
 "SELECT \"balancePaise\" FROM \"Wallet\" w JOIN \"Workspace\" ws ON w.\"workspaceId\"=ws.id WHERE ws.slug='demo-clinic';" | tr -d ' ')
echo "balance before: $BEFORE"

SECRET=$(grep RAZORPAY_WEBHOOK_SECRET .env | cut -d= -f2)
BODY="{\"event\":\"payment.captured\",\"payload\":{\"payment\":{\"entity\":{\"id\":\"pay_sim_1\",\"order_id\":\"$ORDER_ID\",\"status\":\"captured\"}}}}"
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -s -X POST http://localhost:3000/api/webhooks/razorpay \
  -H "Content-Type: application/json" -H "x-razorpay-signature: $SIG" -d "$BODY"; echo
curl -s -X POST http://localhost:3000/api/webhooks/razorpay \
  -H "Content-Type: application/json" -H "x-razorpay-signature: $SIG" -d "$BODY"; echo
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/webhooks/razorpay \
  -H "Content-Type: application/json" -H "x-razorpay-signature: deadbeef" -d "$BODY"

AFTER=$(docker exec vaani-db psql -U vaani -d vaani -t -c \
 "SELECT \"balancePaise\" FROM \"Wallet\" w JOIN \"Workspace\" ws ON w.\"workspaceId\"=ws.id WHERE ws.slug='demo-clinic';" | tr -d ' ')
echo "balance after: $AFTER"
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT status FROM \"PaymentOrder\" WHERE id='po_sim_rzp';"
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT \"amountPaise\", \"gstPaise\", \"cgstPaise\", \"sgstPaise\", \"igstPaise\", status FROM \"Invoice\" WHERE \"razorpayOrderId\"='$ORDER_ID';"
```

**Expected:** first POST `{"ok":true}`; replay `{"ok":true,"already":true}`; bad
signature `401`. `AFTER` = `BEFORE` + 100000 (credited ONCE). PaymentOrder `paid`.
Receipt invoice: `84746 | 15254 | 7627 | 7627 | 0 | paid` (GST-inclusive split of
₹1,000: base 84746, CGST+SGST = 15254, intra-state because demo has no place of
supply).

**Cleanup A:**
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "DELETE FROM \"WalletTransaction\" WHERE reference='pay_sim_1';
  UPDATE \"Wallet\" w SET \"balancePaise\"=$BEFORE FROM \"Workspace\" ws WHERE w.\"workspaceId\"=ws.id AND ws.slug='demo-clinic';
  DELETE FROM \"Invoice\" WHERE \"razorpayOrderId\"='$ORDER_ID';
  DELETE FROM \"PaymentOrder\" WHERE id='po_sim_rzp';"
```

### Part B — Stripe webhook: signed credit, replay, bad signature

```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"PaymentOrder\" (id, \"workspaceId\", provider, \"providerSessionId\", \"amountPaise\", status) SELECT 'po_sim_stripe', id, 'STRIPE', 'cs_test_sim_1', 100000, 'created' FROM \"Workspace\" WHERE slug='demo-clinic';"

BEFORE=$(docker exec vaani-db psql -U vaani -d vaani -t -c \
 "SELECT \"balancePaise\" FROM \"Wallet\" w JOIN \"Workspace\" ws ON w.\"workspaceId\"=ws.id WHERE ws.slug='demo-clinic';" | tr -d ' ')

SECRET=$(grep STRIPE_WEBHOOK_SECRET .env | cut -d= -f2)   # CHANGE_ME is fine — both sides use the same value
BODY='{"id":"evt_sim_1","type":"checkout.session.completed","data":{"object":{"id":"cs_test_sim_1","payment_intent":"pi_sim_1","metadata":{"workspaceId":"demo"}}}}'
T=$(date +%s)
V1=$(printf '%s' "$T.$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -s -X POST http://localhost:3000/api/webhooks/stripe \
  -H "Content-Type: application/json" -H "stripe-signature: t=$T,v1=$V1" -d "$BODY"; echo
curl -s -X POST http://localhost:3000/api/webhooks/stripe \
  -H "Content-Type: application/json" -H "stripe-signature: t=$T,v1=$V1" -d "$BODY"; echo
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/webhooks/stripe \
  -H "Content-Type: application/json" -H "stripe-signature: t=$T,v1=deadbeef" -d "$BODY"

AFTER=$(docker exec vaani-db psql -U vaani -d vaani -t -c \
 "SELECT \"balancePaise\" FROM \"Wallet\" w JOIN \"Workspace\" ws ON w.\"workspaceId\"=ws.id WHERE ws.slug='demo-clinic';" | tr -d ' ')
echo "stripe: before=$BEFORE after=$AFTER"
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT status, \"providerOrderId\" FROM \"PaymentOrder\" WHERE id='po_sim_stripe';"
```

**Expected:** `{"ok":true}` then `{"ok":true,"already":true}` then `401`;
`AFTER` = `BEFORE` + 100000; PaymentOrder `paid | pi_sim_1`.

**Cleanup B:**
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "DELETE FROM \"WalletTransaction\" WHERE reference='pi_sim_1';
  UPDATE \"Wallet\" w SET \"balancePaise\"=$BEFORE FROM \"Workspace\" ws WHERE w.\"workspaceId\"=ws.id AND ws.slug='demo-clinic';
  DELETE FROM \"Invoice\" WHERE \"workspaceId\"=(SELECT id FROM \"Workspace\" WHERE slug='demo-clinic') AND \"razorpayOrderId\" IS NULL;
  DELETE FROM \"PaymentOrder\" WHERE id='po_sim_stripe';"
```

### Part C — Call billing e2e + low-balance webhook event

Same Dograh simulation as the original guide, plus: threshold set so the debit
crosses it, and a `wallet.low_balance` subscription that must receive a delivery.

```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"PhoneNumber\" (id, \"workspaceId\", number) SELECT 'pn_bill', id, '+918040001234' FROM \"Workspace\" WHERE slug='demo-clinic';
  INSERT INTO \"WebhookSubscription\" (id, \"workspaceId\", url, events, secret, active) SELECT 'wsub_sim', id, 'https://example.invalid/hook', '{wallet.low_balance}', 's3cret', true FROM \"Workspace\" WHERE slug='demo-clinic';
  UPDATE \"Wallet\" w SET \"lowBalanceAlertPaise\" = \"balancePaise\" FROM \"Workspace\" ws WHERE w.\"workspaceId\"=ws.id AND ws.slug='demo-clinic';"

SECRET=$(grep DOGRAH_WEBHOOK_SECRET .env | cut -d= -f2)
BAL_BEFORE=$(docker exec vaani-db psql -U vaani -d vaani -t -c \
 "SELECT \"balancePaise\" FROM \"Wallet\" w JOIN \"Workspace\" ws ON w.\"workspaceId\"=ws.id WHERE ws.slug='demo-clinic';" | tr -d ' ')

BODY='{"event":"call.started","data":{"call_id":"dograh_bill_1","from_number":"+919900000077","to_number":"+918040001234"}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
curl -s -X POST http://localhost:3000/api/webhooks/dograh -H "Content-Type: application/json" -H "x-dograh-signature: $SIG" -d "$BODY"; echo

BODY='{"event":"call.ended","data":{"call_id":"dograh_bill_1","duration_seconds":200,"summary":"Billing test call.","transcript":"AI: Namaste!\nCaller: Test."}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
curl -s -X POST http://localhost:3000/api/webhooks/dograh -H "Content-Type: application/json" -H "x-dograh-signature: $SIG" -d "$BODY"; echo
sleep 5

docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT \"durationSec\", \"costTelephonyPaise\", \"costSttPaise\", \"costLlmPaise\", \"costTtsPaise\", \"billedPaise\" FROM \"Call\" WHERE \"dograhCallId\"='dograh_bill_1';"
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT type, \"amountPaise\" FROM \"WalletTransaction\" WHERE note LIKE 'Call +919900000077%' ORDER BY \"createdAt\" DESC LIMIT 1;"
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT event, status FROM \"WebhookDelivery\" WHERE \"subscriptionId\"='wsub_sim';"

# Answered call WITHOUT a transcript (STT failure → postcall early return) must
# STILL debit the wallet — this is the Step 6 wiring regression test.
BODY='{"event":"call.started","data":{"call_id":"dograh_bill_2","from_number":"+919900000078","to_number":"+918040001234"}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
curl -s -X POST http://localhost:3000/api/webhooks/dograh -H "Content-Type: application/json" -H "x-dograh-signature: $SIG" -d "$BODY"; echo
BODY='{"event":"call.ended","data":{"call_id":"dograh_bill_2","duration_seconds":120,"summary":"STT unavailable."}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
curl -s -X POST http://localhost:3000/api/webhooks/dograh -H "Content-Type: application/json" -H "x-dograh-signature: $SIG" -d "$BODY"; echo
sleep 5
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT \"durationSec\", transcript IS NULL AS no_transcript, \"billedPaise\" FROM \"Call\" WHERE \"dograhCallId\"='dograh_bill_2';"
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT type, \"amountPaise\" FROM \"WalletTransaction\" WHERE note LIKE 'Call +919900000078%' ORDER BY \"createdAt\" DESC LIMIT 1;"

BAL_AFTER=$(docker exec vaani-db psql -U vaani -d vaani -t -c \
 "SELECT \"balancePaise\" FROM \"Wallet\" w JOIN \"Workspace\" ws ON w.\"workspaceId\"=ws.id WHERE ws.slug='demo-clinic';" | tr -d ' ')
echo "wallet: before=$BAL_BEFORE after=$BAL_AFTER"
```

**Expected (200s call, starter markup 40%):**
- Call row: `200 | 100 | 60 | 40 | 80 | 392` (rate card 30/18/12/24 paise-per-min;
  wholesale 280 → per-component ×1.4 = 392).
- WalletTransaction: `CALL_DEBIT | -392`.
- WebhookDelivery: `wallet.low_balance | PENDING` (guide 08's worker delivers it).
- No-transcript 120s call: `120 | t | 235` (costs 60/36/24/48 → wholesale 168 →
  84+50+34+67 = 235) and a second `CALL_DEBIT | -235` — proof that the early-return
  path is billed.
- `BAL_AFTER` = `BAL_BEFORE` − 627 (392 + 235).

**Cleanup C:**
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "DELETE FROM \"CallEvent\" WHERE \"callId\" IN (SELECT id FROM \"Call\" WHERE \"dograhCallId\" IN ('dograh_bill_1','dograh_bill_2'));
  DELETE FROM \"WalletTransaction\" WHERE reference IN (SELECT id FROM \"Call\" WHERE \"dograhCallId\" IN ('dograh_bill_1','dograh_bill_2'));
  DELETE FROM \"Call\" WHERE \"dograhCallId\" IN ('dograh_bill_1','dograh_bill_2');
  DELETE FROM \"PhoneNumber\" WHERE id='pn_bill';
  DELETE FROM \"WebhookDelivery\" WHERE \"subscriptionId\"='wsub_sim';
  DELETE FROM \"WebhookSubscription\" WHERE id='wsub_sim';
  UPDATE \"Wallet\" w SET \"balancePaise\"=$BAL_BEFORE, \"lowBalanceAlertPaise\"=50000 FROM \"Workspace\" ws WHERE w.\"workspaceId\"=ws.id AND ws.slug='demo-clinic';"
pkill -f "next dev" || true
```

### Part D — Billing cron: dry-run, real debit, idempotent re-run

```bash
cd /root/vaani-ai
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"PhoneNumber\" (id, \"workspaceId\", number, \"monthlyRentPaise\") SELECT 'pn_rent', id, '+918040009999', 20000 FROM \"Workspace\" WHERE slug='demo-clinic';
  INSERT INTO \"NumberRental\" (id, \"workspaceId\", \"phoneNumberId\", \"monthlyPricePaise\", status) SELECT 'rent_sim', id, 'pn_rent', 20000, 'ACTIVE' FROM \"Workspace\" WHERE slug='demo-clinic';
  INSERT INTO \"AddOnPurchase\" (id, \"workspaceId\", code, \"monthlyPricePaise\", active) SELECT 'addon_sim', id, 'extra_line', 49900, true FROM \"Workspace\" WHERE slug='demo-clinic';"

npx tsx src/worker/billing.ts rentals --dry-run
npx tsx src/worker/billing.ts rentals
npx tsx src/worker/billing.ts rentals   # idempotent re-run
npx tsx src/worker/billing.ts addons
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT type, \"amountPaise\", reference FROM \"WalletTransaction\" WHERE reference LIKE 'rent-rent_sim%' OR reference LIKE 'addon-addon_sim%';"
```

**Expected:**
- Dry-run: `[dry-run] would debit 20000 paise ... (rent-rent_sim-<yyyymm>)`.
- First real run: `rentals charged: 1`; re-run: `rentals charged: 0` (skipped).
- Add-ons: `add-ons charged: 1`.
- Ledger: `NUMBER_RENT | -20000 | rent-rent_sim-...` and
  `ADDON_DEBIT | -49900 | addon-addon_sim-...` — exactly one row each.

**Cleanup D:**
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "DELETE FROM \"WalletTransaction\" WHERE reference LIKE 'rent-rent_sim%' OR reference LIKE 'addon-addon_sim%';
  DELETE FROM \"AddOnPurchase\" WHERE id='addon_sim';
  DELETE FROM \"NumberRental\" WHERE id='rent_sim';
  DELETE FROM \"PhoneNumber\" WHERE id='pn_rent';
  UPDATE \"Wallet\" w SET \"balancePaise\" = (SELECT COALESCE((SELECT \"balanceAfterPaise\" FROM \"WalletTransaction\" wt WHERE wt.\"walletId\"=w.id ORDER BY \"createdAt\" DESC LIMIT 1), \"balancePaise\")) FROM \"Workspace\" ws WHERE w.\"workspaceId\"=ws.id AND ws.slug='demo-clinic';"
```
(The last UPDATE re-syncs the cached balance with the latest ledger row.)

### Part E — Invoice generation: GST fields

```bash
# Fixture: one billable debit this month for the demo workspace.
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"WalletTransaction\" (id, \"walletId\", type, \"amountPaise\", \"balanceAfterPaise\", note) SELECT 'txn_sim_inv', w.id, 'CALL_DEBIT', -118000, 0, 'invoice fixture' FROM \"Wallet\" w JOIN \"Workspace\" ws ON w.\"workspaceId\"=ws.id WHERE ws.slug='demo-clinic';"

npx tsx src/worker/billing.ts invoice demo-clinic
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT \"amountPaise\", \"gstPaise\", \"cgstPaise\", \"sgstPaise\", \"igstPaise\", \"hsnSac\", status, \"pdfKey\" IS NOT NULL AS stored FROM \"Invoice\" WHERE \"workspaceId\"=(SELECT id FROM \"Workspace\" WHERE slug='demo-clinic') ORDER BY \"createdAt\" DESC LIMIT 1;"
```

**Expected:** CLI prints `{"invoiceId":"...","invoiceNumber":"VAANI/<fyTag>/NNNN",...}`
(fyTag like `2526` depending on today's date). Invoice row: `100000 | 18000 | 9000 |
9000 | 0 | 998314 | paid | t` (₹1,180 GST-inclusive → base ₹1,000 + 18% CGST/SGST;
intra-state because demo has no place of supply; HTML stored in MinIO → `pdfKey` set).

**Cleanup E:**
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "DELETE FROM \"Invoice\" WHERE \"workspaceId\"=(SELECT id FROM \"Workspace\" WHERE slug='demo-clinic');
  DELETE FROM \"WalletTransaction\" WHERE id='txn_sim_inv';"
```

### Part F — Reseller rollup matches fixtures

```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"ResellerAccount\" (id, \"parentWorkspaceId\", active) SELECT 'rs_sim', id, true FROM \"Workspace\" WHERE slug='demo-clinic';
  INSERT INTO \"Workspace\" (id, name, slug, \"resellerId\") VALUES ('ws_child_sim', 'Sim Child Clinic', 'sim-child', 'rs_sim');
  INSERT INTO \"Call\" (id, \"workspaceId\", direction, status, \"fromNumber\", \"toNumber\", \"durationSec\", \"billedPaise\", \"costTelephonyPaise\", \"costSttPaise\", \"costLlmPaise\", \"costTtsPaise\")
   VALUES ('call_child_sim', 'ws_child_sim', 'OUTBOUND', 'COMPLETED', '+918040009999', '+919900000011', 200, 392, 100, 60, 40, 80);"

npx tsx src/worker/billing.ts rollup demo-clinic
```

**Expected:** JSON array with one row: `"totalCalls": 1`, `"totalMinutes": 4`,
`"revenuePaise": 392`, `"costPaise": 280`, `"marginPaise": 112`.

**Cleanup F:**
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "DELETE FROM \"Call\" WHERE id='call_child_sim';
  DELETE FROM \"Workspace\" WHERE id='ws_child_sim';
  DELETE FROM \"ResellerAccount\" WHERE id='rs_sim';"
```

**If any part fails:** check `tail -n 40 /tmp/next-dev.log`; a `401` on a correctly
signed request means the dev server started before `.env` was edited — restart it.
Two attempts max, then STOP and report with the exact command + output.

---

## Step 17: Git checkpoint

```bash
cd /root/vaani-ai
git add -A
git commit -m "phase 09: full monetization — plans+gates, rate-card metering, Razorpay+Stripe top-ups, GST invoices, rentals, add-ons, trial, reseller panel, billing cron"
```

---

## Acceptance Checklist

- [ ] Step 0: 3 seeded plans verified; `stripe@17.3.1` installed; 4 new env vars in `.env`
- [ ] Migration `billing_extras` applied (AddOnPurchase, TxnType ADDON_DEBIT/PLAN_FEE, Workspace GST fields)
- [ ] `npm test`: all unit suites green (rate card math, markup, trial enforcement, feature gates, GST split both branches, invoice numbering, Stripe signature, add-ons, auto-top-up trigger, reseller rollup, KYC gate)
- [ ] `checkFeatureGate` exported from `src/lib/feature-gates.ts` with the documented signature
- [ ] provision.ts patch: TrialState created in the register transaction; numbers.ts patch: KYC gate + NumberRental creation
- [ ] postcall.ts bills EVERY completed call — single `billCall` right after the Call row loads (grep count 2), incl. answered no-transcript calls
- [ ] Billing page: balance, plan, trial/low-balance banners, top-up tabs, transactions, rentals, invoices render
- [ ] Plans page: 3 plan cards, upgrade debits PLAN_FEE, downgrade immediate without charge
- [ ] Add-ons page: purchase flips gate + ADDON_DEBIT; cancel deactivates
- [ ] Settings page: GST form validates GSTIN format; threshold + auto-top-up save
- [ ] Razorpay webhook: valid → credited once + paid receipt invoice with CGST/SGST; replay idempotent; bad sig 401
- [ ] Stripe webhook: valid → credited once; replay idempotent; bad sig 401
- [ ] 200s simulated call → costs `100/60/40/80`, billedPaise 392, one CALL_DEBIT; `wallet.low_balance` delivery created on threshold crossing
- [ ] Cron CLI: rentals/add-ons/plan-fees dry-run + real + idempotent re-run (0 on second run)
- [ ] Invoice CLI: `VAANI/<fy>/NNNN` number, base+GST = total, CGST+SGST intra-state, pdfKey stored
- [ ] Reseller: enable gated by `reseller_panel` plan gate; child created with resellerId; rollup JSON matches fixtures
- [ ] `npm run typecheck` + `npm run build` exit 0
- [ ] Git commit `phase 09: ...` exists

## FINAL REPORT format

```
STEP 0..17: PASS/FAIL — <one line of evidence each>
RZP SIM: credited once=YES/NO, replay=<response>, bad-sig=<code>
STRIPE SIM: credited once=YES/NO, replay=<response>, bad-sig=<code>
CALL BILLING: billed=<paise> expected 392; no-transcript billed=<paise> expected 235; low-balance delivery=YES/NO
CRON: rentals charged=<n>/rerun=<n>, addons charged=<n>
INVOICE: <VAANI/fy/seq> cgst=<n> sgst=<n> igst=<n> stored=YES/NO
RESELLER ROLLUP: revenue=<n> cost=<n> margin=<n> expected 392/280/112
ACCEPTANCE: n/18 checked
NOTES: <deviations>
```
