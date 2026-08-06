/**
 * Billing cron (worker process) + CLI:
 *   tsx src/worker/billing.ts rentals|addons|planfees|autotopup|invoices [--dry-run]
 *   tsx src/worker/billing.ts invoice <workspaceSlug>     # current month, one workspace
 *   tsx src/worker/billing.ts rollup <parentSlug>         # reseller rollup JSON (30d)
 * Schedules live in src/worker/index.ts (monthly 1st 03:15/04:30; sweep every 15 min).
 */
import { db } from "../lib/db";
import { debitWallet } from "../lib/billing";
import { runAutoTopUpSweep } from "../lib/autotopup";
import { generateMonthlyInvoice } from "../lib/invoice";
import { childUsageRollup } from "../lib/reseller";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

/** "202601" for Jan 2026 — idempotency key component for monthly charges. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Monthly DID rental passthrough with margin (spec §10). */
export async function chargeMonthlyRentals(now = new Date(), dryRun = false): Promise<number> {
  const rentals = await db.numberRental.findMany({
    where: { status: "ACTIVE" },
    include: { phoneNumber: { select: { number: true, monthlyRentPaise: true } } },
  });
  let charged = 0;
  for (const r of rentals) {
    const amount = r.monthlyPricePaise > 0 ? r.monthlyPricePaise : r.phoneNumber.monthlyRentPaise;
    if (amount <= 0) continue;
    const ref = `rent-${r.id}-${monthKey(now)}`;
    if (dryRun) {
      log(`[dry-run] would debit ${amount} paise from workspace ${r.workspaceId} (${ref})`);
      charged++;
      continue;
    }
    const res = await debitWallet({
      workspaceId: r.workspaceId,
      amountPaise: amount,
      type: "NUMBER_RENT",
      reference: ref,
      note: `Number rental ${r.phoneNumber.number} (${monthKey(now)})`,
    });
    if (!res.skipped) charged++;
  }
  log(`[billing] rentals ${dryRun ? "dry-run" : "charged"}: ${charged}`);
  return charged;
}

/** Monthly recurring add-on fees (spec §10). */
export async function chargeMonthlyAddOns(now = new Date(), dryRun = false): Promise<number> {
  const purchases = await db.addOnPurchase.findMany({ where: { active: true } });
  let charged = 0;
  for (const p of purchases) {
    const ref = `addon-${p.id}-${monthKey(now)}`;
    if (dryRun) {
      log(`[dry-run] would debit ${p.monthlyPricePaise} paise (${ref})`);
      charged++;
      continue;
    }
    const res = await debitWallet({
      workspaceId: p.workspaceId,
      amountPaise: p.monthlyPricePaise,
      type: "ADDON_DEBIT",
      reference: ref,
      note: `Add-on ${p.code} (${monthKey(now)})`,
    });
    if (!res.skipped) charged++;
  }
  log(`[billing] add-ons ${dryRun ? "dry-run" : "charged"}: ${charged}`);
  return charged;
}

/** Monthly subscription plan fees for active subscriptions. */
export async function chargeMonthlyPlanFees(now = new Date(), dryRun = false): Promise<number> {
  const subs = await db.subscription.findMany({
    where: { status: "active" },
    include: { plan: true },
  });
  let charged = 0;
  for (const s of subs) {
    if (s.plan.monthlyPricePaise <= 0) continue;
    const ref = `plan-${s.id}-${monthKey(now)}`;
    if (dryRun) {
      log(`[dry-run] would debit ${s.plan.monthlyPricePaise} paise (${ref})`);
      charged++;
      continue;
    }
    const res = await debitWallet({
      workspaceId: s.workspaceId,
      amountPaise: s.plan.monthlyPricePaise,
      type: "PLAN_FEE",
      reference: ref,
      note: `Plan: ${s.plan.name} (${monthKey(now)})`,
    });
    if (!res.skipped) charged++;
  }
  log(`[billing] plan fees ${dryRun ? "dry-run" : "charged"}: ${charged}`);
  return charged;
}

/** Generate last month's GST invoice for every workspace that has debits. */
export async function generateAllMonthlyInvoices(now = new Date()): Promise<number> {
  const month = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const workspaces = await db.workspace.findMany({ select: { id: true } });
  let made = 0;
  for (const ws of workspaces) {
    const r = await generateMonthlyInvoice(ws.id, month);
    if (r) {
      made++;
      log(`[billing] invoice ${r.invoiceNumber} for workspace ${ws.id}`);
    }
  }
  log(`[billing] monthly invoices generated: ${made}`);
  return made;
}

// ---------- CLI (used by guide 09 Step 16 tests and by operators) ----------

async function cli() {
  const [cmd, ...args] = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((a) => a !== "--dry-run");
  try {
    if (cmd === "rentals") await chargeMonthlyRentals(new Date(), dryRun);
    else if (cmd === "addons") await chargeMonthlyAddOns(new Date(), dryRun);
    else if (cmd === "planfees") await chargeMonthlyPlanFees(new Date(), dryRun);
    else if (cmd === "autotopup") await runAutoTopUpSweep();
    else if (cmd === "invoices") await generateAllMonthlyInvoices();
    else if (cmd === "invoice") {
      const ws = await db.workspace.findUnique({ where: { slug: positional[0] } });
      if (!ws) throw new Error(`no workspace with slug ${positional[0]}`);
      const r = await generateMonthlyInvoice(ws.id, new Date());
      console.log(JSON.stringify(r));
    } else if (cmd === "rollup") {
      const ws = await db.workspace.findUnique({ where: { slug: positional[0] } });
      if (!ws) throw new Error(`no workspace with slug ${positional[0]}`);
      const rows = await childUsageRollup(ws.id, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
      console.log(JSON.stringify(rows, null, 2));
    } else {
      console.log("usage: tsx src/worker/billing.ts rentals|addons|planfees|autotopup|invoices|invoice <slug>|rollup <slug> [--dry-run]");
    }
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  cli().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
