import { describe, expect, it } from "vitest";
import { buildQaPrompt, extractJsonObject, mockScore, parseQaResponse } from "../src/lib/qa/scorer";
import { RUBRICS, maxScore, rubricForCall } from "../src/lib/qa/rubrics";

const rubric = RUBRICS["receptionist-default"];

describe("rubric registry", () => {
  it("computes maxScore as the sum of criteria", () => {
    expect(maxScore(rubric)).toBe(40);
    expect(maxScore(RUBRICS["telecaller-default"])).toBe(40);
  });
  it("picks the rubric by call direction", () => {
    expect(rubricForCall("OUTBOUND").name).toBe("telecaller-default");
    expect(rubricForCall("INBOUND").name).toBe("receptionist-default");
  });
});

describe("buildQaPrompt", () => {
  it("includes every criterion key and the transcript", () => {
    const p = buildQaPrompt(rubric, "AI: Namaste! Caller: price?");
    for (const c of rubric.criteria) expect(p).toContain(`"${c.key}"`);
    expect(p).toContain("AI: Namaste! Caller: price?");
    expect(p).toContain("STRICT JSON");
  });
  it("truncates very long transcripts", () => {
    const p = buildQaPrompt(rubric, "x".repeat(20000));
    expect(p.length).toBeLessThan(20000);
  });
});

describe("extractJsonObject", () => {
  it("finds JSON inside surrounding prose and newlines", () => {
    expect(extractJsonObject("Sure, here is the result:\n{\"a\":1}\nDone.")).toBe('{"a":1}');
  });
  it("returns null when no object is present", () => {
    expect(extractJsonObject("no json here")).toBeNull();
  });
});

describe("parseQaResponse", () => {
  it("parses a clean scorer response", () => {
    const text = '{"scores":{"greeting":10,"compliance_lines":9,"faq_accuracy":8,"closing":7},"notes":"good","hallucination":false,"hallucination_notes":null}';
    const r = parseQaResponse(text, rubric);
    expect(r).not.toBeNull();
    expect(r!.totalScore).toBe(34);
    expect(r!.maxScore).toBe(40);
    expect(r!.hallucination).toBe(false);
  });
  it("clamps out-of-range scores instead of trusting the model", () => {
    const text = '{"scores":{"greeting":999,"compliance_lines":-5,"faq_accuracy":4.6,"closing":"x"},"hallucination":true,"hallucination_notes":"invented price"}';
    const r = parseQaResponse(text, rubric)!;
    expect(r.scores.greeting).toBe(10); // clamped to maxPoints
    expect(r.scores.compliance_lines).toBe(0); // clamped to 0
    expect(r.scores.faq_accuracy).toBe(5); // rounded
    expect(r.scores.closing).toBe(0); // non-numeric -> 0
    expect(r.hallucination).toBe(true);
    expect(r.hallucinationNotes).toBe("invented price");
  });
  it("returns null for garbage", () => {
    expect(parseQaResponse("not json at all", rubric)).toBeNull();
    expect(parseQaResponse('{"scores":', rubric)).toBeNull();
  });
});

describe("mockScore", () => {
  it("is deterministic and never flags hallucination", () => {
    const a = mockScore(rubric);
    const b = mockScore(rubric);
    expect(a).toEqual(b);
    expect(a.hallucination).toBe(false);
    expect(a.totalScore).toBe(36); // 4 criteria x (10-1)
  });
});
