import { db } from "./db";
import { SPAM_PREFIXES } from "@/config/spamPrefixes";

export const RAPID_REPEAT_WINDOW_MIN = 10;
export const RAPID_REPEAT_MAX_CALLS = 3;

export type SpamReason = "manual-block" | "spam-prefix" | "rapid-repeat";
export type SpamVerdict = { spam: boolean; reason?: SpamReason };

/** Pure classifier — unit-tested directly. */
export function classifySpam(input: {
  phone: string;
  manualBlocked: boolean;
  recentCalls: number;
  maxCallsPerWindow: number;
  prefixes: string[];
}): SpamVerdict {
  if (input.manualBlocked) return { spam: true, reason: "manual-block" };
  if (input.prefixes.some((p) => p.length > 0 && input.phone.startsWith(p))) {
    return { spam: true, reason: "spam-prefix" };
  }
  if (input.recentCalls > input.maxCallsPerWindow) return { spam: true, reason: "rapid-repeat" };
  return { spam: false };
}

/** DB-backed check used by the resolver. Never throws — fail OPEN (do not block
 *  legitimate callers because of our own errors). */
export async function checkInboundSpam(workspaceId: string, phone: string): Promise<SpamVerdict> {
  try {
    const since = new Date(Date.now() - RAPID_REPEAT_WINDOW_MIN * 60_000);
    const [manual, recentCalls] = await Promise.all([
      db.dncEntry.findUnique({
        where: { workspaceId_phone: { workspaceId, phone } },
        select: { source: true },
      }),
      db.call.count({
        where: { workspaceId, fromNumber: phone, direction: "INBOUND", createdAt: { gte: since } },
      }),
    ]);
    return classifySpam({
      phone,
      manualBlocked: manual?.source === "MANUAL",
      recentCalls,
      maxCallsPerWindow: RAPID_REPEAT_MAX_CALLS,
      prefixes: SPAM_PREFIXES,
    });
  } catch (e) {
    console.error("spam check failed, failing open", e);
    return { spam: false };
  }
}
