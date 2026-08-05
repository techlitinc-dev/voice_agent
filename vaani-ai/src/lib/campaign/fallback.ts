/**
 * Call-to-WhatsApp fallback decision (readme §9): fire only when the contact is
 * finally unreachable by voice — retries exhausted AND the last disposition is
 * no-answer — and a fallback template is configured.
 */
import { parseCampaignExtras } from "./retry";

export function shouldSendWhatsAppFallback(input: {
  retryPolicyJson: unknown;
  disposition: string;
  retryExhausted: boolean;
}): { send: boolean; templateId?: string } {
  if (!input.retryExhausted || input.disposition !== "no-answer") return { send: false };
  const extras = parseCampaignExtras(input.retryPolicyJson);
  if (!extras.whatsappFallbackTemplateId) return { send: false };
  return { send: true, templateId: extras.whatsappFallbackTemplateId };
}
