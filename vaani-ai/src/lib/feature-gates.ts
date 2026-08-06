import { db } from "./db";
import { addonGateEffect } from "./addons";

export interface PlanGateFields {
  code: string;
  maxAgents: number;
  maxSeats: number;
  concurrentLines: number;
  whiteLabel: boolean;
  premiumVoices: boolean;
  dedicatedInfra: boolean;
  featureGates: unknown;
}

/** No active subscription → starter-equivalent limits (matches seed). */
export const STARTER_DEFAULTS: PlanGateFields = {
  code: "starter",
  maxAgents: 2,
  maxSeats: 2,
  concurrentLines: 2,
  whiteLabel: false,
  premiumVoices: false,
  dedicatedInfra: false,
  featureGates: null,
};

export interface GateResult {
  gate: string;
  allowed: boolean;
  limit: number | null; // numeric gates: effective limit (plan + add-on bonus)
  used: number | null;
  planCode: string;
  source: "plan" | "addon" | "default";
}

const NUMERIC_GATES = ["maxAgents", "maxSeats", "concurrentLines"] as const;
const FLAG_GATES = ["whiteLabel", "premiumVoices", "dedicatedInfra"] as const;

/**
 * Pure gate evaluation (unit-tested). Gates:
 * - numeric plan limits (maxAgents / maxSeats / concurrentLines): allowed when
 *   used < limit; active "counter" add-ons raise the limit;
 * - boolean plan features (whiteLabel / premiumVoices / dedicatedInfra): plan flag
 *   OR active "flag" add-on;
 * - any other key: looked up in Plan.featureGates JSON (e.g. "qa_scoring",
 *   "api_access", "reseller_panel") — allowed only when explicitly true.
 */
export function evaluateGate(args: {
  plan: PlanGateFields | null;
  activeAddOns: string[];
  gate: string;
  used?: number;
}): GateResult {
  const plan = args.plan ?? STARTER_DEFAULTS;
  const effect = addonGateEffect(args.activeAddOns, args.gate);

  if ((NUMERIC_GATES as readonly string[]).includes(args.gate)) {
    const key = args.gate as (typeof NUMERIC_GATES)[number];
    const limit = plan[key] + effect.limitBonus;
    const used = args.used ?? 0;
    return {
      gate: args.gate,
      allowed: used < limit,
      limit,
      used,
      planCode: plan.code,
      source: effect.limitBonus > 0 ? "addon" : "plan",
    };
  }

  if ((FLAG_GATES as readonly string[]).includes(args.gate)) {
    const key = args.gate as (typeof FLAG_GATES)[number];
    const allowed = plan[key] || effect.flag;
    return {
      gate: args.gate,
      allowed,
      limit: null,
      used: null,
      planCode: plan.code,
      source: plan[key] ? "plan" : effect.flag ? "addon" : "default",
    };
  }

  const gates =
    plan.featureGates && typeof plan.featureGates === "object"
      ? (plan.featureGates as Record<string, unknown>)
      : {};
  return {
    gate: args.gate,
    allowed: gates[args.gate] === true,
    limit: null,
    used: null,
    planCode: plan.code,
    source: "default",
  };
}

/**
 * The exported contract for other guides. Examples:
 *   const g = await checkFeatureGate(workspaceId, "maxAgents", currentAgentCount);
 *   const g = await checkFeatureGate(workspaceId, "concurrentLines", activeCalls);
 *   const g = await checkFeatureGate(workspaceId, "premiumVoices");
 */
export async function checkFeatureGate(
  workspaceId: string,
  gate: string,
  used?: number
): Promise<GateResult> {
  const [sub, addOns] = await Promise.all([
    db.subscription.findUnique({ where: { workspaceId }, include: { plan: true } }),
    db.addOnPurchase.findMany({
      where: { workspaceId, active: true },
      select: { code: true },
    }),
  ]);
  const plan = sub && sub.status === "active" ? sub.plan : null;
  return evaluateGate({
    plan,
    activeAddOns: addOns.map((a) => a.code),
    gate,
    used,
  });
}

/** Throwing variant — Error("PLAN_GATE:<gate>") when not allowed. */
export async function assertFeatureGate(
  workspaceId: string,
  gate: string,
  used?: number
): Promise<GateResult> {
  const result = await checkFeatureGate(workspaceId, gate, used);
  if (!result.allowed) throw new Error(`PLAN_GATE:${gate}`);
  return result;
}
