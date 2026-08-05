/**
 * GDPR request processor (spec §11). Drains PENDING GdprRequest rows.
 * EXPORT  → JSON bundle (calls + transcript entries + contacts, optionally filtered
 *           to one subject phone) into MinIO; resultKey on the request row.
 * ERASURE → for the subject phone: delete recordings (MinIO), transcripts,
 *           transcript entries, summaries, entities; anonymize numbers; delete the
 *           Contact row; add a MANUAL DncEntry so we never dial them again.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { deleteObject, putJsonObject } from "../lib/storage";

const db = new PrismaClient();
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function processExport(requestId: string): Promise<void> {
  const req = await db.gdprRequest.findUniqueOrThrow({ where: { id: requestId } });
  const callFilter = req.subjectPhone
    ? { OR: [{ fromNumber: req.subjectPhone }, { toNumber: req.subjectPhone }] }
    : {};

  const calls = await db.call.findMany({
    where: { workspaceId: req.workspaceId, ...callFilter },
    include: { transcriptEntries: { orderBy: { timestampMs: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  const contacts = await db.contact.findMany({
    where: { workspaceId: req.workspaceId, ...(req.subjectPhone ? { phone: req.subjectPhone } : {}) },
  });

  const bundle = {
    type: "vaani-gdpr-export",
    version: 1,
    generatedAt: new Date().toISOString(),
    workspaceId: req.workspaceId,
    subjectPhone: req.subjectPhone,
    calls: calls.map((c) => ({
      id: c.id, direction: c.direction, status: c.status, fromNumber: c.fromNumber,
      toNumber: c.toNumber, createdAt: c.createdAt, durationSec: c.durationSec,
      outcome: c.outcome, sentiment: c.sentiment, summary: c.summary,
      transcript: c.transcript,
      transcriptEntries: c.transcriptEntries.map((t) => ({ speaker: t.speaker, text: t.text, timestampMs: t.timestampMs })),
    })),
    contacts,
  };

  const key = `gdpr-exports/${req.workspaceId}/${req.id}.json`;
  await putJsonObject(key, bundle);
  await db.gdprRequest.update({
    where: { id: req.id },
    data: { status: "COMPLETED", resultKey: key, completedAt: new Date() },
  });
  log(`[gdpr] export ${req.id} -> ${key} (${calls.length} calls, ${contacts.length} contacts)`);
}

async function processErasure(requestId: string): Promise<void> {
  const req = await db.gdprRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (!req.subjectPhone) throw new Error("erasure requires subjectPhone");
  const phone = req.subjectPhone;
  const erased = `erased-${req.id.slice(0, 8)}`;

  const calls = await db.call.findMany({
    where: { workspaceId: req.workspaceId, OR: [{ fromNumber: phone }, { toNumber: phone }] },
    select: { id: true, recordingKey: true },
  });

  for (const call of calls) {
    if (call.recordingKey && !call.recordingKey.startsWith("pending:")) {
      await deleteObject(call.recordingKey);
    }
    await db.transcriptEntry.deleteMany({ where: { callId: call.id } });
    await db.call.update({
      where: { id: call.id },
      data: {
        recordingKey: null,
        transcript: null,
        summary: null,
        extractedEntities: Prisma.JsonNull, // entities may contain the caller's name etc.
        fromNumber: erased,
        toNumber: erased,
      },
    });
  }
  // Voicemail artifacts for the subject.
  await db.voicemailMessage.deleteMany({ where: { workspaceId: req.workspaceId, fromNumber: phone } });
  // Contact row + future-dial protection.
  await db.contact.deleteMany({ where: { workspaceId: req.workspaceId, phone } });
  await db.dncEntry.upsert({
    where: { workspaceId_phone: { workspaceId: req.workspaceId, phone } },
    update: {},
    create: { workspaceId: req.workspaceId, phone, source: "MANUAL", reason: `GDPR erasure ${req.id}` },
  });
  await db.auditLog.create({
    data: { workspaceId: req.workspaceId, action: "gdpr.erasure_completed", entity: "GdprRequest", entityId: req.id, metadata: { subjectPhone: phone, callsErased: calls.length } },
  });
  await db.gdprRequest.update({ where: { id: req.id }, data: { status: "COMPLETED", completedAt: new Date() } });
  log(`[gdpr] erasure ${req.id}: ${calls.length} call(s) anonymized for ${phone}`);
}

export async function gdprSweep(take = 5): Promise<number> {
  const pending = await db.gdprRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take,
  });
  let done = 0;
  for (const req of pending) {
    await db.gdprRequest.update({ where: { id: req.id }, data: { status: "PROCESSING" } });
    try {
      if (req.type === "EXPORT") await processExport(req.id);
      else await processErasure(req.id);
      done += 1;
    } catch (e) {
      console.error(`[gdpr] request ${req.id} failed`, e);
      await db.gdprRequest.update({ where: { id: req.id }, data: { status: "PENDING" } }); // retry next sweep
    }
  }
  return done;
}
