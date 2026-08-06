import { describe, expect, it } from "vitest";
import {
  CHECKLIST_KEYS,
  WIZARD_STEPS,
  canGoLive,
  isOnboardingComplete,
  mergeChecklist,
  nextStep,
  parseChecklist,
  progressPercent,
} from "@/lib/onboarding";

describe("WIZARD_STEPS", () => {
  it("has exactly the readme §13 six steps in order", () => {
    expect(WIZARD_STEPS.map((s) => s.key)).toEqual([
      "industry",
      "template",
      "knowledge",
      "test_call",
      "number",
      "live",
    ]);
    expect(CHECKLIST_KEYS).toHaveLength(5);
  });
});

describe("parseChecklist", () => {
  it("returns {} for null/undefined/arrays/scalars", () => {
    expect(parseChecklist(null)).toEqual({});
    expect(parseChecklist(undefined)).toEqual({});
    expect(parseChecklist([])).toEqual({});
    expect(parseChecklist("x")).toEqual({});
  });
  it("passes through objects", () => {
    expect(parseChecklist({ industry: true })).toEqual({ industry: true });
  });
});

describe("mergeChecklist", () => {
  it("merges without dropping unrelated keys", () => {
    const merged = mergeChecklist({ industry: true, dismissed: true }, { template: true });
    expect(merged).toEqual({ industry: true, dismissed: true, template: true });
  });
  it("later patch wins on conflicts", () => {
    expect(mergeChecklist({ knowledge: false }, { knowledge: true }).knowledge).toBe(true);
  });
});

describe("nextStep", () => {
  it("returns the first incomplete step", () => {
    expect(nextStep({})).toBe(0);
    expect(nextStep({ industry: true })).toBe(1);
    expect(nextStep({ industry: true, template: true })).toBe(2);
    expect(nextStep({ industry: true, template: true, knowledge: true, test_call: true })).toBe(4);
  });
  it("returns 5 (go live) when all five checklist items are done", () => {
    expect(
      nextStep({ industry: true, template: true, knowledge: true, test_call: true, number: true }),
    ).toBe(5);
  });
});

describe("progressPercent", () => {
  it("is 0 with nothing done, 100 with all five done", () => {
    expect(progressPercent({})).toBe(0);
    expect(
      progressPercent({ industry: true, template: true, knowledge: true, test_call: true, number: true }),
    ).toBe(100);
  });
  it("counts only the five checklist keys (dismissed is ignored)", () => {
    expect(progressPercent({ industry: true, dismissed: true })).toBe(20);
  });
});

describe("canGoLive", () => {
  it("requires industry AND template only", () => {
    expect(canGoLive({})).toBe(false);
    expect(canGoLive({ industry: true })).toBe(false);
    expect(canGoLive({ template: true })).toBe(false);
    expect(canGoLive({ industry: true, template: true })).toBe(true);
  });
});

describe("isOnboardingComplete", () => {
  it("is false for null and for completedAt=null, true otherwise", () => {
    expect(isOnboardingComplete(null)).toBe(false);
    expect(isOnboardingComplete({ completedAt: null })).toBe(false);
    expect(isOnboardingComplete({ completedAt: new Date() })).toBe(true);
  });
});
