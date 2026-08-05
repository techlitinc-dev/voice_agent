import { describe, expect, it } from "vitest";
import { cutoffDate, isValidRetentionDays } from "../src/lib/retention";

describe("cutoffDate", () => {
  it("subtracts N days exactly (fake clock)", () => {
    const now = new Date("2024-07-08T03:30:00Z");
    expect(cutoffDate(now, 90).toISOString()).toBe("2024-04-09T03:30:00.000Z");
    expect(cutoffDate(now, 1).toISOString()).toBe("2024-07-07T03:30:00.000Z");
    expect(cutoffDate(now, 0).toISOString()).toBe(now.toISOString());
  });
});

describe("isValidRetentionDays", () => {
  it("accepts 1..3650 integers only", () => {
    expect(isValidRetentionDays(90)).toBe(true);
    expect(isValidRetentionDays(1)).toBe(true);
    expect(isValidRetentionDays(3650)).toBe(true);
    expect(isValidRetentionDays(0)).toBe(false);
    expect(isValidRetentionDays(3651)).toBe(false);
    expect(isValidRetentionDays(1.5)).toBe(false);
  });
});
