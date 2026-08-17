import nodemailer from "nodemailer";
import { db } from "./db";
import { emitWebhookEvent } from "./webhooks";
import { cache, rateCardKey } from "./cache";
import {
  componentCosts,
  retailTotalPaise,
  parseRateCardJson,
  DEFAULT_RATE_CARD,
  DEFAULT_MARKUP_PERCENT,
} from "./ratecard";

export type DebitType = "CALL_DEBIT" | "NUMBER_RENT" | "ADDON_DEBIT" | "PLAN_FEE";

/** Resolve the effective wholesale rate card for a workspace, cached 1h
 *  (scalability doc §3.3). Invalidated implicitly by the TTL — reseller
 *  overrides are set rarely and a stale card for an hour is acceptable. */
export async function cachedRateCard(workspaceId: string) {
  return cache(rateCardKey(workspaceId), 3600, async () => {
    const ws = await db.workspace.findUnique({
      where: { id: workspaceId },
      include: { reseller: true },
    });
    return parseRateCardJson(ws?.reseller?.wholesaleRateCard, DEFAULT_RATE_CARD);
  });
}

/** All plan definitions, cached 1h (scalability doc §3.3 — plans rarely change). */
export async function getPlansCached() {
  return cache("plans:all", 3600, () =>
    db.plan.findMany({ orderBy: { monthlyPricePaise: "asc" } })
  );
}

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

  const sub = await db.subscription.findUnique({
    where: { workspaceId: call.workspaceId },
    include: { plan: true },
  });
  const markup = sub?.plan.markupPercent ?? DEFAULT_MARKUP_PERCENT;
  // Rate card cached 1h (scalability doc §3.3) — reseller overrides change rarely.
  const rateCard = await cachedRateCard(call.workspaceId);
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
