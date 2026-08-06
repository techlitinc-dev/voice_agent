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
        note: `Subscription plan fee — ${plan.name} (monthly, immediate upgrade)`,
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
