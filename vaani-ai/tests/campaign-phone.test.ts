import { describe, expect, it } from "vitest";
import {
  classifyIndianDid,
  isIndianMobile,
  isValidDidForType,
  isValidE164,
  normalizePhone,
} from "../src/lib/campaign/phone";

describe("normalizePhone", () => {
  it("keeps valid E.164", () => {
    expect(normalizePhone("+919812345678")).toBe("+919812345678");
    expect(normalizePhone("+14155552671")).toBe("+14155552671");
  });
  it("converts Indian 10-digit mobiles to +91", () => {
    expect(normalizePhone("9876543210")).toBe("+919876543210");
    expect(normalizePhone("919876543210")).toBe("+919876543210");
    expect(normalizePhone("+91 98765 43210")).toBe("+919876543210");
  });
  it("rejects junk and landlines", () => {
    expect(normalizePhone("bad-row")).toBeNull();
    expect(normalizePhone("08023456789")).toBeNull(); // landline: not a mobile series
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("isValidE164 / isIndianMobile", () => {
  it("validates", () => {
    expect(isValidE164("+919812345678")).toBe(true);
    expect(isValidE164("9812345678")).toBe(false);
    expect(isValidE164("+0123")).toBe(false);
    expect(isIndianMobile("+919812345678")).toBe(true);
    expect(isIndianMobile("+911401234567")).toBe(false); // DID series, not mobile
    expect(isIndianMobile("+14155552671")).toBe(false);
  });
});

describe("classifyIndianDid / isValidDidForType", () => {
  it("classifies TRAI series", () => {
    expect(classifyIndianDid("+911401234567")).toBe("140");
    expect(classifyIndianDid("+911600123456")).toBe("1600");
    expect(classifyIndianDid("+918040001234")).toBe("other");
  });
  it("enforces series rules on pool DIDs", () => {
    expect(isValidDidForType("+911401234567", "SERIES_140")).toBe(true);
    expect(isValidDidForType("+911600123456", "SERIES_140")).toBe(false);
    expect(isValidDidForType("+911600123456", "SERIES_1600")).toBe(true);
    expect(isValidDidForType("+918040001234", "LOCAL")).toBe(true);
    expect(isValidDidForType("not-a-number", "LOCAL")).toBe(false);
  });
});
