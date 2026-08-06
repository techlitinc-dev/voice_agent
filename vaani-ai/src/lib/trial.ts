import { db } from "./db";
import type { TrialState } from "@prisma/client";

export const TRIAL_MINUTES_LIMIT = 30;
export const TRIAL_DAYS = 14;

/** Regulated India number series that require KYC before purchase (spec §10/§13). */
export const REGULATED_NUMBER_TYPES = ["SERIES_140", "SERIES_1600"] as const;

/**
 * Provision the free trial for a new workspace: 30 trial minutes, 14-day expiry,
 * KYC NOT_STARTED, no sandbox number yet (the sandbox DID is assigned lazily by
 * the onboarding wizard — guide 10 — which sets TrialState.sandboxNumberId).
 * Idempotent upsert. Called by guide 03's provisioning (patch below).
 */
export async function provisionTrial(workspaceId: string): Promise<TrialState> {
  return db.trialState.upsert({
    where: { workspaceId },
    update: {},
    create: {
      workspaceId,
      trialMinutesLimit: TRIAL_MINUTES_LIMIT,
      kycStatus: "NOT_STARTED",
      expiresAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
    },
  });
}

/** Remaining trial minutes (pure, unit-tested). 0 when expired or exhausted. */
export function trialMinutesRemaining(
  trial: { trialMinutesUsed: number; trialMinutesLimit: number; expiresAt: Date | null },
  now: Date
): number {
  if (trial.expiresAt !== null && trial.expiresAt.getTime() <= now.getTime()) return 0;
  return Math.max(0, trial.trialMinutesLimit - trial.trialMinutesUsed);
}

/**
 * KYC gate for regulated number purchase (pure, unit-tested).
 * Returns an error message to show the user, or null when purchase is allowed.
 */
export function kycGateError(numberType: string, kycStatus: string | null): string | null {
  if (!(REGULATED_NUMBER_TYPES as readonly string[]).includes(numberType)) return null;
  if (kycStatus === "VERIFIED") return null;
  return "KYC verification is required before buying 140/1600-series numbers. Complete KYC in Settings → KYC.";
}

/** Is this workspace KYC-verified? */
export async function isKycVerified(workspaceId: string): Promise<boolean> {
  const trial = await db.trialState.findUnique({ where: { workspaceId } });
  return trial?.kycStatus === "VERIFIED";
}
