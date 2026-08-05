import { describe, expect, it } from "vitest";
import { csvEscape, toCsv } from "../src/lib/csv";

describe("csvEscape", () => {
  it("passes plain values through", () => {
    expect(csvEscape("hello")).toBe("hello");
    expect(csvEscape(42)).toBe("42");
  });
  it("renders null/undefined as empty", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });
  it("quotes values containing comma, quote or newline", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("toCsv", () => {
  it("produces header + rows with CRLF", () => {
    const out = toCsv(["id", "note"], [[1, "a"], [2, "b,c"]]);
    expect(out).toBe('id,note\r\n1,a\r\n2,"b,c"\r\n');
  });
  it("handles empty row set", () => {
    expect(toCsv(["a"], [])).toBe("a\r\n");
  });
});
