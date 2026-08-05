import { describe, expect, it } from "vitest";
import {
  billForSeconds,
  callCostPaise,
  formatINR,
  paiseToRupees,
  splitGst,
  withMarkup,
} from "../src/lib/money";

describe("paiseToRupees", () => {
  it("converts integer paise to a 2-decimal rupee string", () => {
    expect(paiseToRupees(299900)).toBe("2999.00");
    expect(paiseToRupees(92)).toBe("0.92");
    expect(paiseToRupees(0)).toBe("0.00");
  });
});

describe("formatINR", () => {
  it("formats with Indian digit grouping", () => {
    expect(formatINR(2499900)).toContain("24,999.00");
    expect(formatINR(100000)).toContain("1,000.00");
  });
});

describe("withMarkup", () => {
  it("applies percentage markup with integer rounding", () => {
    expect(withMarkup(100, 40)).toBe(140);
    expect(withMarkup(259, 40)).toBe(363); // 362.6 rounds to 363
    expect(withMarkup(0, 50)).toBe(0);
  });
});

describe("billForSeconds", () => {
  it("bills per-second, rounding up to the next paise", () => {
    expect(billForSeconds(60, 100)).toBe(100);
    expect(billForSeconds(30, 100)).toBe(50);
    expect(billForSeconds(31, 100)).toBe(52); // 51.67 -> 52
    expect(billForSeconds(0, 100)).toBe(0);
    expect(billForSeconds(-5, 100)).toBe(0);
  });
});

describe("splitGst", () => {
  it("splits 18% into CGST+SGST for intra-state supply", () => {
    const r = splitGst(100000, false);
    expect(r.totalGstPaise).toBe(18000);
    expect(r.cgstPaise).toBe(9000);
    expect(r.sgstPaise).toBe(9000);
    expect(r.igstPaise).toBe(0);
  });

  it("uses IGST only for inter-state supply", () => {
    const r = splitGst(100000, true);
    expect(r.igstPaise).toBe(18000);
    expect(r.cgstPaise).toBe(0);
    expect(r.sgstPaise).toBe(0);
  });

  it("keeps cgst + sgst == total on odd amounts", () => {
    const r = splitGst(101, false); // total 18 paise
    expect(r.cgstPaise + r.sgstPaise).toBe(r.totalGstPaise);
  });

  it("respects a custom rate", () => {
    expect(splitGst(1000, true, 5).igstPaise).toBe(50);
  });
});

describe("callCostPaise", () => {
  it("sums the four cost components", () => {
    expect(
      callCostPaise({ telephonyPaise: 92, sttPaise: 55, llmPaise: 38, ttsPaise: 74 }),
    ).toBe(259);
  });
});
