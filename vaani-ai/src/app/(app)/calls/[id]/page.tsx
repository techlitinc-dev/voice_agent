import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { recordingUrl } from "@/lib/storage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/money";
import { SentimentTimeline } from "@/components/sentiment-chart";
import { SentimentTranscript } from "@/components/sentiment-transcript";

export default async function CallDetailPage({ params }: { params: { id: string } }) {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const call = await db.call.findFirst({
    where: { id: params.id, workspaceId: ctx.workspaceId },
    include: {
      agent: { select: { name: true } },
      campaign: { select: { name: true } },
      events: { orderBy: { createdAt: "asc" }, take: 100 },
      qaScores: { orderBy: { createdAt: "desc" }, take: 1 },
      transcriptEntries: { orderBy: { timestampMs: "asc" } },
    },
  });
  if (!call) notFound();

  const qa = call.qaScores[0] ?? null;

  let audioUrl: string | null = null;
  if (call.recordingKey && !call.recordingKey.startsWith("pending:")) {
    audioUrl = await recordingUrl(call.recordingKey).catch(() => null);
  }

  const costRows = [
    ["Telephony (Vobiz)", call.costTelephonyPaise],
    ["Speech-to-text (Sarvam)", call.costSttPaise],
    ["LLM (OpenRouter)", call.costLlmPaise],
    ["Text-to-speech (Sarvam)", call.costTtsPaise],
  ] as const;
  const totalCost = costRows.reduce((a, [, v]) => a + v, 0);
  const marginPaise = call.billedPaise - totalCost;

  const entities =
    call.extractedEntities && typeof call.extractedEntities === "object" && !Array.isArray(call.extractedEntities)
      ? (call.extractedEntities as Record<string, unknown>)
      : null;

  const timeline =
    Array.isArray(call.sentimentTimeline)
      ? call.sentimentTimeline.filter(
          (p): p is { ts: number; score: number; label: string } =>
            typeof p === "object" &&
            p !== null &&
            typeof (p as { ts?: unknown }).ts === "number" &&
            typeof (p as { score?: unknown }).score === "number" &&
            typeof (p as { label?: unknown }).label === "string"
        )
      : [];

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/calls" className="text-sm text-muted-foreground hover:text-primary">← All calls</Link>
        <h1 className="text-xl font-bold font-mono">{call.fromNumber} → {call.toNumber}</h1>
        <span className="rounded-full border px-3 py-1 text-xs">{call.status}</span>
        <a href={`/calls/${call.id}/report`} data-testid="call-report-link"
          className="ml-auto rounded-md border border-border px-3 py-1 text-xs hover:border-primary/50">
          Print / PDF report
        </a>
      </div>

      {/* Quality flags row */}
      <div className="flex flex-wrap gap-2">
        {call.hallucinationFlag && (
          <span data-testid="call-hallucination-flag" title={call.hallucinationNotes ?? ""}
            className="rounded-full border border-red-500/50 bg-red-500/10 px-3 py-1 text-xs text-red-400">
            ⚠ Hallucination detected
          </span>
        )}
        {call.deadAirSeconds > 3 && (
          <span data-testid="call-deadair-flag"
            className="rounded-full border border-orange-500/50 bg-orange-500/10 px-3 py-1 text-xs text-orange-400">
            {call.deadAirSeconds}s dead air
          </span>
        )}
        {call.piiRedacted && (
          <span data-testid="call-pii-redacted"
            className="rounded-full border border-blue-500/50 bg-blue-500/10 px-3 py-1 text-xs text-blue-400">
            PII redacted
          </span>
        )}
        {qa && (
          <span data-testid="call-qa-score"
            className="rounded-full border border-primary/50 bg-primary/10 px-3 py-1 text-xs text-primary">
            QA {qa.totalScore}/{qa.maxScore} · {qa.rubricName}
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm" data-testid="call-details-card">
            <p>Direction: {call.direction}</p>
            <p>Agent: {call.agent?.name ?? "—"}</p>
            {call.campaign && <p>Campaign: {call.campaign.name}</p>}
            <p>Duration: {call.durationSec}s</p>
            <p>Disposition / outcome: {call.outcome ?? "—"}</p>
            <p>Sentiment: {call.sentiment ?? "—"}{call.sentimentTrend ? ` (${call.sentimentTrend})` : ""}</p>
            {call.interestScore && <p>Interest: {call.interestScore} — {call.interestReason ?? ""}</p>}
            <p>Dead air: {call.deadAirSeconds}s · Script adherence: {call.scriptAdherenceScore ?? "—"}</p>
            <p className="text-muted-foreground">{call.createdAt.toLocaleString("en-IN")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Unit economics</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm" data-testid="call-cost-card">
            {costRows.map(([label, v]) => (
              <p key={label} className="flex justify-between"><span className="text-muted-foreground">{label}</span><span>{formatINR(v)}</span></p>
            ))}
            <p className="flex justify-between border-t pt-1"><span>Wholesale cost</span><span>{formatINR(totalCost)}</span></p>
            <p className="flex justify-between font-semibold text-primary"><span>Billed to customer</span><span>{formatINR(call.billedPaise)}</span></p>
            <p className={`flex justify-between ${marginPaise >= 0 ? "text-green-400" : "text-red-400"}`}>
              <span>Margin</span><span>{formatINR(marginPaise)}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      {timeline.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Sentiment timeline
              {call.sentimentTrend ? <span className="ml-2 text-sm font-normal text-muted-foreground">({call.sentimentTrend})</span> : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SentimentTimeline timeline={timeline} />
          </CardContent>
        </Card>
      )}

      {call.summary && (
        <Card>
          <CardHeader><CardTitle>AI summary</CardTitle></CardHeader>

          <CardContent className="text-sm">{call.summary}</CardContent>
        </Card>
      )}

      {entities && Object.keys(entities).length > 0 && (
        <Card>
          <CardHeader><CardTitle>Extracted entities</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm" data-testid="call-entities">
              {Object.entries(entities).map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-border/40 py-1">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-mono text-xs">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      {audioUrl ? (
        <Card>
          <CardHeader><CardTitle>Recording</CardTitle></CardHeader>
          <CardContent>
            <audio controls src={audioUrl} className="w-full" data-testid="call-audio-player" />
            <p className="mt-1 text-xs text-muted-foreground">Link expires in 15 minutes.</p>
          </CardContent>
        </Card>
      ) : call.recordingKey?.startsWith("pending:") ? (
        <p className="text-sm text-muted-foreground">Recording is being ingested — refresh in a minute.</p>
      ) : null}

      {call.hallucinationFlag && call.hallucinationNotes && (
        <Card>
          <CardHeader><CardTitle className="text-red-400">Hallucination notes (QA)</CardTitle></CardHeader>
          <CardContent className="text-sm">{call.hallucinationNotes}</CardContent>
        </Card>
      )}

      {qa && (
        <Card>
          <CardHeader><CardTitle>QA auto-score — {qa.rubricName}</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm" data-testid="call-qa-detail">
            {Object.entries(qa.scores as Record<string, number>).map(([criterion, score]) => (
              <p key={criterion} className="flex justify-between">
                <span className="text-muted-foreground">{criterion}</span><span>{score}</span>
              </p>
            ))}
            <p className="flex justify-between border-t pt-1 font-semibold">
              <span>Total</span><span>{qa.totalScore}/{qa.maxScore}</span>
            </p>
            {qa.notes && <p className="pt-1 text-xs text-muted-foreground">{qa.notes}</p>}
            <p className="text-xs text-muted-foreground">Scored by {qa.scorerModel}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Transcript{call.piiRedacted ? " (PII redacted)" : ""}</CardTitle></CardHeader>
        <CardContent>
          <SentimentTranscript
            entries={call.transcriptEntries.map((t) => ({
              id: t.id,
              speaker: t.speaker,
              text: t.text,
              timestampMs: t.timestampMs,
              sentiment: t.sentiment ?? null,
              sentimentScore: t.sentimentScore ?? null,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Event timeline ({call.events.length})</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs text-muted-foreground">
          {call.events.map((e) => (
            <p key={e.id}>
              <span className="font-mono">{e.createdAt.toLocaleTimeString("en-IN")}</span>{" "}
              <span className="text-foreground">{e.type}</span>
            </p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
