import { describe, expect, it } from "vitest";
import {
  financialYearTag,
  formatInvoiceNumber,
  gstInclusiveSplit,
  isInterState,
  renderInvoiceHtml,
} from "../src/lib/invoice";

describe("invoice numbering (VAANI/<fy>/<seq>)", () => {
  it("computes the financial year tag (April→March)", () => {
    expect(financialYearTag(new Date("2025-04-01T00:00:00"))).toBe("2526");
    expect(financialYearTag(new Date("2026-03-31T00:00:00"))).toBe("2526");
    expect(financialYearTag(new Date("2025-01-15T00:00:00"))).toBe("2425");
  });
  it("formats with 4-digit sequence padding", () => {
    expect(formatInvoiceNumber(1, new Date("2025-06-01"))).toBe("VAANI/2526/0001");
    expect(formatInvoiceNumber(42, new Date("2026-02-01"))).toBe("VAANI/2526/0042");
  });
});

describe("gstInclusiveSplit (both GST branches)", () => {
  it("intra-state → CGST + SGST on the backed-out base", () => {
    const g = gstInclusiveSplit(100000, false); // ₹1,000 incl.
    expect(g.basePaise).toBe(84746); // round(100000*100/118)
    expect(g.igstPaise).toBe(0);
    expect(g.cgstPaise + g.sgstPaise).toBe(g.totalGstPaise);
    expect(g.basePaise + g.totalGstPaise).toBe(100000); // 18% of 84746 = 15254
  });
  it("inter-state → IGST only", () => {
    const g = gstInclusiveSplit(100000, true);
    expect(g.igstPaise).toBe(g.totalGstPaise);
    expect(g.cgstPaise).toBe(0);
    expect(g.sgstPaise).toBe(0);
    expect(g.basePaise + g.igstPaise).toBe(100000);
  });
  it("keeps cgst+sgst == total on odd amounts", () => {
    const g = gstInclusiveSplit(101, false);
    expect(g.cgstPaise + g.sgstPaise).toBe(g.totalGstPaise);
  });
});

describe("isInterState (place of supply parsing)", () => {
  it("compares the (NN) state code with the company state", () => {
    expect(isInterState("Maharashtra (27)", "29")).toBe(true);
    expect(isInterState("Karnataka (29)", "29")).toBe(false);
  });
  it("no place of supply → intra-state (B2C default)", () => {
    expect(isInterState(null, "29")).toBe(false);
    expect(isInterState(undefined, "29")).toBe(false);
  });
});

describe("renderInvoiceHtml", () => {
  const base = {
    invoiceNumber: "VAANI/2526/0001",
    date: new Date("2025-06-30"),
    companyName: "Vaani AI Pvt Ltd",
    companyGstin: "29AAAAA0000A1Z5",
    customerName: "Demo Dental Clinic",
    customerGstin: null,
    placeOfSupply: "Karnataka (29)",
    hsnSac: "998314",
    lines: [{ label: "AI call usage", amountPaise: 392 }],
    cgstPaise: 0,
    sgstPaise: 0,
    igstPaise: 0,
    totalPaise: 392,
  };
  it("shows CGST+SGST rows for intra-state", () => {
    const html = renderInvoiceHtml({ ...base, basePaise: 333, cgstPaise: 30, sgstPaise: 29, totalPaise: 392 });
    expect(html).toContain("CGST @9%");
    expect(html).toContain("SGST @9%");
    expect(html).not.toContain("IGST @18%");
    expect(html).toContain("VAANI/2526/0001");
  });
  it("shows a single IGST row for inter-state", () => {
    const html = renderInvoiceHtml({ ...base, basePaise: 333, igstPaise: 59, totalPaise: 392 });
    expect(html).toContain("IGST @18%");
    expect(html).not.toContain("CGST @9%");
  });
});
