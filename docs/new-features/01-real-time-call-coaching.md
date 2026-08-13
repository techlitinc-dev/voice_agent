# 01 — Real-Time Call Coaching

> **What**: Supervisors monitor live calls, read the real-time transcript, and
> coach agents by whispering suggestions (inaudible to the caller) or barging in
> (taking over the call).

---

## 1. Current State

The schema and basic UI exist:

- **`LiveCallState`** model with `LiveMode` enum: `NONE, LISTEN, WHISPER, BARGE, TAKEOVER`.
- **`/live`** page showing in-progress calls.
- **`live-dashboard.tsx`** component.
- Dograh supports supervisor modes via its API.

**Gaps**: The UI is basic (polls every 5s, no live transcript streaming, no
whisper input).

---

## 2. Architecture

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│  Supervisor  │         │   Vaani API  │         │   Dograh     │
│   Browser    │◀─────── │  (Next.js)   │◀─────── │   (Pipecat)  │
│              │  SSE    │              │  WS     │              │
│  - Transcript│ stream  │  - Auth      │         │  - Audio     │
│  - Whisper   │────────▶│  - Proxy     │────────▶│  - STT feed  │
│  - Barge     │         │              │         │  - TTS inject│
└──────────────┘         └──────────────┘         └──────────────┘
```

**Flow**:
1. Dograh streams transcript entries to Vaani via webhook (existing).
2. Vaani stores them in `TranscriptEntry` + updates `LiveCallState.liveTranscript`.
3. Supervisor browser subscribes to an SSE stream for the call.
4. Vaani pushes new transcript entries to all subscribed supervisors.
5. Supervisor sends a whisper → Vaani calls Dograh's supervisor API → Dograh
   injects the text as TTS heard only by the agent (not the caller).

---

## 3. Implementation

### 3.1 SSE endpoint for live transcript

```ts
// src/app/api/calls/[id]/live-stream/route.ts (new)
import { prisma } from "@/lib/db";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const callId = params.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial state
      const state = await prisma.liveCallState.findUnique({ where: { callId } });
      controller.enqueue(encoder.encode(`event: state\ndata: ${JSON.stringify(state)}\n\n`));

      // Poll for new transcript entries (or use Redis pub/sub)
      let lastTs = Date.now();
      const interval = setInterval(async () => {
        const entries = await prisma.transcriptEntry.findMany({
          where: { callId, createdAt: { gt: new Date(lastTs) } },
          orderBy: { timestampMs: "asc" },
        });
        for (const entry of entries) {
          controller.enqueue(encoder.encode(`event: transcript\ndata: ${JSON.stringify(entry)}\n\n`));
        }
        lastTs = Date.now();

        // Check if call ended
        const updated = await prisma.liveCallState.findUnique({ where: { callId } });
        if (!updated) {
          controller.enqueue(encoder.encode(`event: ended\ndata: {}\n\n`));
          controller.close();
          clearInterval(interval);
        }
      }, 2000); // 2s poll (or use Redis pub/sub for instant)

      req.signal.addEventListener("abort", () => { clearInterval(interval); controller.close(); });
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
  });
}
```

### 3.2 Whisper endpoint

```ts
// src/app/api/calls/[id]/whisper/route.ts (new)
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { text } = await req.json();
  // Call Dograh's supervisor whisper API
  const dograhCallId = await getDograhCallId(params.id);
  await fetch(`${process.env.DOGRAH_API_URL}/api/v1/calls/${dograhCallId}/supervisor`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.DOGRAH_API_KEY}` },
    body: JSON.stringify({ mode: "whisper", text }),
  });
  // Update live state
  await prisma.liveCallState.update({
    where: { callId: params.id },
    data: { mode: "WHISPER", whisperContext: text, supervisorUserId: ctx.userId },
  });
  return Response.json({ ok: true });
}
```

### 3.3 Live coaching UI

```tsx
// src/app/(app)/live/[callId]/page.tsx
"use client";
import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

export default function LiveCallPage({ params }: { params: { callId: string } }) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [mode, setMode] = useState<string>("LISTEN");
  const [whisper, setWhisper] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(`/api/calls/${params.callId}/live-stream`);
    es.addEventListener("transcript", (e) => {
      setEntries((prev) => [...prev, JSON.parse(e.data)]);
      scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
    });
    es.addEventListener("state", (e) => setMode(JSON.parse(e.data).mode));
    es.addEventListener("ended", () => setMode("ENDED"));
    return () => es.close();
  }, [params.callId]);

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h1 className="font-semibold">Live Call</h1>
          <p className="text-sm text-muted-foreground">{params.callId}</p>
        </div>
        <Badge className={mode === "IN_PROGRESS" ? "bg-green-100 text-green-800 animate-pulse" : ""}>{mode}</Badge>
      </div>
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        {/* Transcript bubbles */}
      </ScrollArea>
      <div className="border-t p-4 space-y-2">
        <Textarea placeholder="Whisper a suggestion..." value={whisper} onChange={(e) => setWhisper(e.target.value)} rows={2} />
        <Button onClick={sendWhisper} disabled={!whisper.trim()}>Send Whisper</Button>
      </div>
    </div>
  );
}
```

---

## 4. Permissions

| Action | ROLE |
|---|---|
| View live calls list | MANAGER, ADMIN, OWNER |
| Listen to live call | MANAGER, ADMIN, OWNER |
| Whisper | MANAGER, ADMIN, OWNER |
| Barge / Takeover | ADMIN, OWNER |

---

## 5. Redis Pub/Sub (for scale)

For > 50 concurrent live viewers, replace DB polling with Redis pub/sub:

```ts
// On new transcript entry (from Dograh webhook):
await redis.publish(`call:${callId}:transcript`, JSON.stringify(entry));

// In SSE handler:
await redis.subscribe(`call:${callId}:transcript`);
redis.on("message", (channel, message) => {
  controller.enqueue(encoder.encode(`event: transcript\ndata: ${message}\n\n`));
});
```

---

## Next

→ [02 — Sentiment & Emotion Analytics](02-sentiment-and-emotion-analytics.md)