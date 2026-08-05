import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticator } from "otplib";
import {
  findMatchingBackupCode,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  normalizeBackupCode,
  totpKeyUri,
  verifyTotpCode,
} from "../src/lib/totp";

afterEach(() => {
  vi.useRealTimers();
});

describe("TOTP secret + key URI", () => {
  it("generates a base32 secret", () => {
    const secret = generateTotpSecret();
    expect(secret.length).toBeGreaterThanOrEqual(16);
    expect(/^[A-Z2-7]+=*$/.test(secret)).toBe(true);
  });

  it("builds an otpauth:// URI with the Vaani AI issuer", () => {
    const uri = totpKeyUri("demo@vaani.ai", "JBSWY3DPEHPK3PXP");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain("issuer=Vaani%20AI");
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
  });
});

describe("TOTP verify round-trip (mocked time)", () => {
  it("accepts the current code and rejects it 10 minutes later", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T12:00:00Z"));
    const secret = generateTotpSecret();
    const code = authenticator.generate(secret); // code valid "now"
    expect(verifyTotpCode(secret, code)).toBe(true);

    vi.setSystemTime(new Date("2024-06-01T12:10:00Z")); // far beyond ±1 window
    expect(verifyTotpCode(secret, code)).toBe(false);
  });

  it("rejects malformed codes deterministically", () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, "abcdef")).toBe(false);
    expect(verifyTotpCode(secret, "12345")).toBe(false);
    expect(verifyTotpCode(secret, "")).toBe(false);
  });

  it("rejects a code generated for a different secret", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T12:00:00Z"));
    const other = authenticator.generate(generateTotpSecret());
    expect(verifyTotpCode(generateTotpSecret(), other)).toBe(false);
  });
});

describe("backup codes", () => {
  it("generates 10 unique human-readable codes", () => {
    const codes = generateBackupCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
  });

  it("hash is deterministic and normalization ignores case/dashes", () => {
    expect(hashBackupCode("K7F2-9QX4")).toBe(hashBackupCode("k7f2-9qx4"));
    expect(hashBackupCode("k7f29qx4")).toBe(hashBackupCode("k7f2-9qx4"));
    expect(normalizeBackupCode(" K7F2-9QX4 ")).toBe("k7f29qx4");
  });

  it("matches an unused code exactly once (consume-once)", () => {
    const [a, b] = generateBackupCodes(2);
    const stored = [
      { id: "row-a", codeHash: hashBackupCode(a), usedAt: null as Date | null },
      { id: "row-b", codeHash: hashBackupCode(b), usedAt: new Date() }, // already used
    ];
    expect(findMatchingBackupCode(a, stored)).toBe("row-a");
    // Simulate consumption:
    stored[0].usedAt = new Date();
    expect(findMatchingBackupCode(a, stored)).toBeNull();
    // Used code never matches again; wrong code never matches.
    expect(findMatchingBackupCode(b, stored)).toBeNull();
    expect(findMatchingBackupCode("zzzz-zzzz", stored)).toBeNull();
  });
});
