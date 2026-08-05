import { describe, expect, it } from "vitest";
import { rateLimitAllow, rateLimitReset } from "../src/lib/ratelimit";

describe("rateLimitAllow", () => {
  it("allows up to the limit within a window, then rejects", () => {
    rateLimitReset();
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(rateLimitAllow("k1", 5, t0 + i)).toBe(true);
    expect(rateLimitAllow("k1", 5, t0 + 5)).toBe(false);
  });

  it("tracks keys independently", () => {
    rateLimitReset();
    const t0 = 2_000_000;
    for (let i = 0; i < 3; i++) expect(rateLimitAllow("k1", 3, t0)).toBe(true);
    expect(rateLimitAllow("k1", 3, t0)).toBe(false);
    expect(rateLimitAllow("k2", 3, t0)).toBe(true);
  });

  it("refills after the window passes", () => {
    rateLimitReset();
    const t0 = 3_000_000;
    expect(rateLimitAllow("k1", 1, t0)).toBe(true);
    expect(rateLimitAllow("k1", 1, t0 + 1000)).toBe(false);
    expect(rateLimitAllow("k1", 1, t0 + 61_000)).toBe(true);
  });

  it("limit <= 0 disables limiting", () => {
    rateLimitReset();
    for (let i = 0; i < 100; i++) expect(rateLimitAllow("k1", 0, i)).toBe(true);
  });
});
