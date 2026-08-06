/**
 * E2E-only: seed one in-progress LIVE call + one QUEUED transfer request in the
 * demo-clinic workspace so the live-ops spec has deterministic rows.
 * Usage: npx tsx scripts/e2e-seed-live.ts   (idempotent: deletes then recreates)
 */
import "../src/lib/db";
import { db } from "../src/lib/db";

async function main() {
  const ws = await db.workspace.findUniqueOrThrow({ where: { slug: "demo-clinic" } });

  await db.liveCallState.deleteMany({ where: { workspaceId: ws.id } });
  await db.transferRequest.deleteMany({ where: { workspaceId: ws.id } });
  await db.call.deleteMany({ where: { workspaceId: ws.id, dograhCallId: { startsWith: "e2e_live_" } } });

  const call = await db.call.create({
    data: {
      workspaceId: ws.id,
      dograhCallId: "e2e_live_1",
      direction: "INBOUND",
      status: "IN_PROGRESS",
      fromNumber: "+919811112222",
      toNumber: "+918040001234",
      transcript: "AI: Namaste! Demo Dental Clinic.\nCaller: I need a cleaning appointment.",
    },
  });
  await db.liveCallState.create({
    data: {
      workspaceId: ws.id,
      callId: call.id,
      status: "IN_PROGRESS",
      liveTranscript: "Caller: I need a cleaning appointment.",
    },
  });
  await db.transferRequest.create({
    data: {
      workspaceId: ws.id,
      callId: call.id,
      queue: "support",
      status: "QUEUED",
      reason: "caller asked for a human",
      contextSnapshot: { transcript: call.transcript, summary: "Wants a cleaning appointment" },
    },
  });
  console.log(`seeded live call ${call.id} + 1 transfer request`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
