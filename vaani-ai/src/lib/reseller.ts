import { z } from "zod";
import { db } from "./db";

/** Wholesale rate card JSON editor validation (per-minute paise, partial). */
export const wholesaleRateCardSchema = z
  .object({
    telephonyPerMinPaise: z.coerce.number().int().min(0),
    sttPerMinPaise: z.coerce.number().int().min(0),
    llmPerMinPaise: z.coerce.number().int().min(0),
    ttsPerMinPaise: z.coerce.number().int().min(0),
  })
  .partial();

/** Per-child usage rollup (pure, unit-tested). revenue = billed to the child;
 *  cost = our wholesale cost; margin = revenue − cost. */
export function summarizeUsage(input: {
  calls: { durationSec: number; billedPaise: number; wholesalePaise: number }[];
}): {
  totalCalls: number;
  totalMinutes: number;
  revenuePaise: number;
  costPaise: number;
  marginPaise: number;
} {
  const totalCalls = input.calls.length;
  const totalMinutes = input.calls.reduce((a, c) => a + Math.ceil(c.durationSec / 60), 0);
  const revenuePaise = input.calls.reduce((a, c) => a + c.billedPaise, 0);
  const costPaise = input.calls.reduce((a, c) => a + c.wholesalePaise, 0);
  return { totalCalls, totalMinutes, revenuePaise, costPaise, marginPaise: revenuePaise - costPaise };
}

export interface ChildRollupRow {
  workspaceId: string;
  name: string;
  slug: string;
  totalCalls: number;
  totalMinutes: number;
  revenuePaise: number;
  costPaise: number;
  marginPaise: number;
}

/** Usage rollup across all child workspaces of a reseller since a date. */
export async function childUsageRollup(
  parentWorkspaceId: string,
  since: Date
): Promise<ChildRollupRow[]> {
  const reseller = await db.resellerAccount.findUnique({
    where: { parentWorkspaceId },
    include: { children: { select: { id: true, name: true, slug: true } } },
  });
  if (!reseller) return [];
  const rows: ChildRollupRow[] = [];
  for (const child of reseller.children) {
    const calls = await db.call.findMany({
      where: { workspaceId: child.id, createdAt: { gte: since } },
      select: {
        durationSec: true,
        billedPaise: true,
        costTelephonyPaise: true,
        costSttPaise: true,
        costLlmPaise: true,
        costTtsPaise: true,
      },
    });
    const s = summarizeUsage({
      calls: calls.map((c) => ({
        durationSec: c.durationSec,
        billedPaise: c.billedPaise,
        wholesalePaise:
          c.costTelephonyPaise + c.costSttPaise + c.costLlmPaise + c.costTtsPaise,
      })),
    });
    rows.push({ workspaceId: child.id, name: child.name, slug: child.slug, ...s });
  }
  return rows;
}
