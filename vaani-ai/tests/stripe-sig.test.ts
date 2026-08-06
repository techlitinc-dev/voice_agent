import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { verifyStripeSignature } from "../src/lib/stripe-sig";

const SECRET = "whsec_test_secret_123";
const PAYLOAD = JSON.stringify({
  id: "evt_1",
  type: "checkout.session.completed",
  data: { object: { id: "cs_test_1" } },
});

function sign(payload: string, secret: string, t: number): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

describe("verifyStripeSignature", () => {
  const now = 1_800_000_000_000; // fixed "now" in ms
  const t = Math.floor(now / 1000);

  it("accepts a correctly signed payload", () => {
    expect(verifyStripeSignature(PAYLOAD, sign(PAYLOAD, SECRET, t), SECRET, 300, now)).toBe(true);
  });
  it("rejects a wrong secret", () => {
    expect(verifyStripeSignature(PAYLOAD, sign(PAYLOAD, "whsec_wrong", t), SECRET, 300, now)).toBe(false);
  });
  it("rejects a tampered payload", () => {
    const evil = PAYLOAD.replace("cs_test_1", "cs_test_evil");
    expect(verifyStripeSignature(evil, sign(PAYLOAD, SECRET, t), SECRET, 300, now)).toBe(false);
  });
  it("rejects an old timestamp (replay protection)", () => {
    const oldT = t - 3600;
    expect(verifyStripeSignature(PAYLOAD, sign(PAYLOAD, SECRET, oldT), SECRET, 300, now)).toBe(false);
  });
  it("rejects a malformed header", () => {
    expect(verifyStripeSignature(PAYLOAD, "garbage", SECRET, 300, now)).toBe(false);
  });
});
