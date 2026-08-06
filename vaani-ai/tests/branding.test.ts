import { describe, expect, it } from "vitest";
import {
  hexToHslTriplet,
  isValidHexColor,
  logoContentType,
  logoStorageKey,
  validateLogoUpload,
} from "@/lib/branding";

describe("isValidHexColor", () => {
  it("accepts #rrggbb only", () => {
    expect(isValidHexColor("#7c3aed")).toBe(true);
    expect(isValidHexColor("#ABCDEF")).toBe(true);
    expect(isValidHexColor("#fff")).toBe(false);
    expect(isValidHexColor("7c3aed")).toBe(false);
    expect(isValidHexColor("#gg0000")).toBe(false);
    expect(isValidHexColor("")).toBe(false);
  });
});

describe("hexToHslTriplet", () => {
  it("converts known colors", () => {
    expect(hexToHslTriplet("#ff0000")).toBe("0 100% 50%");
    expect(hexToHslTriplet("#00ff00")).toBe("120 100% 50%");
    expect(hexToHslTriplet("#0000ff")).toBe("240 100% 50%");
    expect(hexToHslTriplet("#000000")).toBe("0 0% 0%");
    expect(hexToHslTriplet("#ffffff")).toBe("0 0% 100%");
  });
  it("converts the Vaani teal family (#14b8a6 ≈ 173 80% 40%)", () => {
    expect(hexToHslTriplet("#14b8a6")).toBe("173 80% 40%");
  });
  it("returns null on invalid input", () => {
    expect(hexToHslTriplet("#fff")).toBeNull();
    expect(hexToHslTriplet("red")).toBeNull();
  });
});

describe("logoStorageKey", () => {
  it("keys under branding/<workspaceId>/logo.<ext>, lowercased ext", () => {
    expect(logoStorageKey("ws1", "My Logo.PNG")).toBe("branding/ws1/logo.png");
    expect(logoStorageKey("ws1", "logo.svg")).toBe("branding/ws1/logo.svg");
  });
});

describe("validateLogoUpload", () => {
  it("accepts png/jpg/webp/svg under 512KB", () => {
    expect(validateLogoUpload("logo.png", 1000).ok).toBe(true);
    expect(validateLogoUpload("logo.svg", 512 * 1024).ok).toBe(true);
  });
  it("rejects bad types, empty and oversized files", () => {
    expect(validateLogoUpload("logo.gif", 1000).ok).toBe(false);
    expect(validateLogoUpload("logo.png", 0).ok).toBe(false);
    expect(validateLogoUpload("logo.png", 512 * 1024 + 1).ok).toBe(false);
  });
});

describe("logoContentType", () => {
  it("maps extensions to mime types", () => {
    expect(logoContentType("a.PNG")).toBe("image/png");
    expect(logoContentType("a.svg")).toBe("image/svg+xml");
    expect(logoContentType("a.bin")).toBe("application/octet-stream");
  });
});
