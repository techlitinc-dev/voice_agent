import { describe, it, expect, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { verifyDograhWebhook } from "./dograhWebhook";

const SECRET = "whsec_test_123";
const BODY = JSON.stringify({ event: "call.ended", data: { call_id: "12:9001" } });
const hmac = (b: string) => createHmac("sha256", SECRET).update(b).digest("hex");
const H = (o: Record<string, string>) => new Headers(o);

afterEach(() => {
  delete process.env.DOGRAH_WEBHOOK_SECRET;
});

describe("verifyDograhWebhook", () => {
  it("dev fallback: no secret configured → allows", () => {
    delete process.env.DOGRAH_WEBHOOK_SECRET;
    expect(verifyDograhWebhook(H({}), BODY)).toBe(true);
  });

  it("static shared-secret header (what Dograh sends) → allows", () => {
    expect(verifyDograhWebhook(H({ "x-webhook-secret": SECRET }), BODY, SECRET)).toBe(true);
  });

  it("valid HMAC in x-dograh-signature → allows", () => {
    expect(verifyDograhWebhook(H({ "x-dograh-signature": hmac(BODY) }), BODY, SECRET)).toBe(true);
  });

  it("valid HMAC in x-webhook-signature → allows", () => {
    expect(verifyDograhWebhook(H({ "x-webhook-signature": hmac(BODY) }), BODY, SECRET)).toBe(true);
  });

  it("wrong static header and no signature → rejects", () => {
    expect(verifyDograhWebhook(H({ "x-webhook-secret": "nope" }), BODY, SECRET)).toBe(false);
  });

  it("tampered body → rejects", () => {
    expect(
      verifyDograhWebhook(H({ "x-dograh-signature": hmac(BODY) }), BODY + "x", SECRET)
    ).toBe(false);
  });

  it("wrong-length signature → rejects without throwing", () => {
    expect(verifyDograhWebhook(H({ "x-dograh-signature": "deadbeef" }), BODY, SECRET)).toBe(false);
  });

  it("right-length garbage signature → rejects", () => {
    expect(
      verifyDograhWebhook(H({ "x-dograh-signature": "a".repeat(64) }), BODY, SECRET)
    ).toBe(false);
  });

  it("no headers at all → rejects when secret is set", () => {
    expect(verifyDograhWebhook(H({}), BODY, SECRET)).toBe(false);
  });
});
