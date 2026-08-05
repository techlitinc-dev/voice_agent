import { describe, expect, it } from "vitest";
import { shouldSendWhatsAppFallback } from "../src/lib/campaign/fallback";

const POLICY = { busy: { attempts: 3, delayMin: 30 }, whatsappFallbackTemplateId: "tpl_1" };

describe("shouldSendWhatsAppFallback", () => {
  it("fires only on final no-answer with a configured template", () => {
    expect(shouldSendWhatsAppFallback({ retryPolicyJson: POLICY, disposition: "no-answer", retryExhausted: true }))
      .toEqual({ send: true, templateId: "tpl_1" });
  });
  it("does NOT fire when retries remain, on other dispositions, or without a template", () => {
    expect(shouldSendWhatsAppFallback({ retryPolicyJson: POLICY, disposition: "no-answer", retryExhausted: false }).send).toBe(false);
    expect(shouldSendWhatsAppFallback({ retryPolicyJson: POLICY, disposition: "busy", retryExhausted: true }).send).toBe(false);
    expect(shouldSendWhatsAppFallback({ retryPolicyJson: POLICY, disposition: "voicemail", retryExhausted: true }).send).toBe(false);
    expect(shouldSendWhatsAppFallback({ retryPolicyJson: POLICY, disposition: "completed", retryExhausted: true }).send).toBe(false);
    expect(shouldSendWhatsAppFallback({ retryPolicyJson: { busy: { attempts: 3, delayMin: 30 } }, disposition: "no-answer", retryExhausted: true }).send).toBe(false);
    expect(shouldSendWhatsAppFallback({ retryPolicyJson: null, disposition: "no-answer", retryExhausted: true }).send).toBe(false);
  });
});
