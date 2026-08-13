# 02 — Sentiment & Emotion Analytics

> **What**: Track caller sentiment per transcript turn, visualize emotional arc
> of calls, and aggregate sentiment trends across the workspace.

---

## 1. Schema Changes

Add fields to existing models:

```prisma
model TranscriptEntry {
  // ... existing ...
  sentiment String? // "positive" | "neutral" | "negative" | "angry" | "frustrated" | "joyful"
  sentimentScore Float? // -1.0 to 1.0
}

model Call {
  // ... existing ...
  sentimentTimeline Json? // [{ ts: 0, score: 0.3, label: "positive" }, { ts: 30, score: -0.5, label: "frustrated" }]
  sentimentTrend String? // "improving" | "stable" | "declining"
}
```

---

## 2. Classification

### 2.1 Per-turn sentiment (post-call worker)

```ts
// src/worker/postcall.ts (extend)
async function classifySentiment(call: Call) {
  const entries = await prisma.transcriptEntry.findMany({
    where: { callId: call.id },
    orderBy: { timestampMs: "asc" },
  });

  const timeline: { ts: number; score: number; label: string }[] = [];

  for (const entry of entries) {
    if (entry.speaker !== "CALLER") continue; // only caller sentiment matters
    const result = await classifyEmotion(entry.text);
    await prisma.transcriptEntry.update({
      where: { id: entry.id },
      data: { sentiment: result.label, sentimentScore: result.score },
    });
    timeline.push({ ts: entry.timestampMs, score: result.score, label: result.label });
  }

  // Compute overall sentiment + trend
  const avgScore = avg(timeline.map((t) => t.score));
  const overall = avgScore > 0.2 ? "positive" : avgScore < -0.2 ? "negative" : "neutral";
  const trend = computeTrend(timeline);

  await prisma.call.update({
    where: { id: call.id },
    data: { sentiment: overall, sentimentTimeline: timeline, sentimentTrend: trend },
  });
}

async function classifyEmotion(text: string): Promise<{ label: string; score: number }> {
  // Use OpenRouter or Sarvam for emotion classification
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    body: JSON.stringify({
      model: "meta-llama/llama-3.1-8b-instruct", // fast, cheap for classification
      messages: [
        { role: "system", content: 'Classify emotion as JSON: {"label":"positive|neutral|negative|angry|frustrated|joyful","score":-1.0 to 1.0}' },
        { role: "user", content: text },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });
  return (await res.json()).choices[0].message.content;
}
```

### 2.2 Real-time anger escalation

Detect escalating frustration during a live call and alert supervisors:

```ts
// In the live transcript handler
if (entry.speaker === "CALLER" && entry.sentimentScore < -0.6) {
  await notifySupervisors(callId, {
    title: "Caller frustration detected",
    body: `Negative sentiment on call ${callId}`,
    link: `/live/${callId}`,
  });
}
```

---

## 3. Visualizations

### 3.1 Sentiment timeline chart (call detail)

```tsx
// src/app/(app)/calls/[id]/sentiment-chart.tsx
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";

export function SentimentTimeline({ timeline }: { timeline: { ts: number; score: number; label: string }[] }) {
  const data = timeline.map((t) => ({ time: formatMs(t.ts), score: t.score, label: t.label }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <XAxis dataKey="time" />
        <YAxis domain={[-1, 1]} ticks={[-1, -0.5, 0, 0.5, 1]} />
        <Tooltip content={({ active, payload }) => active && payload ? (
          <div className="bg-background border rounded p-2 text-xs">
            <p>{payload[0].payload.label}</p>
            <p>Score: {payload[0].payload.score.toFixed(2)}</p>
          </div>
        ) : null} />
        <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
        <Line dataKey="score" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: "#8b5cf6", r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

### 3.2 Color-coded transcript

Each transcript bubble is colored by sentiment:

```tsx
const sentimentColors = {
  positive: "bg-green-50 border-green-200",
  neutral: "bg-muted",
  negative: "bg-red-50 border-red-200",
  angry: "bg-red-100 border-red-300",
  frustrated: "bg-amber-50 border-amber-200",
  joyful: "bg-emerald-50 border-emerald-200",
};

<div className={`rounded-lg p-3 border ${sentimentColors[entry.sentiment]}`}>
  {entry.text}
</div>
```

### 3.3 Workspace sentiment trend

Aggregate sentiment across all calls by day:

```
Aug 1: ████████░░  +0.3 (positive)
Aug 2: █████░░░░░  +0.1 (neutral)
Aug 3: ███░░░░░░░  -0.2 (slightly negative) ⚠
Aug 4: ██████░░░░  +0.2 (neutral)
```

---

## 4. QA Integration

Use sentiment as a QA scoring factor. Calls ending with **negative** caller
sentiment get a lower CSAT score automatically.

---

## Next

→ [03 — Voice Cloning & Brand Voices](03-voice-cloning-and-brand-voices.md)