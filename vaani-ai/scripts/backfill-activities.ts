/**
 * One-time backfill (guide crm/01 §3.3): create an Activity row for every call
 * that has none yet, and link it back via Call.activityId. Idempotent — re-runs
 * only touch calls still missing an activity.
 *
 * Run: npx tsx scripts/backfill-activities.ts
 */
import { db } from "../src/lib/db";

async function backfill() {
  const calls = await db.call.findMany({
    where: { activityId: null },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  let created = 0;
  for (const call of calls) {
    // Resolve the contact for this call: inbound → caller (fromNumber),
    // outbound → callee (toNumber).
    const phone = call.direction === "INBOUND" ? call.fromNumber : call.toNumber;
    const contact = phone
      ? await db.contact.findFirst({
          where: { workspaceId: call.workspaceId, phone },
          select: { id: true },
        })
      : null;

    const type = call.direction === "INBOUND" ? "CALL_INBOUND" : "CALL_OUTBOUND";
    const activity = await db.activity.create({
      data: {
        workspaceId: call.workspaceId,
        contactId: contact?.id ?? null,
        type,
        title: `Call ${call.direction.toLowerCase()} (${call.durationSec}s)`,
        description: call.summary,
        metadata: { callId: call.id, durationSec: call.durationSec, outcome: call.outcome },
        callId: call.id,
        createdAt: call.startedAt,
      },
    });
    await db.call.update({
      where: { id: call.id },
      data: { activityId: activity.id },
    });
    created += 1;
  }

  console.log(`[backfill-activities] created ${created} activity(ies) from ${calls.length} call(s) scanned`);
}

backfill()
  .catch((e) => {
    console.error("[backfill-activities] failed", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
