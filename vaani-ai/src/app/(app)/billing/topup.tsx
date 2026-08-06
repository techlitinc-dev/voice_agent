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
