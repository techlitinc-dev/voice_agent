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
