import { z } from "zod";

/** Config stored on AgentToolConfig.config where tool = HUMAN_TRANSFER. */
export const humanTransferConfigSchema = z.object({
  queue: z.string().min(1).default("support"),
  skill: z.string().min(1).optional(),
  vipNumbers: z.array(z.string()).default([]),
  queueDestinations: z.record(z.string()).default({}),
  autoTransfer: z
    .object({
      onExplicitRequest: z.boolean().default(true),
      onRepeatedMisunderstanding: z.boolean().default(true),
      onLowConfidence: z.boolean().default(false),
      onVip: z.boolean().default(true),
    })
    .default({}),
  maxMisunderstandings: z.number().int().min(1).default(3),
});

export type HumanTransferConfig = z.infer<typeof humanTransferConfigSchema>;

/** Parse unknown JSON from the DB; invalid/missing → safe defaults. Never throws. */
export function parseHumanTransferConfig(raw: unknown): HumanTransferConfig {
  const parsed = humanTransferConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : humanTransferConfigSchema.parse({});
}

export type FallbackSignals = {
  callerPhone: string;
  explicitHumanRequest?: boolean;
  misunderstandingCount?: number;
  lowConfidence?: boolean;
};

export type TransferReason = "vip" | "explicit-request" | "repeated-misunderstanding" | "low-confidence";
export type TransferDecision = {
  transfer: boolean;
  reason?: TransferReason;
  queue: string;
  skill?: string;
};

/**
 * Decide whether a call should be transferred to a human.
 * Priority: VIP > explicit request > repeated misunderstanding > low confidence.
 */
export function decideTransfer(config: HumanTransferConfig, signals: FallbackSignals): TransferDecision {
  const base = { queue: config.queue, skill: config.skill };
  if (config.autoTransfer.onVip && config.vipNumbers.includes(signals.callerPhone)) {
    return { transfer: true, reason: "vip", ...base };
  }
  if (config.autoTransfer.onExplicitRequest && signals.explicitHumanRequest) {
    return { transfer: true, reason: "explicit-request", ...base };
  }
  if (
    config.autoTransfer.onRepeatedMisunderstanding &&
    (signals.misunderstandingCount ?? 0) >= config.maxMisunderstandings
  ) {
    return { transfer: true, reason: "repeated-misunderstanding", ...base };
  }
  if (config.autoTransfer.onLowConfidence && signals.lowConfidence) {
    return { transfer: true, reason: "low-confidence", ...base };
  }
  return { transfer: false, ...base };
}
