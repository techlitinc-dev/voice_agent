/**
 * Payment collection for the PAYMENT_LINK agent tool (readme §4.4):
 * create a Razorpay payment link, read out / send it, confirm status.
 * VAANI_DRY_RUN=true (default) simulates link creation — no real links, no money.
 */
import Razorpay from "razorpay";

const DRY_RUN = () => process.env.VAANI_DRY_RUN !== "false";

function rz(): Razorpay {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID ?? "",
    key_secret: process.env.RAZORPAY_KEY_SECRET ?? "",
  });
}

export type PaymentLinkResult = {
  id: string;
  shortUrl: string;
  status: string;
  simulated?: boolean;
};

/** Create a payment link for integer paise (money rule: never floats). */
export async function createPaymentLink(input: {
  amountPaise: number;
  description: string;
  customerPhone?: string;
  referenceId?: string;
}): Promise<PaymentLinkResult> {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise < 100) {
    throw new Error("amountPaise must be an integer >= 100 (₹1)");
  }
  if (DRY_RUN()) {
    return {
      id: `plink_dry_${Date.now()}`,
      shortUrl: "https://rzp.io/l/dry-run-simulated",
      status: "created",
      simulated: true,
    };
  }
  const base = {
    amount: input.amountPaise,
    currency: "INR",
    description: input.description.slice(0, 200),
    reference_id: input.referenceId,
    notify: { sms: false, email: false }, // we send the link ourselves via SMS/WhatsApp tool
  };
  const params = input.customerPhone
    ? { ...base, customer: { contact: input.customerPhone } }
    : { ...base, customer: { contact: "" } };
  const link = (await rz().paymentLink.create(params)) as unknown as {
    id: string;
    short_url?: string;
    status?: string;
  };
  return { id: link.id, shortUrl: String(link.short_url), status: String(link.status) };
}

/** Confirm payment status (the "confirm payment status" part of the flow). */
export async function getPaymentLinkStatus(paymentLinkId: string): Promise<string> {
  if (DRY_RUN() || paymentLinkId.startsWith("plink_dry_")) return "created";
  const link = await rz().paymentLink.fetch(paymentLinkId);
  return String(link.status); // created | partially_paid | paid | expired | cancelled
}
