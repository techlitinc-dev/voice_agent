import { describe, expect, it } from "vitest";
import {
  applyFieldMapping,
  validateFieldMapping,
  splitName,
  FIELD_MAPPING_PRESETS,
} from "../src/lib/integrations/crm/index";

const lead = { name: "Ravi Kumar", phone: "+919900000001", email: "r@x.in", note: "wants 2BHK", outcome: "qualified" };

describe("applyFieldMapping", () => {
  it("maps canonical keys to CRM properties, skipping empties", () => {
    const out = applyFieldMapping(FIELD_MAPPING_PRESETS.HUBSPOT, lead);
    expect(out.firstname).toBe("Ravi Kumar");
    expect(out.phone).toBe("+919900000001");
    expect(out.hs_lead_status).toBe("qualified");
  });

  it("omits missing values and ignores unknown canonical keys", () => {
    const out = applyFieldMapping(
      { "contact.email": "email", "bogus.key": "x" } as Record<string, string>,
      { name: "A", phone: "+91" },
    );
    expect(out).toEqual({});
  });

  it("null mapping → empty object", () => {
    expect(applyFieldMapping(null, lead)).toEqual({});
  });
});

describe("validateFieldMapping", () => {
  it("accepts canonical keys, rejects others", () => {
    expect(validateFieldMapping({ "contact.phone": "phone" }).ok).toBe(true);
    expect(validateFieldMapping({ "contact.phonee": "phone" }).ok).toBe(false);
    expect(validateFieldMapping("nope").ok).toBe(false);
    expect(validateFieldMapping({ "contact.phone": 5 }).ok).toBe(false);
  });
});

describe("splitName", () => {
  it("splits full names sensibly", () => {
    expect(splitName("Ravi Kumar")).toEqual({ first: "Ravi", last: "Kumar" });
    expect(splitName("Cher")).toEqual({ first: "Cher", last: "Cher" });
    expect(splitName("A B C")).toEqual({ first: "A", last: "B C" });
  });
});
