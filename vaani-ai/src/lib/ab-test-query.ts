/**
 * A/B comparison query (docs/new-features/05 §3.8). Loads the agent's published
 * versions + their attributed calls and returns the conversion comparison.
 */
import { db } from "./db";
import { computeAbStats, type AbComparison } from "./ab-test-stats";

export async function getAbComparison(
  workspaceId: string,
  agentId: string,
  minCalls?: number,
): Promise<AbComparison> {
  const [versions, calls] = await Promise.all([
    db.agentVersion.findMany({
      where: { agentId, workspaceId, status: "PUBLISHED" },
      select: { id: true, version: true, label: true, isAbVariant: true, abTrafficPercent: true },
      orderBy: { version: "asc" },
    }),
    db.call.findMany({
      where: { workspaceId, agentId, agentVersionId: { not: null } },
      select: {
        agentVersionId: true,
        status: true,
        outcome: true,
        sentiment: true,
      },
    }),
  ]);

  return computeAbStats({ versions, calls, minCalls });
}
