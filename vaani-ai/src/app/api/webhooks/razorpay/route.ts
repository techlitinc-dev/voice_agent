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
