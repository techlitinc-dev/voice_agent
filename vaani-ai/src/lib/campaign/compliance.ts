/**
 * TRAI/TCPA compliance (readme §6.1 + §11):
 * - Campaign type → required number series. 140 = promotional, 1600 = service/
 *   transactional. Enforced at campaign start (Step 6) against the pool's numbers.
 * - TCPA-style consent: promotional campaigns may require Contact.consentAt
 *   (env REQUIRE_CONSENT_FOR_PROMOTIONAL).
 * - DNC scrub helper (pure part of import/dial-time scrubbing).
 */

export type SeriesClass = "PROMOTIONAL" | "SERVICE";

export const CAMPAIGN_TYPE_SERIES: Record<string, SeriesClass> = {
  LEAD_QUALIFICATION: "PROMOTIONAL", // cold/warm outreach
  APPOINTMENT_REMINDER: "SERVICE", // existing relationship
  PAYMENT_REMINDER: "SERVICE", // transactional (EMI/dues)
  FEEDBACK_SURVEY: "SERVICE", // post-transaction
  ORDER_CONFIRMATION: "SERVICE", // transactional
  REACTIVATION: "PROMOTIONAL", // win-back marketing
  EVENT_INVITE: "PROMOTIONAL", // marketing invite
  POLITICAL_SURVEY: "PROMOTIONAL", // outreach
};

/** NumberType values allowed for a campaign type. Non-India types are always allowed
 *  (international DIDs are not TRAI-regulated; tenant is responsible for local law). */
export function allowedNumberTypes(campaignType: string): string[] {
  const cls = CAMPAIGN_TYPE_SERIES[campaignType] ?? "PROMOTIONAL";
  const india = cls === "PROMOTIONAL" ? ["SERIES_140"] : ["SERIES_1600"];
  return [...india, "LOCAL", "TOLLFREE", "MOBILE"];
}

export function isNumberTypeAllowed(campaignType: string, numberType: string): boolean {
  return allowedNumberTypes(campaignType).includes(numberType);
}

/** Promotional campaigns are the consent-gated ones (TCPA-style, readme §11). */
export function requiresConsent(campaignType: string): boolean {
  return CAMPAIGN_TYPE_SERIES[campaignType] === "PROMOTIONAL";
}

export function hasValidConsent(contact: { consentAt: Date | null }): boolean {
  return contact.consentAt !== null;
}

/** Should this contact be blocked for missing consent right now? */
export function consentBlocks(contact: { consentAt: Date | null }, campaignType: string, enforcementOn: boolean): boolean {
  return enforcementOn && requiresConsent(campaignType) && !hasValidConsent(contact);
}

/** Pure DNC scrub: partition phones into dialable / blocked by a DNC set. */
export function scrubAgainstDnc<T extends { phone: string }>(
  rows: T[],
  dncPhones: ReadonlySet<string>
): { dialable: T[]; blocked: T[] } {
  const dialable: T[] = [];
  const blocked: T[] = [];
  for (const r of rows) (dncPhones.has(r.phone) ? blocked : dialable).push(r);
  return { dialable, blocked };
}

/** True when the pool uses the promotional series (drives the TRAI-hours guardrail). */
export function poolUsesPromotionalSeries(numbers: { numberType: string }[]): boolean {
  return numbers.some((n) => n.numberType === "SERIES_140");
}
