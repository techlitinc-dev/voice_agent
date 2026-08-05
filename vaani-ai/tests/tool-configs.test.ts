import { describe, expect, it } from "vitest";
import { validateToolConfig, resolveJsonPath, applyResponseMapping, TOOL_META } from "../src/lib/tool-configs";

describe("validateToolConfig", () => {
  it("applies defaults for empty config", () => {
    const r = validateToolConfig("CALENDAR_BOOKING", {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.config as { provider: string }).provider).toBe("google");
      expect((r.config as { slotMinutes: number }).slotMinutes).toBe(30);
    }
  });

  it("rejects invalid CUSTOM_WEBHOOK (no URL) and accepts a valid one", () => {
    expect(validateToolConfig("CUSTOM_WEBHOOK", {}).ok).toBe(false);
    expect(validateToolConfig("CUSTOM_WEBHOOK", { url: "https://example.com/hook" }).ok).toBe(true);
  });

  it("rejects out-of-range values", () => {
    expect(validateToolConfig("CALENDAR_BOOKING", { slotMinutes: 5 }).ok).toBe(false);
    expect(validateToolConfig("PAYMENT_LINK", { amountPaise: 50 }).ok).toBe(false);
  });

  it("accepts all 8 tools with valid configs", () => {
    const valid: Record<string, unknown>[] = [
      {}, // CALENDAR_BOOKING
      { queue: "sales" }, // HUMAN_TRANSFER
      { messageTemplate: "Hi {{name}}" }, // SMS
      { templateName: "booking_confirm" }, // WHATSAPP
      { provider: "HUBSPOT" }, // CRM_WRITE
      { amountPaise: 150000 }, // PAYMENT_LINK
      { url: "https://example.com" }, // CUSTOM_WEBHOOK
      { transcribe: true }, // VOICEMAIL
    ];
    TOOL_META.forEach((meta, i) => {
      expect(validateToolConfig(meta.tool, valid[i]).ok, meta.tool).toBe(true);
    });
  });
});

describe("response mapping", () => {
  const body = { data: { order: { status: "shipped", id: "O1" } }, ok: true };
  it("resolveJsonPath walks dotted paths", () => {
    expect(resolveJsonPath(body, "data.order.status")).toBe("shipped");
    expect(resolveJsonPath(body, "data.missing.deep")).toBeUndefined();
  });
  it("applyResponseMapping projects only mapped fields", () => {
    const out = applyResponseMapping({ status: "data.order.status", id: "data.order.id" }, body);
    expect(out).toEqual({ status: "shipped", id: "O1" });
  });
});
