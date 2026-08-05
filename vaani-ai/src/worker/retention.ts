/**
 * Nightly retention enforcer (spec §11). For each workspace with an auto-delete
 * RetentionPolicy: delete MinIO recordings older than recordingsDays and null out
 * transcripts (and their TranscriptEntry rows) older than transcriptsDays.
 * Every deletion is AuditLog'd. RETENTION_DRY_RUN=true logs without deleting.
 */
import { PrismaClient } from "@prisma/client";
import { cutoffDate } from "../lib/retention";
import { deleteObject } from "../lib/storage";

const db = new PrismaClient();
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

export async function enforceRetention(now = new Date()): Promise<{ recordings: number; transcripts: number }> {
  const dryRun = process.env.RETENTION_DRY_RUN !== "false";
  const policies = await db.retentionPolicy.findMany({ where: { autoDelete: true } });
  let recordings = 0;
  let transcripts = 0;

  for (const policy of policies) {
    // --- Recordings ---
    const recCutoff = cutoffDate(now, policy.recordingsDays);
    const oldRecordings = await db.call.findMany({
      where: { workspaceId: policy.workspaceId, createdAt: { lt: recCutoff }, recordingKey: { not: null } },
      select: { id: true, recordingKey: true },
      take: 200,
    });
    for (const call of oldRecordings) {
      const key = call.recordingKey!;
      if (key.startsWith("pending:")) continue; // never ingested — leave for the sweeper
      if (dryRun) {
        log(`[retention] DRY RUN would delete recording ${key} (call ${call.id})`);
      } else {
        await deleteObject(key);
        await db.call.update({ where: { id: call.id }, data: { recordingKey: null } });
        await db.auditLog.create({
          data: { workspaceId: policy.workspaceId, action: "retention.recording_deleted", entity: "Call", entityId: call.id, metadata: { key } },
        });
      }
      recordings += 1;
    }

    // --- Transcripts ---
    const tsCutoff = cutoffDate(now, policy.transcriptsDays);
    const oldTranscripts = await db.call.findMany({
      where: {
        workspaceId: policy.workspaceId,
        createdAt: { lt: tsCutoff },
        OR: [{ transcript: { not: null } }, { transcriptEntries: { some: {} } }],
      },
      select: { id: true },
      take: 200,
    });
    for (const call of oldTranscripts) {
      if (dryRun) {
        log(`[retention] DRY RUN would erase transcript of call ${call.id}`);
      } else {
        await db.transcriptEntry.deleteMany({ where: { callId: call.id } });
        await db.call.update({
          where: { id: call.id },
          data: { transcript: null, summary: null },
        });
        await db.auditLog.create({
          data: { workspaceId: policy.workspaceId, action: "retention.transcript_erased", entity: "Call", entityId: call.id },
        });
      }
      transcripts += 1;
    }
  }
  log(`[retention] done (dryRun=${dryRun}): ${recordings} recording(s), ${transcripts} transcript(s)`);
  return { recordings, transcripts };
}
