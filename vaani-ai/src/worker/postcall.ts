/**
 * Post-call processing sweep (QA auto-scoring, dead-air, PII redaction).
 * Idempotent: a call is "processed" iff a QaScore row exists for it.
 */
import { PrismaClient } from "@prisma/client";
import { redactPii } from "../lib/pii";
import { computeDeadAirSeconds } from "../lib/qa/deadair";
import { rubricForCall } from "../lib/qa/rubrics";
import { scoreWithLlm } from "../lib/qa/scorer";
import { classifyEmotion, summarizeSentiment, avgScore, overallLabel, type SentimentPoint } from "../lib/sentiment";

const db = new PrismaClient();
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

export async function postCallSweep(take = 5): Promise<number> {
  // Completed calls with a transcript and NO QaScore yet.
  const calls = await db.call.findMany({
    where: {
      status: "COMPLETED",
      transcript: { not: null },
      qaScores: { none: {} },
    },
    include: {
      transcriptEntries: { orderBy: { timestampMs: "asc" }, select: { id: true, speaker: true, timestampMs: true, text: true } },
    },
    orderBy: { endedAt: "asc" },
    take,
  });

  let processed = 0;
  for (const call of calls) {
    try {
      // 1) PII redaction (in-place) — transcript + transcript entries.
      if (!call.piiRedacted && call.transcript) {
        const r = redactPii(call.transcript);
        if (r.findings.length > 0) {
          await db.call.update({ where: { id: call.id }, data: { transcript: r.redacted } });
          for (const entry of call.transcriptEntries) {
            const er = redactPii(entry.text);
            if (er.findings.length > 0) {
              await db.transcriptEntry.updateMany({
                where: { callId: call.id, timestampMs: entry.timestampMs },
                data: { text: er.redacted },
              });
            }
          }
          await db.auditLog.create({
            data: {
              workspaceId: call.workspaceId,
              action: "pii.redacted",
              entity: "Call",
              entityId: call.id,
              metadata: { findings: r.findings },
            },
          });
        }
        await db.call.update({ where: { id: call.id }, data: { piiRedacted: true } });
      }

      // 2) Dead air from transcript-entry timing gaps.
      const deadAir = computeDeadAirSeconds(call.transcriptEntries);
      if (deadAir !== call.deadAirSeconds) {
        await db.call.update({ where: { id: call.id }, data: { deadAirSeconds: deadAir } });
      }

      // 3) Sentiment & emotion (docs/new-features/02): classify each CALLER turn,
      //    then store the per-turn labels + call timeline/trend.
      const callerEntries = call.transcriptEntries.filter((e) => e.speaker === "CALLER");
      const timeline: SentimentPoint[] = [];
      for (const entry of callerEntries) {
        const r = await classifyEmotion(entry.text);
        await db.transcriptEntry.update({
          where: { id: entry.id },
          data: { sentiment: r.label, sentimentScore: r.score },
        });
        timeline.push({ ts: entry.timestampMs, score: r.score, label: r.label });
      }
      if (timeline.length > 0) {
        const { overall, trend } = summarizeSentiment(timeline);
        await db.call.update({
          where: { id: call.id },
          data: { sentiment: overall, sentimentTimeline: timeline, sentimentTrend: trend },
        });
      }

      // 4) QA score on the (possibly redacted) transcript. QA integration
      //    (docs/new-features/02 §4): a call that ends with NEGATIVE caller
      //    sentiment gets an automatic CSAT penalty — capped at -20% so a single
      //    unhappy caller can never zero out an otherwise good score.
      const fresh = await db.call.findUnique({ where: { id: call.id }, select: { transcript: true } });
      const rubric = rubricForCall(call.direction);
      const qa = await scoreWithLlm(rubric, fresh?.transcript ?? "");
      const overall = overallLabel(avgScore(timeline));
      const sentimentPenalty = overall === "negative" ? 20 : 0;
      const rawPercent = qa.maxScore > 0 ? Math.round((qa.totalScore / qa.maxScore) * 100) : 0;
      const qaPercent = Math.max(0, rawPercent - sentimentPenalty);
      const notes = [
        qa.notes,
        ...(sentimentPenalty > 0 ? [`-${sentimentPenalty}% CSAT penalty (negative caller sentiment)`] : []),
      ].filter(Boolean).join(" ");

      await db.qaScore.create({
        data: {
          workspaceId: call.workspaceId,
          callId: call.id,
          rubricName: rubric.name,
          scores: qa.scores,
          totalScore: qa.totalScore,
          maxScore: qa.maxScore,
          scorerModel: process.env.QA_DRY_RUN !== "false"
            ? "dry-run-mock"
            : process.env.QA_SCORER_MODEL ?? "meta-llama/llama-3.1-8b-instruct",
          notes,
        },
      });
      await db.call.update({
        where: { id: call.id },
        data: {
          scriptAdherenceScore: qaPercent,
          ...(qa.hallucination
            ? { hallucinationFlag: true, hallucinationNotes: qa.hallucinationNotes ?? "flagged by QA scorer" }
            : {}),
        },
      });

      processed += 1;
      log(`[postcall] scored ${call.id} rubric=${rubric.name} total=${qa.totalScore}/${qa.maxScore} deadAir=${deadAir}s hallucination=${qa.hallucination} sentiment=${timeline.length} turns overall=${overall} penalty=${sentimentPenalty}%`);
    } catch (e) {
      // A failure (e.g. OpenRouter down) leaves the call without a QaScore, so the
      // next sweep retries it automatically. No poison-row handling needed in v1.
      console.error(`[postcall] failed for ${call.id}`, e);
    }
  }
  return processed;
}
