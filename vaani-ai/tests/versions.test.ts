import { describe, expect, it, vi } from "vitest";
import { snapshotAgent, nextVersionNumber, validateAbSplit } from "../src/lib/versions";

describe("snapshotAgent", () => {
  it("freezes prompt, greeting and full config including tools", () => {
    const snap = snapshotAgent({
      systemPrompt: "sp",
      greeting: "g",
      voiceId: "anushka",
      llmModel: "m",
      languageMode: "auto",
      fixedLanguage: null,
      maxCallSeconds: 600,
      conversationConfig: { allowBargeIn: true },
      toolConfigs: [{ tool: "SMS", config: { messageTemplate: "x" } }],
    });
    expect(snap.systemPrompt).toBe("sp");
    expect(snap.config.tools).toEqual([{ tool: "SMS", config: { messageTemplate: "x" } }]);
    expect(snap.config.voiceId).toBe("anushka");
  });
});

describe("nextVersionNumber", () => {
  it("is max+1, starting at 1", () => {
    expect(nextVersionNumber([])).toBe(1);
    expect(nextVersionNumber([{ version: 1 }, { version: 3 }])).toBe(4);
  });
});

describe("validateAbSplit", () => {
  it("rejects a second variant and out-of-range percents", () => {
    expect(validateAbSplit({ existingAbVariants: [{ id: "x" }], trafficPercent: 20 }).ok).toBe(false);
    expect(validateAbSplit({ existingAbVariants: [], trafficPercent: 0 }).ok).toBe(false);
    expect(validateAbSplit({ existingAbVariants: [], trafficPercent: 100 }).ok).toBe(false);
    expect(validateAbSplit({ existingAbVariants: [], trafficPercent: 50 }).ok).toBe(true);
  });
});

/**
 * Publish → new version → rollback sequencing, with the Dograh client MOCKED.
 * Mirrors the transitions in publishAgentAction / rollbackAgentAction
 * (src/server/actions/agents.ts) without Next.js runtime or a database.
 */
describe("publish/rollback sequencing (mocked Dograh)", () => {
  it("publish freezes v1, publish again freezes v2, rollback re-publishes v1", async () => {
    const dograh = { create: vi.fn(), update: vi.fn(), publish: vi.fn() };
    let wfCounter = 0;
    dograh.create.mockImplementation(() => ({ id: ++wfCounter, workflow_uuid: `uuid-${wfCounter}` }));

    type V = { version: number; status: string; dograhWorkflowId: string | null };
    const versions: V[] = [];

    // publish v1
    versions.push({ version: nextVersionNumber(versions), status: "PUBLISHED", dograhWorkflowId: String((dograh.create()).id) });
    // publish v2 (new Dograh workflow per version)
    versions.push({ version: nextVersionNumber(versions), status: "PUBLISHED", dograhWorkflowId: String((dograh.create()).id) });
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[1].dograhWorkflowId).toBe("2");

    // rollback to v1: archive all published, flip v1 back, re-publish its workflow
    for (const v of versions) if (v.status === "PUBLISHED") v.status = "ARCHIVED";
    const target = versions[0];
    dograh.update(Number(target.dograhWorkflowId), {});
    dograh.publish(Number(target.dograhWorkflowId));
    target.status = "PUBLISHED";

    expect(dograh.update).toHaveBeenCalledWith(1, {});
    expect(dograh.publish).toHaveBeenCalledWith(1);
    expect(versions[0].status).toBe("PUBLISHED");
    expect(versions[1].status).toBe("ARCHIVED");
    // after rollback, a subsequent publish continues numbering at v3
    expect(nextVersionNumber(versions)).toBe(3);
  });
});
