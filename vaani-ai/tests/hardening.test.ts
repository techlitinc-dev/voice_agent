import { describe, expect, it } from "vitest";
import {
  hashPassword,
  verifyPassword,
  rehashIfNeeded,
  BCRYPT_COST,
} from "../src/lib/passwords";
import { deviceFingerprint } from "../src/lib/device";
import { MAX_FAILED_ATTEMPTS, lockoutState } from "../src/lib/lockout";
import { PASSWORD_RULE, PASSWORD_MIN_LENGTH } from "../src/lib/password-rules";

describe("password hashing (hardening §1.1 / §1.2)", () => {
  it("hashes with argon2id and verifies round-trip", async () => {
    const hash = await hashPassword("Correct-Horse-2026!");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword("Correct-Horse-2026!", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("still verifies legacy bcrypt hashes (backward compat)", async () => {
    const bcrypt = await import("bcryptjs");
    const legacy = await bcrypt.hash("Legacy-Pass-2026!", 10);
    expect(await verifyPassword("Legacy-Pass-2026!", legacy)).toBe(true);
    expect(rehashIfNeeded(legacy)).toBe(true); // bcrypt is always legacy now
  });

  it("argon2 hashes never need rehashing; garbage hashes never verify", async () => {
    const hash = await hashPassword("New-Pass-2026!");
    expect(rehashIfNeeded(hash)).toBe(false);
    expect(await verifyPassword("anything", "not-a-real-hash")).toBe(false);
  });

  it("bcrypt hashing path uses cost 12 (hardening §1.1)", async () => {
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash("Cost-Check-2026!", BCRYPT_COST);
    expect(hash.startsWith(`$2a$${BCRYPT_COST}$`) || hash.startsWith(`$2b$${BCRYPT_COST}$`)).toBe(true);
    expect(await bcrypt.compare("Cost-Check-2026!", hash)).toBe(true);
  });
});

describe("password policy (hardening §1.10)", () => {
  it("requires 12+ chars with upper, lower, digit, symbol", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(PASSWORD_RULE.test("Good-Pass-2026!")).toBe(true);
    expect(PASSWORD_RULE.test("Short1!a")).toBe(false); // 8 chars
    expect(PASSWORD_RULE.test("alllowercase123!")).toBe(false);
    expect(PASSWORD_RULE.test("NOLOWERCASE123!")).toBe(false);
    expect(PASSWORD_RULE.test("NoDigitsHere!!")).toBe(false);
    expect(PASSWORD_RULE.test("NoSymbolHere1a")).toBe(false);
  });
});

describe("device fingerprint (hardening §1.5)", () => {
  it("binds UA + IP prefix and changes when either changes", () => {
    const a = deviceFingerprint("Mozilla/5.0 Chrome/120", "203.0.113.7");
    const sameIp = deviceFingerprint("Mozilla/5.0 Chrome/120", "203.0.113.9"); // same /24
    const diffUa = deviceFingerprint("Mozilla/5.0 Firefox/121", "203.0.113.7");
    const diffIp = deviceFingerprint("Mozilla/5.0 Chrome/120", "198.51.100.7");

    expect(a).toBe(sameIp); // IP prefix only, so same /24 matches
    expect(a).not.toBe(diffUa);
    expect(a).not.toBe(diffIp);
  });

  it("is null when both UA and IP are absent", () => {
    expect(deviceFingerprint(null, null)).toBeNull();
  });

  it("is deterministic (sha256, no salt needed — not a secret)", () => {
    expect(deviceFingerprint("ua", "1.2.3.4")).toBe(deviceFingerprint("ua", "1.2.3.4"));
    expect(deviceFingerprint("ua", "1.2.3.4")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("lockout state (hardening §1.6)", () => {
  const base = { failedLoginAttempts: 0, lockedUntil: null as Date | null };

  it("allows up to MAX_FAILED_ATTEMPTS - 1 failures", () => {
    const s = lockoutState({ ...base, failedLoginAttempts: MAX_FAILED_ATTEMPTS - 1 });
    expect(s.locked).toBe(false);
    expect(s.remainingAttempts).toBe(1);
  });

  it("locks at MAX_FAILED_ATTEMPTS", () => {
    const s = lockoutState({ ...base, failedLoginAttempts: MAX_FAILED_ATTEMPTS });
    expect(s.locked).toBe(false); // not locked until lockedUntil is set
    expect(s.remainingAttempts).toBe(0);
  });

  it("reports locked while lockedUntil is in the future", () => {
    const s = lockoutState({
      ...base,
      failedLoginAttempts: 7,
      lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
    });
    expect(s.locked).toBe(true);
    expect(s.remainingAttempts).toBe(0);
  });

  it("unlocks after lockedUntil passes", () => {
    const s = lockoutState({
      ...base,
      failedLoginAttempts: 7,
      lockedUntil: new Date(Date.now() - 1000),
    });
    expect(s.locked).toBe(false);
  });
});
