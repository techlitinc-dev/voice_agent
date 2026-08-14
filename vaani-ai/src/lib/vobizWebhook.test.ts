import { afterEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyVobizWebhook } from "./vobizWebhook";

const SECRET = "test-secret";

function hmac(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function headers(obj: Record<string, string>): Pick<Headers, "get"> {
  return { get: (k: string) => obj[k.toLowerCase()] ?? null };
}

afterEach(() => {
  delete process.env.VOBIZ_WEBHOOK_SECRET;
});

describe("verifyVobizWebhook", () => {
  it("accepts a valid HMAC signature", () => {
    const body = JSON.stringify({ from: "+9198", to: "+9199", message: { text: { body: "hi" } } });
    expect(verifyVobizWebhook(headers({ "x-vobiz-signature": hmac(body) }), body, SECRET)).toBe(true);
  });

  it("accepts x-webhook-signature alias", () => {
    const body = "hello";
    expect(verifyVobizWebhook(headers({ "x-webhook-signature": hmac(body) }), body, SECRET)).toBe(true);
  });

  it("accepts the static shared secret header", () => {
    expect(verifyVobizWebhook(headers({ "x-vobiz-secret": SECRET }), "any", SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = "original";
    const sig = hmac(body);
    expect(verifyVobizWebhook(headers({ "x-vobiz-signature": sig }), "tampered", SECRET)).toBe(false);
  });

  it("rejects a wrong-length signature", () => {
    const body = "x";
    expect(verifyVobizWebhook(headers({ "x-vobiz-signature": "short" }), body, SECRET)).toBe(false);
  });

  it("rejects when no signature header is present", () => {
    expect(verifyVobizWebhook(headers({}), "body", SECRET)).toBe(false);
  });

  it("dev fallback: allows everything when the secret is unset", () => {
    expect(verifyVobizWebhook(headers({}), "body")).toBe(true);
  });

  it("uses the env secret when not passed explicitly", () => {
    process.env.VOBIZ_WEBHOOK_SECRET = SECRET;
    const body = "env-secret-body";
    expect(verifyVobizWebhook(headers({ "x-vobiz-signature": hmac(body) }), body)).toBe(true);
  });
});
