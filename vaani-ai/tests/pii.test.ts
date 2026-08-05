import { describe, expect, it } from "vitest";
import { luhnCheck, redactPii } from "../src/lib/pii";

describe("luhnCheck", () => {
  it("accepts valid card numbers", () => {
    expect(luhnCheck("4111111111111111")).toBe(true); // Visa test
    expect(luhnCheck("5555555555554444")).toBe(true); // Mastercard test
  });
  it("rejects invalid / wrong-length numbers", () => {
    expect(luhnCheck("4111111111111112")).toBe(false);
    expect(luhnCheck("123456789012")).toBe(false); // 12 digits — not a card length
    expect(luhnCheck("4111a11111111111")).toBe(false);
  });
});

describe("redactPii", () => {
  it("redacts a Luhn-valid card, with and without separators", () => {
    const r = redactPii("my card is 4111 1111 1111 1111 ok? also 4111-1111-1111-1111");
    expect(r.redacted).toBe("my card is [REDACTED:CARD] ok? also [REDACTED:CARD]");
    expect(r.findings).toEqual(["card", "card"]);
  });

  it("does NOT redact a 16-digit order id that fails Luhn", () => {
    const r = redactPii("order id 1234567812345678 confirmed");
    expect(r.redacted).toContain("1234567812345678");
    expect(r.findings).toHaveLength(0);
  });

  it("redacts Aadhaar numbers", () => {
    const r = redactPii("aadhaar 2341 2341 2341 and plain 234123412341");
    expect(r.redacted).toBe("aadhaar [REDACTED:AADHAAR] and plain [REDACTED:AADHAAR]");
    expect(r.findings).toEqual(["aadhaar", "aadhaar"]);
  });

  it("redacts emails", () => {
    const r = redactPii("mail me at ramesh.kumar+work@gmail.com please");
    expect(r.redacted).toBe("mail me at [REDACTED:EMAIL] please");
    expect(r.findings).toEqual(["email"]);
  });

  it("redacts OTP mentions but keeps the label", () => {
    const r = redactPii("OTP is 482910, share it now");
    expect(r.redacted).toContain("[REDACTED:OTP]");
    expect(r.redacted).not.toContain("482910");
  });

  it("handles a nasty combined fixture and is idempotent", () => {
    const nasty =
      "Caller gave card 5555 5555 5555 4444, aadhaar 1234-5678-9012, email a.b@clinic.co.in, verification code: 123456. Order 9988776655443322 stays.";
    const r1 = redactPii(nasty);
    expect(r1.redacted).toContain("[REDACTED:CARD]");
    expect(r1.redacted).toContain("[REDACTED:AADHAAR]");
    expect(r1.redacted).toContain("[REDACTED:EMAIL]");
    expect(r1.redacted).toContain("[REDACTED:OTP]");
    expect(r1.redacted).toContain("9988776655443322"); // fails Luhn -> untouched
    const r2 = redactPii(r1.redacted);
    expect(r2.redacted).toBe(r1.redacted); // idempotent
  });
});
