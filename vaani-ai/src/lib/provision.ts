import { db } from "./db";

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * One transaction: user + workspace + OWNER membership + 14-day starter trial +
 * wallet with ₹1,000 (100000 paise) trial credit. Used by email/password register
 * and by Google SSO first-login auto-provisioning.
 */
export async function provisionUserWithWorkspace(input: {
  fullName: string;
  email: string;
  passwordHash: string;
  businessName: string;
}) {
  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { fullName: input.fullName, email: input.email, passwordHash: input.passwordHash },
    });
    const workspace = await tx.workspace.create({
      data: { name: input.businessName, slug: slugify(input.businessName) },
    });
    await tx.membership.create({
      data: { userId: user.id, workspaceId: workspace.id, role: "OWNER" },
    });
    const starter = await tx.plan.findUnique({ where: { code: "starter" } });
    if (starter) {
      await tx.subscription.create({
        data: {
          workspaceId: workspace.id,
          planId: starter.id,
          status: "active",
          currentPeriodEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14-day trial
        },
      });
    }
    const wallet = await tx.wallet.create({
      data: { workspaceId: workspace.id, balancePaise: 0 },
    });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "TRIAL_CREDIT",
        amountPaise: 100000, // ₹1,000 trial credit
        balanceAfterPaise: 100000,
        note: "Welcome trial credit",
      },
    });
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balancePaise: 100000 },
    });
    // Free trial (spec §10): 30 trial minutes, 14 days, KYC-gated (guide 09).
    await tx.trialState.create({
      data: {
        workspaceId: workspace.id,
        trialMinutesLimit: 30,
        kycStatus: "NOT_STARTED",
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });
    return { user, workspace };
  });
}
