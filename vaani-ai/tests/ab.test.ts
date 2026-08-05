import { describe, expect, it } from "vitest";
import { abBucket, resolveServingVersion, resolveAgentForCall, type AbCandidate } from "../src/lib/ab-test";

const pubs = (pct: number): AbCandidate[] => [
  { id: "main", isAbVariant: false, abTrafficPercent: null, dograhWorkflowId: "1", dograhWorkflowUuid: "u1" },
  { id: "var", isAbVariant: true, abTrafficPercent: pct, dograhWorkflowId: "2", dograhWorkflowUuid: "u2" },
];

describe("abBucket", () => {
  it("is deterministic and within 0..99", () => {
    const b = abBucket("agent1", "+919900000001");
    expect(b).toBe(abBucket("agent1", "+919900000001"));
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(100);
  });

  it("different agents bucket the same phone differently (usually)", () => {
    expect(abBucket("a", "p") !== abBucket("b", "p") || abBucket("a", "p2") !== abBucket("b", "p2")).toBe(true);
  });
});

describe("resolveServingVersion", () => {
  it("same caller always gets the same variant", () => {
    const a = resolveServingVersion(pubs(50), "agent1", "+919900000042")!.id;
    for (let i = 0; i < 10; i++) {
      expect(resolveServingVersion(pubs(50), "agent1", "+919900000042")!.id).toBe(a);
    }
  });

  it("0% variant always serves main; no phone serves main", () => {
    for (let i = 0; i < 20; i++) {
      expect(resolveServingVersion(pubs(0), "agent1", `+9199000000${i}`)!.id).toBe("main");
    }
    expect(resolveServingVersion(pubs(50), "agent1")!.id).toBe("main");
  });

  it("rough split at 50% over many callers", () => {
    let variant = 0;
    const n = 500;
    for (let i = 0; i < n; i++) {
      if (resolveServingVersion(pubs(50), "agent1", `+9199${String(i).padStart(8, "0")}`)!.id === "var") variant++;
    }
    expect(variant).toBeGreaterThan(n * 0.35);
    expect(variant).toBeLessThan(n * 0.65);
  });
});

describe("resolveAgentForCall", () => {
  it("returns workflow ids of the chosen version; null when nothing published", () => {
    const r = resolveAgentForCall({ agentId: "agent1", callerPhone: "+919900000001", publishedVersions: pubs(100) });
    // 100% variant → the variant's workflow
    expect(r).toEqual({ versionId: "var", dograhWorkflowId: "2", dograhWorkflowUuid: "u2" });
    expect(resolveAgentForCall({ agentId: "a", publishedVersions: [] })).toBeNull();
    expect(
      resolveAgentForCall({
        agentId: "a",
        publishedVersions: [{ id: "x", isAbVariant: false, abTrafficPercent: null, dograhWorkflowId: null, dograhWorkflowUuid: null }],
      }),
    ).toBeNull();
  });
});
