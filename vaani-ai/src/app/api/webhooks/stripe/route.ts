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
