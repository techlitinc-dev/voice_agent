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
