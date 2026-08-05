/**
 * KB re-index worker. Run: npm run worker:kb
 * Every 15 minutes: re-fetch due URL documents, bump their schedule.
 * Idempotent and safe to run alongside the campaign worker.
 */
import cron from "node-cron";
import { db } from "../lib/db";
import { fetchUrlText, pushToDograhKnowledgeBase } from "../lib/knowledge";

const TICK = "*/15 * * * *";

export async function reindexDue(): Promise<number> {
  const due = await db.knowledgeDocument.findMany({
    where: { type: "URL", status: { not: "INDEXING" }, nextReindexAt: { lte: new Date() } },
    take: 25,
  });
  let done = 0;
  for (const doc of due) {
    await db.knowledgeDocument.update({ where: { id: doc.id }, data: { status: "INDEXING" } });
    try {
      const text = doc.sourceUrl ? await fetchUrlText(doc.sourceUrl) : "";
      const push = await pushToDograhKnowledgeBase(doc); // OPERATOR GATE — no-op today
      const hours = doc.reindexIntervalHours;
      await db.knowledgeDocument.update({
        where: { id: doc.id },
        data: {
          contentText: text || doc.contentText,
          status: "INDEXED",
          lastIndexedAt: new Date(),
          error: push.pushed ? null : doc.error, // gate: keep prior error, don't fail the doc
          nextReindexAt: hours ? new Date(Date.now() + hours * 3600 * 1000) : null,
        },
      });
      done++;
    } catch (err) {
      await db.knowledgeDocument.update({
        where: { id: doc.id },
        data: {
          status: "FAILED",
          error: err instanceof Error ? err.message.slice(0, 400) : "reindex failed",
          nextReindexAt: doc.reindexIntervalHours
            ? new Date(Date.now() + doc.reindexIntervalHours * 3600 * 1000)
            : null,
        },
      });
    }
  }
  return done;
}

if (require.main === module) {
  console.log(`[kb-reindex] starting, schedule "${TICK}"`);
  cron.schedule(TICK, async () => {
    try {
      const n = await reindexDue();
      if (n > 0) console.log(`[kb-reindex] re-indexed ${n} document(s)`);
    } catch (e) {
      console.error("[kb-reindex] tick failed:", e);
    }
  });
}
