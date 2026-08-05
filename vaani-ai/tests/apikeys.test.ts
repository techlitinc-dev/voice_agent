import { describe, expect, it } from "vitest";
import {
  apiKeyPrefix,
  generateApiKeySecret,
  hashApiKey,
  ipAllowed,
  ipMatchesCidr,
  ipToInt,
  isValidCidr,
} from "../src/lib/apikeys";

describe("api key secrets", () => {
  it("generates vaani_live_ keys with 48 hex chars", () => {
    const key = generateApiKeySecret();
    expect(key).toMatch(/^vaani_live_[0-9a-f]{48}$/);
    expect(generateApiKeySecret()).not.toBe(key); // unique
  });

  it("hashes to 64-char hex, deterministically", () => {
    const hash = hashApiKey("vaani_live_abc");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey("vaani_live_abc")).toBe(hash);
    expect(hashApiKey("vaani_live_abd")).not.toBe(hash);
  });

  it("matches the guide-02 seeded demo key hash", () => {
    // The seed stores sha256("demo-api-key-do-not-use") — proves our hashing lines up.
    expect(hashApiKey("demo-api-key-do-not-use")).toBe(
      "e46ea83ec368dc44797a4b7da96ad92963dae141d417cd89fdb211b488422b0f"
    );
  });

  it("prefix is the display-safe first 15 chars", () => {
    const key = generateApiKeySecret();
    expect(apiKeyPrefix(key)).toBe(key.slice(0, 15));
    expect(apiKeyPrefix(key).startsWith("vaani_live_")).toBe(true);
  });
});

describe("IPv4 parsing", () => {
  it("parses valid IPs", () => {
    expect(ipToInt("0.0.0.0")).toBe(0);
    expect(ipToInt("255.255.255.255")).toBe(4294967295);
    expect(ipToInt("192.168.1.1")).toBe(0xc0a80101);
  });

  it("rejects invalid IPs", () => {
    expect(ipToInt("256.1.1.1")).toBeNull();
    expect(ipToInt("1.2.3")).toBeNull();
    expect(ipToInt("1.2.3.4.5")).toBeNull();
    expect(ipToInt("abc")).toBeNull();
    expect(ipToInt("::1")).toBeNull(); // IPv6 not supported
  });
});

describe("CIDR matching", () => {
  it("validates CIDR syntax", () => {
    expect(isValidCidr("203.0.113.10/32")).toBe(true);
    expect(isValidCidr("10.0.0.0/8")).toBe(true);
    expect(isValidCidr("1.2.3.4")).toBe(true); // bare IP = /32
    expect(isValidCidr("1.2.3.4/33")).toBe(false);
    expect(isValidCidr("999.1.1.1/8")).toBe(false);
    expect(isValidCidr("1.2.3.4/x")).toBe(false);
  });

  it("matches exact IPs and subnets", () => {
    expect(ipMatchesCidr("203.0.113.10", "203.0.113.10/32")).toBe(true);
    expect(ipMatchesCidr("203.0.113.10", "203.0.113.10")).toBe(true);
    expect(ipMatchesCidr("203.0.113.11", "203.0.113.10/32")).toBe(false);
    expect(ipMatchesCidr("10.1.2.3", "10.0.0.0/8")).toBe(true);
    expect(ipMatchesCidr("11.0.0.1", "10.0.0.0/8")).toBe(false);
    expect(ipMatchesCidr("192.168.1.55", "192.168.1.0/24")).toBe(true);
    expect(ipMatchesCidr("192.168.2.1", "192.168.1.0/24")).toBe(false);
  });

  it("/0 matches everything; invalid input never matches", () => {
    expect(ipMatchesCidr("8.8.8.8", "0.0.0.0/0")).toBe(true);
    expect(ipMatchesCidr("not-an-ip", "0.0.0.0/0")).toBe(false);
    expect(ipMatchesCidr("8.8.8.8", "bad-cidr")).toBe(false);
  });
});

describe("ipAllowed (allowlist semantics)", () => {
  it("empty allowlist allows any IP", () => {
    expect(ipAllowed("1.2.3.4", [])).toBe(true);
  });

  it("non-empty allowlist requires at least one match", () => {
    const list = ["203.0.113.0/24", "198.51.100.7/32"];
    expect(ipAllowed("203.0.113.99", list)).toBe(true);
    expect(ipAllowed("198.51.100.7", list)).toBe(true);
    expect(ipAllowed("198.51.100.8", list)).toBe(false);
    expect(ipAllowed("127.0.0.1", list)).toBe(false);
  });
});
