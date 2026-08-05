import { describe, expect, it } from "vitest";
import { normalizeSearchQuery } from "../src/lib/fts";

describe("normalizeSearchQuery", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeSearchQuery("  cleaning   price  ")).toBe("cleaning price");
  });
  it("caps length at 200 chars by default", () => {
    expect(normalizeSearchQuery("x".repeat(500))).toHaveLength(200);
  });
  it("respects a custom cap", () => {
    expect(normalizeSearchQuery("abcdef", 3)).toBe("abc");
  });
  it("returns empty string for blank input", () => {
    expect(normalizeSearchQuery("   ")).toBe("");
  });
});
