import { describe, expect, it } from "vitest";
import {
  agentCreateSchema,
  callTriggerSchema,
  campaignCreateSchema,
  contactsBulkSchema,
  numberCreateSchema,
} from "../src/lib/api/resources";

describe("agentCreateSchema", () => {
  it("accepts a minimal valid agent with defaults", () => {
    const r = agentCreateSchema.parse({ name: "Priya", systemPrompt: "You are Priya the receptionist.", greeting: "Namaste!" });
    expect(r.languageMode).toBe("auto");
    expect(r.voiceId).toBe("anushka");
  });
  it("rejects a short system prompt", () => {
    expect(agentCreateSchema.safeParse({ name: "Priya", systemPrompt: "short", greeting: "hi" }).success).toBe(false);
  });
});

describe("campaignCreateSchema", () => {
  it("applies pacing defaults", () => {
    const r = campaignCreateSchema.parse({ name: "July", agentId: "a1", listId: "l1" });
    expect(r.callsPerMinute).toBe(10);
    expect(r.concurrency).toBe(1);
    expect(r.type).toBe("LEAD_QUALIFICATION");
  });
  it("rejects a bad type", () => {
    expect(campaignCreateSchema.safeParse({ name: "X", agentId: "a", listId: "l", type: "SPAM" }).success).toBe(false);
  });
});

describe("contactsBulkSchema", () => {
  it("accepts up to 1000 E.164 contacts", () => {
    const contacts = Array.from({ length: 1000 }, (_, i) => ({ phone: `+91990000${String(i).padStart(4, "0")}` }));
    expect(contactsBulkSchema.safeParse({ contacts }).success).toBe(true);
  });
  it("rejects bad phones and oversize batches", () => {
    expect(contactsBulkSchema.safeParse({ contacts: [{ phone: "9900000001" }] }).success).toBe(false);
    expect(contactsBulkSchema.safeParse({ contacts: [] }).success).toBe(false);
  });
});

describe("callTriggerSchema / numberCreateSchema", () => {
  it("validates E.164", () => {
    expect(callTriggerSchema.safeParse({ to: "+919812345678", agentId: "a1" }).success).toBe(true);
    expect(callTriggerSchema.safeParse({ to: "9812345678", agentId: "a1" }).success).toBe(false);
    expect(numberCreateSchema.safeParse({ number: "+918040001234" }).success).toBe(true);
    expect(numberCreateSchema.safeParse({ number: "0804000123" }).success).toBe(false);
  });
});
