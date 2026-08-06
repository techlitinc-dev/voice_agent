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
