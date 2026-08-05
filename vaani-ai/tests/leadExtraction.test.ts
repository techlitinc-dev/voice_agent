import { describe, expect, it } from "vitest";
import {
  buildContactUpsert,
  mergeAttributes,
  normalizeExtractedEntities,
} from "../src/lib/leadExtraction";

describe("normalizeExtractedEntities", () => {
  it("keeps known fields, trims strings", () => {
    const e = normalizeExtractedEntities({ name: "  Ramesh ", requirement: "root canal", city: "Pune" });
    expect(e).toEqual({ name: "Ramesh", requirement: "root canal", city: "Pune" });
  });
  it("preserves unknown flat keys (loan_id etc.)", () => {
    const e = normalizeExtractedEntities({ name: "A", loan_id: "LN123", score: 7 });
    expect(e.name).toBe("A");
    expect((e as Record<string, unknown>).loan_id).toBe("LN123");
    expect((e as Record<string, unknown>).score).toBe(7);
  });
  it("drops empty/oversized strings and nested objects", () => {
    const e = normalizeExtractedEntities({ name: "", big: "x".repeat(201), nested: { a: 1 }, ok: "yes" });
    expect(e).toEqual({ ok: "yes" });
  });
  it("garbage input → {}", () => {
    for (const raw of [null, undefined, "str", 42, [1, 2]]) {
      expect(normalizeExtractedEntities(raw)).toEqual({});
    }
  });
  it("invalid email is dropped", () => {
    const e = normalizeExtractedEntities({ email: "not-an-email" });
    expect(e.email).toBeUndefined();
  });
});

describe("mergeAttributes", () => {
  it("merges into existing attributes, new keys win", () => {
    const m = mergeAttributes({ city: "Mumbai", old: 1 }, { name: "R", requirement: "implant", city: "Pune" });
    expect(m).toEqual({ old: 1, city: "Pune", requirement: "implant" });
  });
  it("name/email never land in attributes", () => {
    const m = mergeAttributes(null, { name: "R", email: "r@x.com", requirement: "q" });
    expect(m).toEqual({ requirement: "q" });
  });
  it("garbage existing attributes → treated as empty", () => {
    expect(mergeAttributes("junk", { requirement: "q" })).toEqual({ requirement: "q" });
  });
});

describe("buildContactUpsert", () => {
  it("creates with name + attributes when entities present", () => {
    const u = buildContactUpsert("w1", "+919812345678", { name: "Ramesh", requirement: "checkup" }, null);
    expect(u.where).toEqual({ workspaceId_phone: { workspaceId: "w1", phone: "+919812345678" } });
    expect(u.create).toEqual({
      workspaceId: "w1",
      phone: "+919812345678",
      name: "Ramesh",
      attributes: { requirement: "checkup" },
    });
    expect(u.update).toEqual({ name: "Ramesh", attributes: { requirement: "checkup" } });
  });
  it("without a name, update does not overwrite the existing name", () => {
    const u = buildContactUpsert("w1", "+919812345678", { requirement: "checkup" }, { city: "Pune" });
    expect(u.create.name).toBeNull();
    expect("name" in u.update).toBe(false);
    expect(u.update.attributes).toEqual({ city: "Pune", requirement: "checkup" });
  });
});
