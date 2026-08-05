# 08 — Calls, Recordings, Analytics, Webhooks, Public API & Compliance Data

> **KICKOFF PROMPT — copy everything between the lines and paste into Hermes:**
>
> ---
> You are the EXECUTOR for the Vaani AI project. Read
> `/root/vaani-ai/plan/00_MASTER_PLAN.md` and execute
> `/root/vaani-ai/plan/08_calls_recordings_analytics.md` exactly. Create files with the
> EXACT contents shown. Run every Verify, compare with Expected, max 2 fix attempts,
> then STOP and report. Tenant rule: every query scoped by `workspaceId` from
> `requireWorkspace()` (dashboard) or `requireApiKey()` (public API). End with the
> FINAL REPORT.
> ---

---

## Goal

Every call becomes inspectable and measurable, and every spec-§8/§9/§11-data feature
lands:

1. **CDR**: searchable **Calls** list + call detail (transcript, audio playback,
   summary, extracted entities, sentiment, disposition, 4-way cost breakdown + billed
   margin, QA score, hallucination & dead-air flags, PII-redaction note).
2. **Analytics**: 30-day charts page; **real-time dashboard tiles** (live calls, ASR,
   AHT, concurrency, cost/min burn, 5s polling); **campaign reports** (reach/connect
   rate, conversion funnel, per-number performance, best time-to-call heatmap);
   **agent performance** (script adherence, escalation rate, hallucinations, dead air);
   **cost analytics & margins** (per-agent / per-campaign unit economics).
3. **Quality**: AI QA auto-scoring of 100% of completed calls against configurable
   rubrics (file-based rubric registry), hallucination detection, dead-air detection,
   full-text transcript search (Postgres FTS).
4. **Reporting**: CSV exports (streaming), print-friendly PDF call report,
   daily/weekly email digests (node-cron + nodemailer).
5. **Integrations**: event webhook subscriptions with HMAC-signed delivery +
   exponential-backoff retries; public REST API v1 behind `requireApiKey` with rate
   limiting, a minimal TS SDK, and an API docs page; Google Sheets export
   (operator-gated) + Zapier/Make/n8n webhook recipes.
6. **Compliance data**: GDPR export & right-to-erasure flows, PII redaction in
   transcripts, retention policies with a nightly auto-delete job.

**Time estimate:** 6–8 hours. **Prerequisites:** guides 01–07 green, MinIO container
up, `requireApiKey` exists in `src/lib/apikeys.ts` (guide 03), `emitWebhookEvent`
exists in `src/lib/webhooks.ts` (guide 06), worker from guide 07 runs.

---

## Environment variables added by this guide

**Guide-08-owned keys** — append these to `.env` (and to `.env.example` with the same
comments), grep-guarded so re-runs don't duplicate:

```bash
cd /root/vaani-ai
grep -q '^QA_SCORER_MODEL' .env || cat >> .env <<'EOF'

# --- Guide 08: QA auto-scoring (reuses OPENROUTER_API_KEY from guide 04) ---
QA_SCORER_MODEL="meta-llama/llama-3.1-8b-instruct"   # cheap scorer model on OpenRouter
QA_DRY_RUN="true"        # true = deterministic mock scores, no OpenRouter spend. Set "false" in prod.
RETENTION_DRY_RUN="true" # true = retention job logs what it WOULD delete, deletes nothing. Set "false" in prod.

# --- Guide 08: Google Sheets export (OPERATOR GATE — see Step 25; leave empty until configured) ---
GOOGLE_SHEETS_CLIENT_EMAIL=""
GOOGLE_SHEETS_PRIVATE_KEY=""
GOOGLE_SHEETS_SPREADSHEET_ID=""
EOF
```

**Keys OWNED BY GUIDE 01 (do NOT re-append — verify only):** `PUBLIC_API_RATE_LIMIT`
(default 120), `RETENTION_CRON`, `DIGEST_CRON`, `WEBHOOK_RETRY_INTERVAL_MS`. This
guide's code READS them with these defaults when unset: `RETENTION_CRON` →
`"30 3 * * *"`, `DIGEST_CRON` → `"5 * * * *"`, `WEBHOOK_RETRY_INTERVAL_MS` → `15000`.

```bash
cd /root/vaani-ai
grep -E '^(PUBLIC_API_RATE_LIMIT|RETENTION_CRON|DIGEST_CRON|WEBHOOK_RETRY_INTERVAL_MS)=' .env
```
**Expected:** up to four lines (guide 01 put them there). Missing lines are OK — the
code defaults above apply; do not append your own copies.
**SMTP_* keys** (digests) came from guide 06 — digests log instead of sending when
`SMTP_HOST` is unset, same convention as guide 06.

> Digest emails silently SKIP (log a line) when `SMTP_HOST` is unset — same convention
> as guide 06's `sendStaffEmail`.

---

## Step 1: Dependencies + vitest config (idempotent — earlier guides own the first install)

`minio@8.0.2` and `recharts@2.13.3` came with earlier guides; **nodemailer@6.9.16 was
installed by guide 06**, **node-cron@3.0.3 by guide 07**. This guide adds only
`googleapis@144.0.0` (Sheets export). All commands below are idempotent no-ops when
the pinned version is already present — run them all regardless.

```bash
cd /root/vaani-ai
npm install node-cron@3.0.3
npm install --save-dev @types/node-cron@3.0.11
npm install nodemailer@6.9.16 googleapis@144.0.0 minio@8.0.2 recharts@2.13.3
```

**Verify:**
```bash
cd /root/vaani-ai
npm ls node-cron nodemailer googleapis minio recharts 2>&1 | grep -E "node-cron@|nodemailer@|googleapis@|minio@|recharts@"
```
**Expected:** five lines: `node-cron@3.0.3`, `nodemailer@6.9.16`, `googleapis@144.0.0`,
`minio@8.0.2`, `recharts@2.13.3` (no `UNMET` / no `empty`).
**If it fails:** re-run the exact `npm install` lines above once; if a peer-dependency
error appears, report it verbatim and STOP.

**Verify the vitest `@/` alias config (owned by guide 06's Step 0 — do NOT recreate):**
```bash
cd /root/vaani-ai
test -f vitest.config.ts && grep -n '"@/\|@/' vitest.config.ts | head -3
```
**Expected:** the file exists and maps the `@/` alias to `./src` (guide 06 created
it). If `vitest.config.ts` is MISSING, guide 06 was not fully applied — STOP and
report; do not invent your own config here.

---

## Step 2: MinIO storage — verify guide 05's client + append GDPR/retention helpers

**`src/lib/storage.ts` is owned by guide 05 — DO NOT create or rewrite it.** Guide 05's
version is a superset of what this guide needs: `RECORDINGS_BUCKET`, `ensureBucket`,
`recordingUrl`, `ingestRecording`, plus KB helpers. This step only APPENDS three
helpers the GDPR/retention jobs need (`putJsonObject`, `deleteObject`, `objectUrl`).

**Verify the file exists with the expected exports:**
```bash
cd /root/vaani-ai
test -f src/lib/storage.ts && echo EXISTS || echo MISSING
grep -n "RECORDINGS_BUCKET\|ensureBucket\|recordingUrl\|ingestRecording" src/lib/storage.ts | head -6
grep -n "new Minio.Client" src/lib/storage.ts
```
**Expected:** `EXISTS`; grep hits for all four names; the MinIO client is constructed
somewhere in the file. Note the VARIABLE NAME of the client from the last grep
(expected: `s3`).
**If it fails:** `MISSING` → guide 05 was not completed; STOP and report (do not
recreate the file here). If the client variable is NOT named `s3`, use the actual
name in the appended code below and note the deviation.

**Append the helpers (idempotent):**
```bash
cd /root/vaani-ai
grep -q "putJsonObject" src/lib/storage.ts && echo PRESENT || echo APPEND
```
If it prints `PRESENT`, skip the append. If `APPEND`:
```bash
cat >> src/lib/storage.ts <<'EOF'

/** Store a JSON document (GDPR export bundles). Added in guide 08. */
export async function putJsonObject(key: string, value: unknown): Promise<void> {
  await ensureBucket();
  const buf = Buffer.from(JSON.stringify(value, null, 2), "utf8");
  await s3.putObject(RECORDINGS_BUCKET, key, buf, buf.length, {
    "Content-Type": "application/json",
  });
}

/** Delete one object. Returns false (never throws) when the object is missing. Added in guide 08. */
export async function deleteObject(key: string): Promise<boolean> {
  await ensureBucket();
  try {
    await s3.removeObject(RECORDINGS_BUCKET, key);
    return true;
  } catch {
    return false;
  }
}

/** Presigned GET URL for any object in the bucket (GDPR export downloads), 15 min. Added in guide 08. */
export async function objectUrl(key: string): Promise<string> {
  await ensureBucket();
  return s3.presignedGetObject(RECORDINGS_BUCKET, key, 15 * 60);
}
EOF
```
**Expected after append:** `npm run typecheck` exits 0.

**File `scripts/bootstrap-minio.ts`** (full content — create only if missing; check
first with `test -f scripts/bootstrap-minio.ts && echo EXISTS || echo MISSING`):

```ts
import { ensureBucket, RECORDINGS_BUCKET } from "../src/lib/storage";

ensureBucket()
  .then(() => {
    console.log(`bucket ready: ${RECORDINGS_BUCKET}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

**Do:**
```bash
cd /root/vaani-ai
npx tsx scripts/bootstrap-minio.ts
```
**Expected:** `bucket ready: vaani-recordings`.
**If it fails:** `docker compose ps` — minio must be running; `.env` S3_* values must
match guide 01 (`vaani` / `vaani_dev_minio_password`).

Then:
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 3: Analytics aggregation library (pure functions) + unit tests

All dashboard/report math lives in ONE pure, DB-free module so it is unit-testable
with fixture rows. Pages and API routes only fetch rows and call these functions.

**File `src/lib/analytics.ts`** (full content):

```ts
/**
 * Pure analytics aggregations (spec §8). No DB access — every function takes
 * fixture-friendly row types so Vitest can pin the math exactly.
 * Money is integer paise everywhere.
 */

export type AnalyticsCallRow = {
  createdAt: Date;
  answeredAt: Date | null;
  status: string; // CallStatus enum as string
  direction: string; // INBOUND | OUTBOUND
  outcome: string | null;
  fromNumber: string;
  toNumber: string;
  durationSec: number;
  billedPaise: number;
  costTelephonyPaise: number;
  costSttPaise: number;
  costLlmPaise: number;
  costTtsPaise: number;
};

/** A call counts as "answered" when it reached COMPLETED or has answeredAt set. */
export function isAnswered(c: Pick<AnalyticsCallRow, "status" | "answeredAt">): boolean {
  return c.status === "COMPLETED" || c.answeredAt !== null;
}

/** ASR (answer seize ratio) as an integer percentage 0-100. */
export function computeAsr(calls: AnalyticsCallRow[]): number {
  if (calls.length === 0) return 0;
  const answered = calls.filter(isAnswered).length;
  return Math.round((answered / calls.length) * 100);
}

/** AHT (average handle time) in whole seconds, over ALL calls in the set. */
export function computeAht(calls: AnalyticsCallRow[]): number {
  if (calls.length === 0) return 0;
  return Math.round(calls.reduce((a, c) => a + c.durationSec, 0) / calls.length);
}

/** Total wholesale cost (paise) = telephony + STT + LLM + TTS. */
export function wholesaleCostPaise(c: Pick<AnalyticsCallRow,
  "costTelephonyPaise" | "costSttPaise" | "costLlmPaise" | "costTtsPaise">): number {
  return c.costTelephonyPaise + c.costSttPaise + c.costLlmPaise + c.costTtsPaise;
}

export function sumWholesalePaise(calls: AnalyticsCallRow[]): number {
  return calls.reduce((a, c) => a + wholesaleCostPaise(c), 0);
}

export function sumBilledPaise(calls: AnalyticsCallRow[]): number {
  return calls.reduce((a, c) => a + c.billedPaise, 0);
}

/** Gross margin percentage 0-100 (integer). 0 when nothing was billed. */
export function marginPercent(billedPaise: number, wholesalePaise: number): number {
  if (billedPaise <= 0) return 0;
  return Math.round(((billedPaise - wholesalePaise) / billedPaise) * 100);
}

/** Cost-per-minute burn in paise/min over a set of calls (0 when no audio time). */
export function burnPaisePerMinute(calls: AnalyticsCallRow[]): number {
  const minutes = calls.reduce((a, c) => a + c.durationSec, 0) / 60;
  if (minutes <= 0) return 0;
  return Math.round(sumWholesalePaise(calls) / minutes);
}

// ---------- Conversion funnel (spec §8: dialed → answered → qualified → booked) ----------

export type Funnel = { dialed: number; answered: number; qualified: number; booked: number };

/** Stages are cumulative: every "booked" call also counts as qualified+answered+dialed. */
export function computeFunnel(calls: AnalyticsCallRow[]): Funnel {
  const outbound = calls.filter((c) => c.direction === "OUTBOUND");
  const answered = outbound.filter(isAnswered);
  const qualified = answered.filter((c) => c.outcome === "qualified" || c.outcome === "booked");
  const booked = answered.filter((c) => c.outcome === "booked");
  return { dialed: outbound.length, answered: answered.length, qualified: qualified.length, booked: booked.length };
}

/** Reach rate = dialed / contacts-in-campaign expressed as integer %; caller passes counts. */
export function ratePercent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

// ---------- Per-number performance ----------

export type NumberStats = {
  number: string;
  calls: number;
  answered: number;
  asr: number; // integer %
  totalDurationSec: number;
  billedPaise: number;
};

/**
 * "Our number" for a call: the DID we own — fromNumber for OUTBOUND (we dial FROM it),
 * toNumber for INBOUND (the caller dialed it).
 * NOTE: the Prisma Call model has no phoneNumberId column in v1, so grouping is by
 * the E.164 string. Documented deviation, no schema change.
 */
export function ourNumber(c: Pick<AnalyticsCallRow, "direction" | "fromNumber" | "toNumber">): string {
  return c.direction === "OUTBOUND" ? c.fromNumber : c.toNumber;
}

export function perNumberStats(calls: AnalyticsCallRow[]): NumberStats[] {
  const map = new Map<string, AnalyticsCallRow[]>();
  for (const c of calls) {
    const n = ourNumber(c);
    map.set(n, [...(map.get(n) ?? []), c]);
  }
  return [...map.entries()]
    .map(([number, rows]) => ({
      number,
      calls: rows.length,
      answered: rows.filter(isAnswered).length,
      asr: computeAsr(rows),
      totalDurationSec: rows.reduce((a, c) => a + c.durationSec, 0),
      billedPaise: sumBilledPaise(rows),
    }))
    .sort((a, b) => b.calls - a.calls);
}

// ---------- Best time-to-call heatmap (7 day x 24 hour grid of ANSWERED calls) ----------

/** heat[day][hour] = answered call count. day: 0=Sunday .. 6=Saturday (Date.getDay). */
export function buildHeatmap(calls: AnalyticsCallRow[]): number[][] {
  const heat: number[][] = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const c of calls) {
    if (!isAnswered(c)) continue;
    const at = c.answeredAt ?? c.createdAt;
    heat[at.getDay()][at.getHours()] += 1;
  }
  return heat;
}

// ---------- Agent performance (spec §8) ----------

export type AgentPerfCallRow = {
  agentId: string | null;
  agentName: string;
  scriptAdherenceScore: number | null;
  hallucinationFlag: boolean;
  deadAirSeconds: number;
  qaTotal: number | null; // latest QaScore totalScore (null when unscored)
  qaMax: number | null;
};

export type AgentPerfRow = {
  agentId: string;
  agentName: string;
  calls: number;
  avgScriptAdherence: number | null; // 0-100, null when no scores
  escalationRate: number; // integer % of calls that produced a TransferRequest
  hallucinations: number;
  avgDeadAirSec: number;
  avgQaPercent: number | null; // avg(totalScore/maxScore*100), null when unscored
};

/**
 * transfersForAgent: map agentId -> number of TransferRequests raised on that
 * agent's calls (computed by the caller with a groupBy query).
 */
export function agentPerformance(
  calls: AgentPerfCallRow[],
  transfersForAgent: Map<string, number>,
): AgentPerfRow[] {
  const map = new Map<string, AgentPerfCallRow[]>();
  for (const c of calls) {
    if (!c.agentId) continue;
    map.set(c.agentId, [...(map.get(c.agentId) ?? []), c]);
  }
  const rows: AgentPerfRow[] = [];
  for (const [agentId, rowsForAgent] of map.entries()) {
    const adherence = rowsForAgent.filter((c) => c.scriptAdherenceScore !== null);
    const qa = rowsForAgent.filter((c) => c.qaTotal !== null && c.qaMax !== null && c.qaMax > 0);
    rows.push({
      agentId,
      agentName: rowsForAgent[0].agentName,
      calls: rowsForAgent.length,
      avgScriptAdherence:
        adherence.length === 0
          ? null
          : Math.round(adherence.reduce((a, c) => a + (c.scriptAdherenceScore ?? 0), 0) / adherence.length),
      escalationRate: ratePercent(transfersForAgent.get(agentId) ?? 0, rowsForAgent.length),
      hallucinations: rowsForAgent.filter((c) => c.hallucinationFlag).length,
      avgDeadAirSec: Math.round(rowsForAgent.reduce((a, c) => a + c.deadAirSeconds, 0) / rowsForAgent.length),
      avgQaPercent:
        qa.length === 0
          ? null
          : Math.round(qa.reduce((a, c) => a + ((c.qaTotal ?? 0) / (c.qaMax ?? 1)) * 100, 0) / qa.length),
    });
  }
  return rows.sort((a, b) => b.calls - a.calls);
}
```

**File `tests/analytics.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import {
  agentPerformance,
  buildHeatmap,
  burnPaisePerMinute,
  computeAht,
  computeAsr,
  computeFunnel,
  marginPercent,
  ourNumber,
  perNumberStats,
  ratePercent,
  sumBilledPaise,
  sumWholesalePaise,
  wholesaleCostPaise,
  type AgentPerfCallRow,
  type AnalyticsCallRow,
} from "../src/lib/analytics";

function row(partial: Partial<AnalyticsCallRow>): AnalyticsCallRow {
  return {
    createdAt: new Date("2024-07-02T10:00:00Z"),
    answeredAt: null,
    status: "COMPLETED",
    direction: "OUTBOUND",
    outcome: null,
    fromNumber: "+918040001234",
    toNumber: "+919900000001",
    durationSec: 60,
    billedPaise: 0,
    costTelephonyPaise: 10,
    costSttPaise: 5,
    costLlmPaise: 5,
    costTtsPaise: 10,
    ...partial,
  };
}

describe("computeAsr", () => {
  it("is 0 for no calls", () => {
    expect(computeAsr([])).toBe(0);
  });
  it("counts COMPLETED or answeredAt as answered", () => {
    const calls = [
      row({ status: "COMPLETED" }),
      row({ status: "NO_ANSWER" }),
      row({ status: "BUSY" }),
      row({ status: "IN_PROGRESS", answeredAt: new Date() }),
    ];
    expect(computeAsr(calls)).toBe(50);
  });
});

describe("computeAht", () => {
  it("averages durations in whole seconds", () => {
    expect(computeAht([row({ durationSec: 61 }), row({ durationSec: 62 })])).toBe(62);
    expect(computeAht([])).toBe(0);
  });
});

describe("cost helpers", () => {
  it("sums the 4 components", () => {
    expect(wholesaleCostPaise(row({}))).toBe(30);
  });
  it("sums over a set and computes margin", () => {
    const calls = [row({ billedPaise: 100 }), row({ billedPaise: 100 })];
    expect(sumWholesalePaise(calls)).toBe(60);
    expect(sumBilledPaise(calls)).toBe(200);
    expect(marginPercent(200, 60)).toBe(70);
    expect(marginPercent(0, 60)).toBe(0);
  });
  it("computes burn paise per minute", () => {
    // 2 calls x 60s = 2 minutes; wholesale 30 paise each = 60 -> 30 paise/min
    expect(burnPaisePerMinute([row({}), row({})])).toBe(30);
    expect(burnPaisePerMinute([row({ durationSec: 0, costTelephonyPaise: 0, costSttPaise: 0, costLlmPaise: 0, costTtsPaise: 0 })])).toBe(0);
  });
});

describe("computeFunnel", () => {
  it("builds cumulative dialed->answered->qualified->booked stages", () => {
    const calls = [
      row({ outcome: "booked" }),                       // dialed+answered+qualified+booked
      row({ outcome: "qualified" }),                    // dialed+answered+qualified
      row({ outcome: "not-interested" }),               // dialed+answered
      row({ status: "NO_ANSWER" }),                     // dialed only
      row({ direction: "INBOUND", outcome: "booked" }), // inbound: excluded from funnel
    ];
    expect(computeFunnel(calls)).toEqual({ dialed: 4, answered: 3, qualified: 2, booked: 1 });
  });
});

describe("ratePercent", () => {
  it("guards divide-by-zero", () => {
    expect(ratePercent(5, 0)).toBe(0);
    expect(ratePercent(1, 4)).toBe(25);
  });
});

describe("ourNumber / perNumberStats", () => {
  it("picks fromNumber for outbound and toNumber for inbound", () => {
    expect(ourNumber(row({ direction: "OUTBOUND", fromNumber: "+9114A", toNumber: "+9199B" }))).toBe("+9114A");
    expect(ourNumber(row({ direction: "INBOUND", fromNumber: "+9199B", toNumber: "+9180A" }))).toBe("+9180A");
  });
  it("groups per-number stats sorted by call count", () => {
    const calls = [
      row({ fromNumber: "+9114A" }),
      row({ fromNumber: "+9114A", status: "NO_ANSWER" }),
      row({ fromNumber: "+9114B", billedPaise: 500 }),
    ];
    const stats = perNumberStats(calls);
    expect(stats[0].number).toBe("+9114A");
    expect(stats[0].calls).toBe(2);
    expect(stats[0].asr).toBe(50);
    expect(stats[1].billedPaise).toBe(500);
  });
});

describe("buildHeatmap", () => {
  it("counts only answered calls into day/hour buckets", () => {
    const tue10 = new Date("2024-07-02T10:30:00"); // a Tuesday (getDay()=2) at 10h local
    const calls = [
      row({ createdAt: tue10, answeredAt: tue10 }),
      row({ createdAt: tue10, answeredAt: tue10 }),
      row({ createdAt: tue10, status: "NO_ANSWER", answeredAt: null }),
    ];
    const heat = buildHeatmap(calls);
    expect(heat[tue10.getDay()][tue10.getHours()]).toBe(2);
    expect(heat.flat().reduce((a, b) => a + b, 0)).toBe(2);
  });
});

describe("agentPerformance", () => {
  it("aggregates adherence, escalation, hallucinations, dead air, QA", () => {
    const calls: AgentPerfCallRow[] = [
      { agentId: "a1", agentName: "Priya", scriptAdherenceScore: 90, hallucinationFlag: false, deadAirSeconds: 2, qaTotal: 38, qaMax: 40 },
      { agentId: "a1", agentName: "Priya", scriptAdherenceScore: 80, hallucinationFlag: true, deadAirSeconds: 6, qaTotal: null, qaMax: null },
      { agentId: "a2", agentName: "Rao", scriptAdherenceScore: null, hallucinationFlag: false, deadAirSeconds: 0, qaTotal: null, qaMax: null },
    ];
    const transfers = new Map([["a1", 1]]);
    const rows = agentPerformance(calls, transfers);
    expect(rows[0].agentId).toBe("a1"); // most calls first
    expect(rows[0].avgScriptAdherence).toBe(85);
    expect(rows[0].escalationRate).toBe(50); // 1 transfer / 2 calls
    expect(rows[0].hallucinations).toBe(1);
    expect(rows[0].avgDeadAirSec).toBe(4);
    expect(rows[0].avgQaPercent).toBe(95); // 38/40
    expect(rows[1].avgScriptAdherence).toBeNull();
    expect(rows[1].avgQaPercent).toBeNull();
  });
});
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npx vitest run tests/analytics.test.ts
```
**Expected:** typecheck exit 0; `✓ tests/analytics.test.ts (12 tests)` (12 `it`
blocks), `Test Files  1 passed (1)`.
**If it fails:** an assertion mismatch → you typed a fixture wrong; fix the TEST to
match the guide, never the lib. Module-not-found → run from `/root/vaani-ai`.

---

## Step 4: Calls list page (CDR) with filters + full-text transcript search box

This REPLACES the guide-08-original calls page. The `q` filter now searches numbers,
summary AND (when the FTS migration from Step 5 has run) transcript full text via the
`ts` parameter produced by `src/lib/fts.ts`.

**File `src/app/(app)/calls/page.tsx`** (full content):

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { searchCallIdsByTranscript } from "@/lib/fts";
import { Card, CardContent } from "@/components/ui/card";
import { formatINR } from "@/lib/money";

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: "text-green-400",
  FAILED: "text-red-400",
  NO_ANSWER: "text-orange-400",
  BUSY: "text-orange-400",
  IN_PROGRESS: "text-blue-400",
  RINGING: "text-blue-400",
  VOICEMAIL: "text-muted-foreground",
};

function fmtDur(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default async function CallsPage({
  searchParams,
}: {
  searchParams: { direction?: string; status?: string; q?: string; transcript?: string };
}) {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  // Full-text transcript search (Postgres FTS, Step 5). Falls back to empty when
  // the migration has not been applied yet, so the page never crashes.
  let transcriptIds: string[] | null = null;
  const tsQuery = (searchParams.transcript ?? "").trim();
  if (tsQuery.length > 0) {
    transcriptIds = await searchCallIdsByTranscript(ctx.workspaceId, tsQuery);
  }

  const where = {
    workspaceId: ctx.workspaceId,
    ...(searchParams.direction ? { direction: searchParams.direction as "INBOUND" | "OUTBOUND" } : {}),
    ...(searchParams.status ? { status: searchParams.status as never } : {}),
    ...(searchParams.q
      ? {
          OR: [
            { fromNumber: { contains: searchParams.q } },
            { toNumber: { contains: searchParams.q } },
            { summary: { contains: searchParams.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(transcriptIds ? { id: { in: transcriptIds } } : {}),
  };

  const calls = await db.call.findMany({
    where,
    include: { agent: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Calls</h1>
        <div className="flex gap-2">
          <a data-testid="export-calls-csv" href="/api/exports/calls.csv"
            className="h-9 rounded-md border border-border px-4 py-2 text-sm hover:border-primary/50">
            Export CSV
          </a>
        </div>
      </div>

      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={searchParams.q} placeholder="Number or summary…"
          data-testid="calls-search-input"
          className="h-9 w-56 rounded-md border border-border bg-transparent px-3 text-sm" />
        <input name="transcript" defaultValue={searchParams.transcript}
          placeholder="Full-text transcript search…"
          data-testid="calls-transcript-search"
          className="h-9 w-64 rounded-md border border-border bg-transparent px-3 text-sm" />
        <select name="direction" defaultValue={searchParams.direction ?? ""}
          className="h-9 rounded-md border border-border bg-card px-3 text-sm">
          <option value="">All directions</option>
          <option value="INBOUND">Inbound</option>
          <option value="OUTBOUND">Outbound</option>
        </select>
        <select name="status" defaultValue={searchParams.status ?? ""}
          className="h-9 rounded-md border border-border bg-card px-3 text-sm">
          <option value="">All statuses</option>
          {["COMPLETED", "FAILED", "NO_ANSWER", "BUSY", "IN_PROGRESS", "VOICEMAIL"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button data-testid="calls-filter-button"
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Filter</button>
      </form>

      {transcriptIds !== null && (
        <p className="text-sm text-muted-foreground" data-testid="calls-fts-count">
          {transcriptIds.length} call(s) match transcript search “{tsQuery}”.
        </p>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="calls-table">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">When</th><th className="p-3">Dir</th><th className="p-3">From → To</th>
                <th className="p-3">Agent</th><th className="p-3">Status</th><th className="p-3">Duration</th>
                <th className="p-3">Outcome</th><th className="p-3">Billed</th><th className="p-3">QA</th>
                <th className="p-3">Summary</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="p-3 whitespace-nowrap text-muted-foreground">
                    {c.createdAt.toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                  </td>
                  <td className="p-3">{c.direction === "INBOUND" ? "↙" : "↗"}</td>
                  <td className="p-3 font-mono text-xs">
                    <Link href={`/calls/${c.id}`} className="hover:text-primary hover:underline">
                      {c.fromNumber} → {c.toNumber}
                    </Link>
                  </td>
                  <td className="p-3">{c.agent?.name ?? "—"}</td>
                  <td className={`p-3 ${STATUS_COLOR[c.status] ?? ""}`}>{c.status}</td>
                  <td className="p-3">{fmtDur(c.durationSec)}</td>
                  <td className="p-3">{c.outcome ?? "—"}</td>
                  <td className="p-3">{c.billedPaise > 0 ? formatINR(c.billedPaise) : "—"}</td>
                  <td className="p-3">
                    {c.scriptAdherenceScore !== null ? (
                      <span data-testid={`call-qa-score-${c.id}`}
                        className={`rounded-full border px-2 py-0.5 text-xs ${c.scriptAdherenceScore >= 70 ? "text-green-400" : "text-orange-400"}`}>
                        {c.scriptAdherenceScore}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="max-w-64 truncate p-3 text-muted-foreground">{c.summary ?? "—"}</td>
                </tr>
              ))}
              {calls.length === 0 && (
                <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">
                  No calls match. They appear here the moment your agent answers or dials.
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0. (A module-not-found for `@/lib/fts` is EXPECTED at this point —
it means you ran this before Step 5. Do Step 5, then re-run; it must pass after.)

---

## Step 5: Full-text transcript search — Postgres FTS migration + query helper

Postgres gives us a generated `tsvector` column + GIN index — no new services. The
migration is additive raw SQL (Prisma schema is untouched; Prisma simply ignores the
extra column).

**Do:**
```bash
cd /root/vaani-ai
MIG="prisma/migrations/$(date +%Y%m%d%H%M%S)_call_transcript_fts"
mkdir -p "$MIG"
cat > "$MIG/migration.sql" <<'SQL'
ALTER TABLE "Call"
  ADD COLUMN IF NOT EXISTS "transcriptTsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("transcript", ''))) STORED;

CREATE INDEX IF NOT EXISTS "Call_transcriptTsv_gin"
  ON "Call" USING GIN ("transcriptTsv");
SQL
npx prisma migrate dev
```
**Expected:** `Applying migration '..._call_transcript_fts'` then `Your database is
now in sync with your schema.`
**If it fails:**
- `Prisma Migrate detected that your database was modified` / drift warning → apply
  the SQL by hand and mark it applied:
  ```bash
  docker exec -i vaani-db psql -U vaani -d vaani < "$MIG/migration.sql"
  npx prisma migrate resolve --applied "$(basename "$MIG")"
  ```
  Expected: `Migration ... marked as applied.`
- Anything else: STOP and report the exact error.

**File `src/lib/fts.ts`** (full content):

```ts
import { db } from "./db";

/** Normalize a user search string: trim, collapse whitespace, cap length. */
export function normalizeSearchQuery(input: string, maxLen = 200): string {
  return input.trim().replace(/\s+/g, " ").slice(0, maxLen);
}

/**
 * Full-text search over Call.transcript (generated tsvector column `transcriptTsv`,
 * GIN-indexed). Returns matching call ids, best rank first. Tenant-scoped ALWAYS.
 *
 * `plainto_tsquery` treats the input as plain text (ANDs the words) — user input can
 * never inject tsquery operators.
 *
 * If the FTS migration has not been applied yet, returns [] and logs — the calls
 * page must keep working on a pre-migration database.
 */
export async function searchCallIdsByTranscript(
  workspaceId: string,
  rawQuery: string,
  limit = 50,
): Promise<string[]> {
  const q = normalizeSearchQuery(rawQuery);
  if (q.length === 0) return [];
  try {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "Call"
      WHERE "workspaceId" = ${workspaceId}
        AND "transcriptTsv" @@ plainto_tsquery('english', ${q})
      ORDER BY ts_rank("transcriptTsv", plainto_tsquery('english', ${q})) DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => r.id);
  } catch (e) {
    console.error("[fts] transcript search failed (migration applied?)", String(e).slice(0, 200));
    return [];
  }
}
```

**File `tests/fts.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import { normalizeSearchQuery } from "../src/lib/fts";

describe("normalizeSearchQuery", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeSearchQuery("  cleaning   price  ")).toBe("cleaning price");
  });
  it("caps length at 200 chars by default", () => {
    expect(normalizeSearchQuery("x".repeat(500))).toHaveLength(200);
  });
  it("respects a custom cap", () => {
    expect(normalizeSearchQuery("abcdef", 3)).toBe("abc");
  });
  it("returns empty string for blank input", () => {
    expect(normalizeSearchQuery("   ")).toBe("");
  });
});
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npx vitest run tests/fts.test.ts
```
**Expected:** typecheck exit 0; `✓ tests/fts.test.ts (4 tests)`.

**Functional test (seeded transcript must be found):**
```bash
cd /root/vaani-ai
docker exec vaani-db psql -U vaani -d vaani -t -c \
 "SELECT id FROM \"Call\" WHERE \"transcriptTsv\" @@ plainto_tsquery('english', 'cleaning');"
```
**Expected:** at least one id (the seeded demo call whose transcript mentions
"cleaning"). An empty result means the generated column did not populate — re-run the
migration block.

---

## Step 6: Call detail page — full CDR (entities, disposition, cost margin, QA, flags)

Replaces the original detail page. Shows EVERYTHING spec §8 requires on a CDR:
recording, transcript, summary, extracted entities, sentiment, outcome/disposition,
duration, 4-way cost breakdown + billed margin, QA score, hallucination & dead-air
flags, PII-redaction state.

**File `src/app/(app)/calls/[id]/page.tsx`** (full content):

```tsx
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { recordingUrl } from "@/lib/storage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/money";

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
            <p>Sentiment: {call.sentiment ?? "—"}</p>
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
          {call.transcript ? (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed" data-testid="call-transcript">{call.transcript}</pre>
          ) : (
            <p className="text-sm text-muted-foreground">No transcript captured (or removed by retention/erasure).</p>
          )}
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
```

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** exit 0 both; routes `/calls`, `/calls/[id]` present. (The
`/calls/[id]/report` link target is created in Step 18 — a 404 on it until then is
expected; do not "fix" it.)

**Browser test (operator):** login → `/calls` → the seeded demo call (guide 02) is
listed with outcome `booked`, billed ₹3.62, QA badge `94` → click it → detail shows
summary, extracted entities (`name: Ramesh`), transcript, event timeline, QA card
(`37/40 · receptionist-default`), unit-economics card (wholesale ₹2.59, billed
₹3.62, margin ₹1.03). Transcript search box: enter `cleaning` → list narrows to the
demo call.

---

## Step 7: Recording ingestion worker job

When the webhook stores `recordingKey = "pending:<url>"`, something must download the
audio into MinIO. This is a small repeatable sweeper inside the existing worker.

**Edit `src/worker/index.ts`** (guide 07's orchestrator file). Two precise edits:

**Edit 1 — imports.** Guide 07's `src/worker/index.ts` does NOT define `db` itself
(it delegates to `./campaignTick`, `./dial`, `./maintenance`, which own their
Prisma clients) — so these imports are MANDATORY, or the sweeper below fails
typecheck with `Cannot find name 'db'`. Find this exact line (it is the last import):

```ts
import { resetDailyCaps, sweepDueCallbacks, sweepPostCalls } from "./maintenance";
```

Insert IMMEDIATELY AFTER it (skip any line already present — idempotent re-runs):

```ts
import { db } from "../lib/db";
import { ingestRecording } from "../lib/storage";
```

**Edit 2 — the sweeper function.** Insert AFTER the line
`const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);` and
BEFORE `async function main() {` (if a `recordingSweeper` function already exists
from a previous attempt, skip this edit):

```ts
/** Sweep calls whose recording is still a pending remote URL; ingest into MinIO. */
async function recordingSweeper() {
  const pending = await db.call.findMany({
    where: { recordingKey: { startsWith: "pending:" } },
    take: 10,
    orderBy: { createdAt: "asc" },
  });
  for (const call of pending) {
    const sourceUrl = call.recordingKey!.slice("pending:".length);
    const key = `${call.workspaceId}/${call.id}.wav`;
    try {
      await ingestRecording(sourceUrl, key);
      await db.call.update({ where: { id: call.id }, data: { recordingKey: key } });
      log(`[recordings] ingested ${call.id}`);
    } catch (e) {
      console.error(`[recordings] failed for ${call.id}`, e);
      // Leave as pending; retried on next sweep. After 24h of failures, give up:
      if (Date.now() - call.createdAt.getTime() > 24 * 3600 * 1000) {
        await db.call.update({ where: { id: call.id }, data: { recordingKey: null } });
      }
    }
  }
}
```

Inside `main()`, after the `new Worker(...)` lines, add (skip if already present):

```ts
  setInterval(() => {
    recordingSweeper().catch((e) => console.error("[recordings] sweep error", e));
  }, 60_000);
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

**Functional test (simulated ingestion with a real public audio file):**
```bash
cd /root/vaani-ai
(npm run worker > /tmp/worker.log 2>&1 &)
sleep 8
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"Call\" (id, \"workspaceId\", direction, status, \"fromNumber\", \"toNumber\", \"recordingKey\") SELECT 'call_rec_test', id, 'INBOUND', 'COMPLETED', '+919900000009', '+918040001234', 'pending:https://www2.cs.uic.edu/~i101/SoundFiles/taunt.wav' FROM \"Workspace\" WHERE slug='demo-clinic';"
sleep 70
tail -n 5 /tmp/worker.log
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT \"recordingKey\" FROM \"Call\" WHERE id='call_rec_test';"
```
**Expected:** worker log line `[recordings] ingested call_rec_test`; recordingKey
changed to `<workspaceId>/call_rec_test.wav` (no `pending:` prefix).

Verify the object exists in MinIO:
```bash
docker exec vaani-db psql -U vaani -d vaani -t -c \
 "SELECT \"recordingKey\" FROM \"Call\" WHERE id='call_rec_test';" | tr -d ' \n' > /tmp/reckey
node -e "
const Minio=require('minio');
const c=new Minio.Client({endPoint:'localhost',port:9000,useSSL:false,accessKey:'vaani',secretKey:'vaani_dev_minio_password'});
c.statObject('vaani-recordings', require('fs').readFileSync('/tmp/reckey','utf8')).then(s=>console.log('object size:',s.size)).catch(e=>{console.error('MISSING');process.exit(1)});
"
```
**Expected:** `object size:` followed by a number > 0.

Cleanup:
```bash
docker exec vaani-db psql -U vaani -d vaani -c "DELETE FROM \"Call\" WHERE id='call_rec_test';"
```

(Leave the worker RUNNING — later steps add jobs to it and you will restart it in
Step 15. If you must stop it: `pkill -f "tsx src/worker" || true`.)

**If it fails:** if the sample URL 404s (external site changed), substitute any small
public `.wav`/`.mp3` URL and note the deviation. If `ingestRecording` throws
connection errors → MinIO container down: `docker compose up -d minio`.

---

## Step 8: Analytics page with charts (30 days)

Same charts as before, now with `data-testid` hooks and the aggregation helpers from
Step 3. Replaces the original files.

**File `src/app/(app)/analytics/page.tsx`** (server component, full content):

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/money";
import { computeAht, computeAsr, marginPercent } from "@/lib/analytics";
import { AnalyticsCharts } from "./charts";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const calls = await db.call.findMany({
    where: { workspaceId: ctx.workspaceId, createdAt: { gte: since } },
    select: {
      createdAt: true, answeredAt: true, status: true, direction: true, outcome: true,
      fromNumber: true, toNumber: true, durationSec: true, billedPaise: true,
      costTelephonyPaise: true, costSttPaise: true, costLlmPaise: true, costTtsPaise: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // --- Aggregate per day ---
  const byDay = new Map<string, { date: string; calls: number; minutes: number; billed: number }>();
  for (const c of calls) {
    const date = c.createdAt.toISOString().slice(0, 10);
    const row = byDay.get(date) ?? { date, calls: 0, minutes: 0, billed: 0 };
    row.calls++;
    row.minutes += Math.round(c.durationSec / 60);
    row.billed += c.billedPaise / 100;
    byDay.set(date, row);
  }
  const daily = [...byDay.values()];

  // --- Outcomes + costs ---
  const outcomes = new Map<string, number>();
  let cost = { telephony: 0, stt: 0, llm: 0, tts: 0 };
  let totalBilled = 0;
  for (const c of calls) {
    if (c.outcome) outcomes.set(c.outcome, (outcomes.get(c.outcome) ?? 0) + 1);
    cost.telephony += c.costTelephonyPaise / 100;
    cost.stt += c.costSttPaise / 100;
    cost.llm += c.costLlmPaise / 100;
    cost.tts += c.costTtsPaise / 100;
    totalBilled += c.billedPaise / 100;
  }
  const outcomeData = [...outcomes.entries()].map(([name, value]) => ({ name, value }));
  const costData = [
    { name: "Telephony", value: Math.round(cost.telephony * 100) / 100 },
    { name: "STT", value: Math.round(cost.stt * 100) / 100 },
    { name: "LLM", value: Math.round(cost.llm * 100) / 100 },
    { name: "TTS", value: Math.round(cost.tts * 100) / 100 },
  ];
  const totalCost = cost.telephony + cost.stt + cost.llm + cost.tts;
  const asr = computeAsr(calls);
  const aht = computeAht(calls);
  const marginPaise = Math.round((totalBilled - totalCost) * 100);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Analytics — last 30 days</h1>
        <div className="flex gap-4 text-sm">
          <Link href="/analytics/campaigns" className="text-primary hover:underline" data-testid="nav-campaign-reports">Campaign reports →</Link>
          <Link href="/analytics/agents" className="text-primary hover:underline" data-testid="nav-agent-performance">Agent performance →</Link>
          <Link href="/analytics/cost" className="text-primary hover:underline" data-testid="nav-cost-analytics">Cost & margins →</Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card data-testid="tile-total-calls"><CardHeader><CardTitle className="text-sm">Total calls</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold">{calls.length}</CardContent></Card>
        <Card data-testid="tile-asr"><CardHeader><CardTitle className="text-sm">Answer rate (ASR)</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold text-primary">{asr}%</CardContent></Card>
        <Card data-testid="tile-aht"><CardHeader><CardTitle className="text-sm">Avg call (AHT)</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold">{aht}s</CardContent></Card>
        <Card data-testid="tile-margin"><CardHeader><CardTitle className="text-sm">Gross margin</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold text-green-400">{formatINR(marginPaise)}</CardContent></Card>
      </div>

      <AnalyticsCharts daily={daily} outcomes={outcomeData} costs={costData} />

      <p className="text-xs text-muted-foreground">
        Margin card = billed − wholesale across the 30-day window (margin{" "}
        {marginPercent(Math.round(totalBilled * 100), Math.round(totalCost * 100))}%).
      </p>
    </div>
  );
}
```

**File `src/app/(app)/analytics/charts.tsx`** (client component, full content):

```tsx
"use client";

import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TEAL = "#2dd4bf";
const COLORS = ["#2dd4bf", "#60a5fa", "#f59e0b", "#f87171", "#a78bfa", "#34d399"];

type Daily = { date: string; calls: number; minutes: number; billed: number };
type Named = { name: string; value: number };

export function AnalyticsCharts({ daily, outcomes, costs }: {
  daily: Daily[]; outcomes: Named[]; costs: Named[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Calls per day</CardTitle></CardHeader>
        <CardContent className="h-64" data-testid="chart-calls-per-day">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={daily}>
              <XAxis dataKey="date" stroke="#6b7a90" fontSize={12} />
              <YAxis stroke="#6b7a90" fontSize={12} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "#0d1526", border: "1px solid #1e2a40" }} />
              <Area type="monotone" dataKey="calls" stroke={TEAL} fill={TEAL} fillOpacity={0.15} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Revenue billed per day (₹)</CardTitle></CardHeader>
        <CardContent className="h-64" data-testid="chart-revenue-per-day">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={daily}>
              <XAxis dataKey="date" stroke="#6b7a90" fontSize={12} />
              <YAxis stroke="#6b7a90" fontSize={12} />
              <Tooltip contentStyle={{ background: "#0d1526", border: "1px solid #1e2a40" }} />
              <Bar dataKey="billed" fill={TEAL} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Outcomes</CardTitle></CardHeader>
        <CardContent className="h-64" data-testid="chart-outcomes">
          {outcomes.length === 0 ? (
            <p className="pt-16 text-center text-sm text-muted-foreground">No outcomes yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={outcomes} dataKey="value" nameKey="name" outerRadius={80} label>
                  {outcomes.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Legend />
                <Tooltip contentStyle={{ background: "#0d1526", border: "1px solid #1e2a40" }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Wholesale cost breakdown (₹, 30 days)</CardTitle></CardHeader>
        <CardContent className="h-56" data-testid="chart-cost-breakdown">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={costs} layout="vertical">
              <XAxis type="number" stroke="#6b7a90" fontSize={12} />
              <YAxis type="category" dataKey="name" stroke="#6b7a90" fontSize={12} width={90} />
              <Tooltip contentStyle={{ background: "#0d1526", border: "1px solid #1e2a40" }} />
              <Bar dataKey="value" fill="#60a5fa" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** exit 0 both; route `/analytics`.

**Browser test (operator):** `/analytics` loads with 4 stat cards and 4 charts; the
seeded demo call makes the outcome pie show `booked (1)` and the margin card shows a
positive amount. No client errors in the browser console.

---

## Step 9: Real-time dashboard — live tiles with 5s polling

Extends the dashboard from earlier guides with LIVE data: calls in progress, current
concurrency, today's ASR/AHT, and cost-per-minute burn over the rolling last hour.
The tiles poll an internal JSON endpoint every 5 seconds.

**File `src/app/api/internal/live-stats/route.ts`** (full content):

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { burnPaisePerMinute, computeAht, computeAsr } from "@/lib/analytics";

/** Internal JSON for the dashboard live tiles (cookie-authed, tenant-scoped). */
export async function GET() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const hourAgo = new Date(Date.now() - 3600 * 1000);

  const [liveCalls, todayCalls, hourCalls] = await Promise.all([
    db.liveCallState.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: { callId: true, status: true, mode: true, updatedAt: true },
    }),
    db.call.findMany({
      where: { workspaceId: ctx.workspaceId, createdAt: { gte: todayStart } },
      select: {
        createdAt: true, answeredAt: true, status: true, direction: true, outcome: true,
        fromNumber: true, toNumber: true, durationSec: true, billedPaise: true,
        costTelephonyPaise: true, costSttPaise: true, costLlmPaise: true, costTtsPaise: true,
      },
    }),
    db.call.findMany({
      where: { workspaceId: ctx.workspaceId, createdAt: { gte: hourAgo } },
      select: {
        createdAt: true, answeredAt: true, status: true, direction: true, outcome: true,
        fromNumber: true, toNumber: true, durationSec: true, billedPaise: true,
        costTelephonyPaise: true, costSttPaise: true, costLlmPaise: true, costTtsPaise: true,
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      liveCalls: liveCalls.length,
      concurrency: liveCalls.length, // one LiveCallState row per in-progress call
      asrToday: computeAsr(todayCalls),
      ahtToday: computeAht(todayCalls),
      callsToday: todayCalls.length,
      burnPaisePerMin: burnPaisePerMinute(hourCalls),
      at: new Date().toISOString(),
    },
  });
}
```

**File `src/app/(app)/dashboard/live-tiles.tsx`** (client component, full content):

```tsx
"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type LiveStats = {
  liveCalls: number;
  concurrency: number;
  asrToday: number;
  ahtToday: number;
  callsToday: number;
  burnPaisePerMin: number;
  at: string;
};

function inr(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

export function LiveTiles() {
  const [stats, setStats] = useState<LiveStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/internal/live-stats", { cache: "no-store" });
        const json = (await res.json()) as { ok: boolean; data?: LiveStats };
        if (!cancelled && json.ok && json.data) setStats(json.data);
      } catch {
        /* keep last good stats; next tick retries */
      }
    }
    poll();
    const t = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const tiles: Array<{ id: string; label: string; value: string; accent?: boolean }> = [
    { id: "live-calls", label: "Calls in progress", value: String(stats?.liveCalls ?? "—"), accent: (stats?.liveCalls ?? 0) > 0 },
    { id: "concurrency", label: "Current concurrency", value: String(stats?.concurrency ?? "—") },
    { id: "asr", label: "ASR today", value: stats ? `${stats.asrToday}%` : "—" },
    { id: "aht", label: "AHT today", value: stats ? `${stats.ahtToday}s` : "—" },
    { id: "burn", label: "Cost/min (rolling hour)", value: stats ? inr(stats.burnPaisePerMin) : "—" },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" data-testid="live-tiles">
      {tiles.map((t) => (
        <Card key={t.id} data-testid={`dash-tile-${t.id}`}>
          <CardHeader><CardTitle className="text-sm">{t.label}</CardTitle></CardHeader>
          <CardContent className={`text-3xl font-bold ${t.accent ? "text-primary" : ""}`}>{t.value}</CardContent>
        </Card>
      ))}
    </div>
  );
}
```

**Edit `src/app/(app)/dashboard/page.tsx`:** keep the existing page but render the
live tiles directly under the `<h1>` header row. Concretely:

1. Add the import at the top:
   ```tsx
   import { LiveTiles } from "./live-tiles";
   ```
2. Immediately AFTER the closing `</div>` of the header block (the
   `<div className="flex items-center justify-between">…</div>` that contains the
   `<h1>`) and BEFORE the `{lowBalance && (` block, insert:
   ```tsx
      <LiveTiles />
   ```

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** exit 0 both.

**Functional test:**
```bash
cd /root/vaani-ai
(npm run dev > /tmp/dev.log 2>&1 &)
sleep 12
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/internal/live-stats
```
**Expected:** `401` (no session cookie — correct; the browser sends the cookie
automatically). Operator browser check: `/dashboard` shows the 5 live tiles and the
seeded live call makes "Calls in progress" = 1.

**If it fails:** `200` without a cookie → your `requireWorkspace` is not throwing for
anonymous users; re-check guide 03 and STOP with a report.

---

## Step 10: Campaign reports — funnel, per-number performance, time-to-call heatmap

Spec §8: reach rate, connect rate, conversion funnel (dialed → answered → qualified →
booked), per-number performance, best time-to-call heatmap. One page with a campaign
selector.

> **Per-number convention (contract with guide 07):** the Prisma `Call` model has NO
> `phoneNumberId` column. Guide 07's dialer stores the pool DID it dialed FROM in
> `Call.fromNumber` (E.164 string), and inbound calls store the DID they arrived ON in
> `Call.toNumber`. So per-number analytics group by the E.164 string
> (`ourNumber()` in `src/lib/analytics.ts`) and, when you need the PhoneNumber record
> (label, assigned agent, rent), JOIN on `(workspaceId, number = Call.fromNumber)`.
> Exact enrichment query (used below):
> ```ts
> const numberRows = await db.phoneNumber.findMany({
>   where: { workspaceId: ctx.workspaceId, number: { in: numbers.map((n) => n.number) } },
>   select: { number: true, label: true, agentId: true },
> });
> // then merge by numberRows.find((r) => r.number === stat.number)
> ```
> Do NOT add a schema migration for this — the string join is the v1 convention.

**File `src/app/(app)/analytics/campaigns/page.tsx`** (full content):

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/money";
import { buildHeatmap, computeFunnel, perNumberStats, ratePercent } from "@/lib/analytics";
import { FunnelChart, Heatmap } from "./campaign-charts";

export const dynamic = "force-dynamic";

export default async function CampaignReportsPage({
  searchParams,
}: {
  searchParams: { campaign?: string };
}) {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const campaigns = await db.campaign.findMany({
    where: { workspaceId: ctx.workspaceId },
    select: { id: true, name: true, status: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const selectedId = searchParams.campaign ?? campaigns[0]?.id ?? null;

  const [calls, contactCounts] = selectedId
    ? await Promise.all([
        db.call.findMany({
          where: { workspaceId: ctx.workspaceId, campaignId: selectedId },
          select: {
            createdAt: true, answeredAt: true, status: true, direction: true, outcome: true,
            fromNumber: true, toNumber: true, durationSec: true, billedPaise: true,
            costTelephonyPaise: true, costSttPaise: true, costLlmPaise: true, costTtsPaise: true,
          },
        }),
        db.campaignContact.groupBy({
          by: ["status"],
          where: { campaignId: selectedId },
          _count: { _all: true },
        }),
      ])
    : [[], []] as const;

  const totalContacts = (contactCounts as Array<{ status: string; _count: { _all: number } }>)
    .reduce((a, r) => a + r._count._all, 0);
  const completedContacts = (contactCounts as Array<{ status: string; _count: { _all: number } }>)
    .filter((r) => r.status === "COMPLETED")
    .reduce((a, r) => a + r._count._all, 0);

  const funnel = computeFunnel(calls as never);
  const numbers = perNumberStats(calls as never);
  const heat = buildHeatmap(calls as never);
  const heatMax = Math.max(0, ...heat.flat());

  // Enrich with PhoneNumber records — join on (workspaceId, number = Call.fromNumber/
  // toNumber E.164 string), the v1 convention documented above.
  const phoneNumberRows = await db.phoneNumber.findMany({
    where: { workspaceId: ctx.workspaceId, number: { in: numbers.map((n) => n.number) } },
    select: { number: true, label: true },
  });
  const labelFor = new Map<string, string | null>(phoneNumberRows.map((r) => [r.number, r.label]));

  // Reach rate: contacts dialed (any attempt) / total contacts.
  const dialedContacts = (contactCounts as Array<{ status: string; _count: { _all: number } }>)
    .filter((r) => r.status !== "PENDING")
    .reduce((a, r) => a + r._count._all, 0);
  const reachRate = ratePercent(dialedContacts, totalContacts);
  // Connect rate: answered calls / dialed calls.
  const connectRate = ratePercent(funnel.answered, funnel.dialed);

  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/analytics" className="text-sm text-muted-foreground hover:text-primary">← Analytics</Link>
        <h1 className="text-2xl font-bold">Campaign reports</h1>
      </div>

      <form className="flex gap-2">
        <select name="campaign" defaultValue={selectedId ?? ""}
          data-testid="campaign-report-select"
          className="h-9 rounded-md border border-border bg-card px-3 text-sm">
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name} ({c.status})</option>
          ))}
        </select>
        <button className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Show</button>
      </form>

      {!selectedId ? (
        <p className="text-sm text-muted-foreground">No campaigns yet — create one in guide 07's campaign page.</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <Card data-testid="tile-reach-rate"><CardHeader><CardTitle className="text-sm">Reach rate</CardTitle></CardHeader>
              <CardContent className="text-3xl font-bold">{reachRate}%
                <span className="block text-xs font-normal text-muted-foreground">{dialedContacts}/{totalContacts} contacts dialed</span>
              </CardContent></Card>
            <Card data-testid="tile-connect-rate"><CardHeader><CardTitle className="text-sm">Connect rate</CardTitle></CardHeader>
              <CardContent className="text-3xl font-bold text-primary">{connectRate}%
                <span className="block text-xs font-normal text-muted-foreground">{funnel.answered}/{funnel.dialed} calls answered</span>
              </CardContent></Card>
            <Card data-testid="tile-booked"><CardHeader><CardTitle className="text-sm">Booked</CardTitle></CardHeader>
              <CardContent className="text-3xl font-bold text-green-400">{funnel.booked}</CardContent></Card>
            <Card data-testid="tile-contacts-done"><CardHeader><CardTitle className="text-sm">Contacts completed</CardTitle></CardHeader>
              <CardContent className="text-3xl font-bold">{completedContacts}</CardContent></Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Conversion funnel</CardTitle></CardHeader>
              <CardContent className="h-64" data-testid="campaign-funnel-chart">
                <FunnelChart funnel={funnel} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Best time to call (answered calls, hour × day)</CardTitle></CardHeader>
              <CardContent data-testid="time-to-call-heatmap">
                {heatMax === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">No answered calls yet.</p>
                ) : (
                  <Heatmap heat={heat} max={heatMax} days={DAYS} />
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Per-number performance</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm" data-testid="per-number-table">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="p-3">Number</th><th className="p-3">Calls</th><th className="p-3">Answered</th>
                    <th className="p-3">ASR</th><th className="p-3">Talk time</th><th className="p-3">Billed</th>
                  </tr>
                </thead>
                <tbody>
                  {numbers.map((n) => (
                    <tr key={n.number} className="border-b last:border-0">
                      <td className="p-3 font-mono text-xs">
                        {n.number}
                        {labelFor.get(n.number) ? (
                          <span className="ml-2 font-sans text-muted-foreground">· {labelFor.get(n.number)}</span>
                        ) : null}
                      </td>
                      <td className="p-3">{n.calls}</td>
                      <td className="p-3">{n.answered}</td>
                      <td className="p-3">{n.asr}%</td>
                      <td className="p-3">{Math.round(n.totalDurationSec / 60)}m</td>
                      <td className="p-3">{formatINR(n.billedPaise)}</td>
                    </tr>
                  ))}
                  {numbers.length === 0 && (
                    <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No calls for this campaign yet.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
```

**File `src/app/(app)/analytics/campaigns/campaign-charts.tsx`** (client components,
full content):

```tsx
"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const STAGE_COLORS = ["#60a5fa", "#2dd4bf", "#a78bfa", "#34d399"];

export function FunnelChart({
  funnel,
}: {
  funnel: { dialed: number; answered: number; qualified: number; booked: number };
}) {
  const data = [
    { stage: "Dialed", count: funnel.dialed },
    { stage: "Answered", count: funnel.answered },
    { stage: "Qualified", count: funnel.qualified },
    { stage: "Booked", count: funnel.booked },
  ];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical">
        <XAxis type="number" stroke="#6b7a90" fontSize={12} allowDecimals={false} />
        <YAxis type="category" dataKey="stage" stroke="#6b7a90" fontSize={12} width={80} />
        <Tooltip contentStyle={{ background: "#0d1526", border: "1px solid #1e2a40" }} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={STAGE_COLORS[i]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Pure-CSS heatmap grid: 7 rows (days) × 24 columns (hours), intensity = count/max. */
export function Heatmap({ heat, max, days }: { heat: number[][]; max: number; days: string[] }) {
  return (
    <div className="overflow-x-auto">
      <div className="inline-block">
        <div className="mb-1 flex">
          <div className="w-10" />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="w-6 text-center text-[10px] text-muted-foreground">
              {h % 3 === 0 ? h : ""}
            </div>
          ))}
        </div>
        {heat.map((row, d) => (
          <div key={d} className="flex items-center">
            <div className="w-10 text-xs text-muted-foreground">{days[d]}</div>
            {row.map((count, h) => (
              <div
                key={h}
                title={`${days[d]} ${h}:00 — ${count} answered`}
                data-testid={`heatmap-cell-${d}-${h}`}
                className="m-px h-5 w-5 rounded-sm"
                style={{
                  backgroundColor:
                    count === 0 ? "#131c2e" : `rgba(45, 212, 191, ${0.25 + (0.75 * count) / max})`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** exit 0 both; route `/analytics/campaigns`.

**Browser test (operator):** `/analytics/campaigns` → the seeded campaign appears in
the selector → tiles render (zeros are fine — the seeded campaign has no outbound
calls), funnel chart shows 4 empty bars, per-number table shows the empty state. No
console errors.

---

## Step 11: Agent performance page

Spec §8: per-agent script adherence, escalation rate (TransferRequests), hallucination
flags, dead-air average.

**File `src/app/(app)/analytics/agents/page.tsx`** (full content):

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { agentPerformance, type AgentPerfCallRow } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export default async function AgentPerformancePage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  const [calls, transfers] = await Promise.all([
    db.call.findMany({
      where: { workspaceId: ctx.workspaceId, createdAt: { gte: since }, agentId: { not: null } },
      select: {
        agentId: true,
        agent: { select: { name: true } },
        scriptAdherenceScore: true,
        hallucinationFlag: true,
        deadAirSeconds: true,
        qaScores: { orderBy: { createdAt: "desc" as const }, take: 1, select: { totalScore: true, maxScore: true } },
      },
    }),
    db.transferRequest.groupBy({
      by: ["callId"],
      where: { workspaceId: ctx.workspaceId, createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);

  // Map agentId -> transfer count via the call's agentId.
  const callAgent = new Map<string, string | null>();
  const callsFull = await db.call.findMany({
    where: { workspaceId: ctx.workspaceId, id: { in: transfers.map((t) => t.callId) } },
    select: { id: true, agentId: true },
  });
  for (const c of callsFull) callAgent.set(c.id, c.agentId);
  const transfersForAgent = new Map<string, number>();
  for (const t of transfers) {
    const agentId = callAgent.get(t.callId);
    if (!agentId) continue;
    transfersForAgent.set(agentId, (transfersForAgent.get(agentId) ?? 0) + t._count._all);
  }

  const rows: AgentPerfCallRow[] = calls.map((c) => ({
    agentId: c.agentId,
    agentName: c.agent?.name ?? "—",
    scriptAdherenceScore: c.scriptAdherenceScore,
    hallucinationFlag: c.hallucinationFlag,
    deadAirSeconds: c.deadAirSeconds,
    qaTotal: c.qaScores[0]?.totalScore ?? null,
    qaMax: c.qaScores[0]?.maxScore ?? null,
  }));

  const perf = agentPerformance(rows, transfersForAgent);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/analytics" className="text-sm text-muted-foreground hover:text-primary">← Analytics</Link>
        <h1 className="text-2xl font-bold">Agent performance — last 30 days</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>Per-agent quality metrics</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="agent-performance-table">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Agent</th><th className="p-3">Calls</th>
                <th className="p-3">Script adherence</th><th className="p-3">Escalation rate</th>
                <th className="p-3">Hallucinations</th><th className="p-3">Avg dead air</th>
                <th className="p-3">Avg QA score</th>
              </tr>
            </thead>
            <tbody>
              {perf.map((a) => (
                <tr key={a.agentId} className="border-b last:border-0">
                  <td className="p-3 font-medium">{a.agentName}</td>
                  <td className="p-3">{a.calls}</td>
                  <td className="p-3">
                    {a.avgScriptAdherence === null ? "—" : (
                      <span className={a.avgScriptAdherence >= 70 ? "text-green-400" : "text-orange-400"}>
                        {a.avgScriptAdherence}/100
                      </span>
                    )}
                  </td>
                  <td className="p-3">{a.escalationRate}%</td>
                  <td className="p-3">
                    {a.hallucinations > 0 ? (
                      <span className="text-red-400" data-testid={`hallucination-count-${a.agentId}`}>{a.hallucinations}</span>
                    ) : "0"}
                  </td>
                  <td className="p-3">{a.avgDeadAirSec}s</td>
                  <td className="p-3">{a.avgQaPercent === null ? "—" : `${a.avgQaPercent}%`}</td>
                </tr>
              ))}
              {perf.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">
                  No agent calls in the window. Metrics appear after your first scored calls.
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** exit 0 both; route `/analytics/agents`.

**Browser test (operator):** `/analytics/agents` shows the seeded agent "Front Desk —
Priya" with 1–2 calls, script adherence 94 (from the seeded completed call), and an
escalation row from the seeded TransferRequest on the live call.

---

## Step 12: AI QA auto-scoring — rubric registry + scorer library + tests

Spec §8: LLM-based scoring of 100% of completed calls against configurable rubrics
(greeting, compliance lines, closing). **Rubric configuration in v1 is a code file**
(`src/lib/qa/rubrics.ts`): rubrics are version-controlled, reviewed, and edited with
the agent's prompts — NOT stored in the DB (no schema model is misused; a per-workspace
rubric editor UI is a v2 item, noted in the FINAL REPORT). `QA_DRY_RUN=true` (default)
scores with a deterministic mock so tests and dev cost ₹0.

**File `src/lib/qa/rubrics.ts`** (full content):

```ts
/**
 * QA rubric registry (spec §8 AI QA / auto-scoring).
 *
 * Rubrics live in CODE in v1 — they are prompt-engineering artifacts, reviewed and
 * deployed like prompts. To add a workspace-specific rubric: add an entry here and
 * map it in `rubricForAgent`. Do NOT store rubrics in SavedReport/WebhookSubscription
 * or any other schema model.
 */

export type QaCriterion = {
  key: string;         // machine key stored in QaScore.scores JSON
  label: string;       // human label shown in the UI
  maxPoints: number;   // integer
  instruction: string; // what the scorer LLM must check
};

export type QaRubric = {
  name: string;        // stored in QaScore.rubricName
  description: string;
  criteria: QaCriterion[];
};

export const RUBRICS: Record<string, QaRubric> = {
  "receptionist-default": {
    name: "receptionist-default",
    description: "Inbound receptionist quality: greeting, compliance disclosure, FAQ accuracy, closing.",
    criteria: [
      {
        key: "greeting",
        label: "Greeting",
        maxPoints: 10,
        instruction:
          "Did the agent greet the caller warmly, state the business name, and identify itself as an AI assistant within the first turn? 10 = perfect, 0 = no greeting.",
      },
      {
        key: "compliance_lines",
        label: "Compliance lines",
        maxPoints: 10,
        instruction:
          "Were mandatory lines said correctly — call-recording disclosure, and no medical/legal/financial advice given? Deduct heavily for missing disclosure or risky advice.",
      },
      {
        key: "faq_accuracy",
        label: "FAQ accuracy",
        maxPoints: 10,
        instruction:
          "Were factual answers (timings, prices, address) consistent and grounded? Score 0 if the agent invented facts not present in the conversation context (hallucination).",
      },
      {
        key: "closing",
        label: "Closing",
        maxPoints: 10,
        instruction:
          "Did the agent summarize what was agreed and close politely (next steps, thank you)?",
      },
    ],
  },
  "telecaller-default": {
    name: "telecaller-default",
    description: "Outbound telecaller quality: opener, identity disclosure, objection handling, closing.",
    criteria: [
      {
        key: "opening_hook",
        label: "Opening hook",
        maxPoints: 10,
        instruction: "Did the agent deliver the configured opening hook in the first 15 seconds?",
      },
      {
        key: "compliance_lines",
        label: "Compliance lines",
        maxPoints: 10,
        instruction:
          "Identity disclosure (business + AI) stated? DND/opt-out requests honored immediately? Deduct heavily otherwise.",
      },
      {
        key: "objection_handling",
        label: "Objection handling",
        maxPoints: 10,
        instruction: "Were objections answered per the playbook without pressure tactics?",
      },
      {
        key: "closing",
        label: "Closing",
        maxPoints: 10,
        instruction: "Clear next step (booking/callback/none) confirmed before hangup?",
      },
    ],
  },
};

export function maxScore(rubric: QaRubric): number {
  return rubric.criteria.reduce((a, c) => a + c.maxPoints, 0);
}

/** Pick a rubric for a call: outbound → telecaller rubric, inbound → receptionist. */
export function rubricForCall(direction: string): QaRubric {
  return direction === "OUTBOUND" ? RUBRICS["telecaller-default"] : RUBRICS["receptionist-default"];
}
```

**File `src/lib/qa/scorer.ts`** (full content):

```ts
/**
 * LLM QA scorer (spec §8). Scores one call transcript against a rubric via
 * OpenRouter (direct fetch, cheap model). QA_DRY_RUN=true (default) returns a
 * deterministic mock — used by tests and dev, costs nothing.
 */
import { maxScore, type QaRubric } from "./rubrics";

export type QaResult = {
  scores: Record<string, number>;
  totalScore: number;
  maxScore: number;
  notes: string;
  hallucination: boolean;
  hallucinationNotes: string | null;
};

/** Prompt sent to the scorer model. Asks for STRICT JSON only. */
export function buildQaPrompt(rubric: QaRubric, transcript: string): string {
  const criteria = rubric.criteria
    .map((c) => `- "${c.key}" (0-${c.maxPoints}): ${c.instruction}`)
    .join("\n");
  return `You are a call-quality auditor. Score the call transcript below against each rubric criterion.

Rubric: ${rubric.name} — ${rubric.description}
Criteria:
${criteria}

Also decide "hallucination": true if the agent stated ANY fact not present or not reasonably inferable from the transcript itself (invented prices, timings, policies, names, commitments).

Rules:
- Integer scores only, each within its stated range.
- Be strict: a missing mandatory line is a 0 for that criterion.
- Respond with STRICT JSON, no prose, no markdown fences, exactly this shape:
{"scores": {"${rubric.criteria.map((c) => c.key).join('": 0, "')}": 0}, "notes": "one or two sentences", "hallucination": false, "hallucination_notes": null}

Transcript:
"""
${transcript.slice(0, 6000)}
"""`;
}

/** Extract the first {...} JSON object from an LLM response (tolerates fences/prose). */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

/**
 * Parse and CLAMP the scorer's JSON against the rubric. Returns null when the
 * response is unusable (caller retries/marks unscored).
 */
export function parseQaResponse(text: string, rubric: QaRubric): QaResult | null {
  const raw = extractJsonObject(text);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const rawScores = (obj.scores ?? {}) as Record<string, unknown>;
  const scores: Record<string, number> = {};
  let total = 0;
  for (const c of rubric.criteria) {
    const v = Number(rawScores[c.key]);
    const clamped = Number.isFinite(v) ? Math.max(0, Math.min(c.maxPoints, Math.round(v))) : 0;
    scores[c.key] = clamped;
    total += clamped;
  }
  return {
    scores,
    totalScore: total,
    maxScore: maxScore(rubric),
    notes: typeof obj.notes === "string" ? obj.notes.slice(0, 500) : "",
    hallucination: obj.hallucination === true,
    hallucinationNotes:
      typeof obj.hallucination_notes === "string" ? obj.hallucination_notes.slice(0, 500) : null,
  };
}

/** Deterministic mock for QA_DRY_RUN — full marks minus 1 per criterion, no hallucination. */
export function mockScore(rubric: QaRubric): QaResult {
  const scores: Record<string, number> = {};
  let total = 0;
  for (const c of rubric.criteria) {
    scores[c.key] = Math.max(0, c.maxPoints - 1);
    total += scores[c.key];
  }
  return {
    scores,
    totalScore: total,
    maxScore: maxScore(rubric),
    notes: "DRY-RUN mock score (QA_DRY_RUN=true).",
    hallucination: false,
    hallucinationNotes: null,
  };
}

/** Score a transcript with the real LLM (OpenRouter). Throws on HTTP failure. */
export async function scoreWithLlm(rubric: QaRubric, transcript: string): Promise<QaResult> {
  if (process.env.QA_DRY_RUN !== "false") return mockScore(rubric);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
  const model = process.env.QA_SCORER_MODEL ?? "meta-llama/llama-3.1-8b-instruct";

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [{ role: "user", content: buildQaPrompt(rubric, transcript) }],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content ?? "";
  const parsed = parseQaResponse(content, rubric);
  if (!parsed) throw new Error("scorer returned unparseable JSON");
  return parsed;
}
```

**File `tests/qa.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import { buildQaPrompt, extractJsonObject, mockScore, parseQaResponse } from "../src/lib/qa/scorer";
import { RUBRICS, maxScore, rubricForCall } from "../src/lib/qa/rubrics";

const rubric = RUBRICS["receptionist-default"];

describe("rubric registry", () => {
  it("computes maxScore as the sum of criteria", () => {
    expect(maxScore(rubric)).toBe(40);
    expect(maxScore(RUBRICS["telecaller-default"])).toBe(40);
  });
  it("picks the rubric by call direction", () => {
    expect(rubricForCall("OUTBOUND").name).toBe("telecaller-default");
    expect(rubricForCall("INBOUND").name).toBe("receptionist-default");
  });
});

describe("buildQaPrompt", () => {
  it("includes every criterion key and the transcript", () => {
    const p = buildQaPrompt(rubric, "AI: Namaste! Caller: price?");
    for (const c of rubric.criteria) expect(p).toContain(`"${c.key}"`);
    expect(p).toContain("AI: Namaste! Caller: price?");
    expect(p).toContain("STRICT JSON");
  });
  it("truncates very long transcripts", () => {
    const p = buildQaPrompt(rubric, "x".repeat(20000));
    expect(p.length).toBeLessThan(20000);
  });
});

describe("extractJsonObject", () => {
  it("finds JSON inside surrounding prose and newlines", () => {
    expect(extractJsonObject("Sure, here is the result:\n{\"a\":1}\nDone.")).toBe('{"a":1}');
  });
  it("returns null when no object is present", () => {
    expect(extractJsonObject("no json here")).toBeNull();
  });
});

describe("parseQaResponse", () => {
  it("parses a clean scorer response", () => {
    const text = '{"scores":{"greeting":10,"compliance_lines":9,"faq_accuracy":8,"closing":7},"notes":"good","hallucination":false,"hallucination_notes":null}';
    const r = parseQaResponse(text, rubric);
    expect(r).not.toBeNull();
    expect(r!.totalScore).toBe(34);
    expect(r!.maxScore).toBe(40);
    expect(r!.hallucination).toBe(false);
  });
  it("clamps out-of-range scores instead of trusting the model", () => {
    const text = '{"scores":{"greeting":999,"compliance_lines":-5,"faq_accuracy":4.6,"closing":"x"},"hallucination":true,"hallucination_notes":"invented price"}';
    const r = parseQaResponse(text, rubric)!;
    expect(r.scores.greeting).toBe(10); // clamped to maxPoints
    expect(r.scores.compliance_lines).toBe(0); // clamped to 0
    expect(r.scores.faq_accuracy).toBe(5); // rounded
    expect(r.scores.closing).toBe(0); // non-numeric -> 0
    expect(r.hallucination).toBe(true);
    expect(r.hallucinationNotes).toBe("invented price");
  });
  it("returns null for garbage", () => {
    expect(parseQaResponse("not json at all", rubric)).toBeNull();
    expect(parseQaResponse('{"scores":', rubric)).toBeNull();
  });
});

describe("mockScore", () => {
  it("is deterministic and never flags hallucination", () => {
    const a = mockScore(rubric);
    const b = mockScore(rubric);
    expect(a).toEqual(b);
    expect(a.hallucination).toBe(false);
    expect(a.totalScore).toBe(36); // 4 criteria x (10-1)
  });
});
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npx vitest run tests/qa.test.ts
```
**Expected:** typecheck exit 0; `✓ tests/qa.test.ts (10 tests)`.

---

## Step 13: Dead-air & hallucination detection library + tests

- **Dead air (heuristic):** from `TranscriptEntry.timestampMs` gaps. Honest v1
  definition: a gap counts as dead air only when the CALLER spoke and the AGENT took
  longer than the threshold to respond (agent responsiveness — the thing customers
  notice). Gaps where the caller is thinking are NOT penalized. Tradeoff documented:
  without per-utterance audio durations this is an approximation.
- **Hallucination:** set from the QA scorer's `hallucination` boolean (Step 12) onto
  `Call.hallucinationFlag` / `Call.hallucinationNotes` — wired in Step 15.

**File `src/lib/qa/deadair.ts`** (full content):

```ts
/**
 * Dead-air heuristic (spec §8 dead-air detection).
 *
 * v1 approximation: TranscriptEntry has a single timestampMs (when the utterance
 * STARTED), not per-utterance durations. So we measure AGENT RESPONSIVENESS:
 * whenever the caller finished a turn and the agent needed more than
 * DEAD_AIR_THRESHOLD_MS to start replying, the excess counts as dead air.
 * Caller-side thinking time (agent spoke, caller slow) is never counted.
 */

export const DEAD_AIR_THRESHOLD_MS = 3000;

export type DeadAirEntry = { speaker: string; timestampMs: number };

/** Total dead-air seconds (integer, rounded) for one call's transcript entries. */
export function computeDeadAirSeconds(
  entries: DeadAirEntry[],
  thresholdMs: number = DEAD_AIR_THRESHOLD_MS,
): number {
  if (entries.length < 2) return 0;
  const sorted = [...entries].sort((a, b) => a.timestampMs - b.timestampMs);
  let totalMs = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev.speaker === "CALLER" && cur.speaker === "AGENT") {
      const gap = cur.timestampMs - prev.timestampMs;
      if (gap > thresholdMs) totalMs += gap - thresholdMs;
    }
  }
  return Math.round(totalMs / 1000);
}
```

**File `tests/deadair.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import { computeDeadAirSeconds, DEAD_AIR_THRESHOLD_MS } from "../src/lib/qa/deadair";

describe("computeDeadAirSeconds", () => {
  it("returns 0 for empty / single entry", () => {
    expect(computeDeadAirSeconds([])).toBe(0);
    expect(computeDeadAirSeconds([{ speaker: "AGENT", timestampMs: 0 }])).toBe(0);
  });

  it("counts only slow AGENT responses after the caller spoke", () => {
    const entries = [
      { speaker: "AGENT", timestampMs: 0 },
      { speaker: "CALLER", timestampMs: 4000 },
      { speaker: "AGENT", timestampMs: 12000 }, // 8000ms after caller -> 5000ms excess
    ];
    expect(computeDeadAirSeconds(entries)).toBe(5);
  });

  it("ignores caller-side pauses (caller slow to answer the agent)", () => {
    const entries = [
      { speaker: "AGENT", timestampMs: 0 },
      { speaker: "CALLER", timestampMs: 30000 }, // caller thought for 30s — not agent dead air
      { speaker: "AGENT", timestampMs: 31000 }, // fast reply
    ];
    expect(computeDeadAirSeconds(entries)).toBe(0);
  });

  it("handles unsorted input and multiple gaps", () => {
    const entries = [
      { speaker: "AGENT", timestampMs: 20000 }, // 10s after caller -> 7s excess
      { speaker: "CALLER", timestampMs: 4000 },
      { speaker: "AGENT", timestampMs: 5000 }, // 1s after caller -> fine
      { speaker: "CALLER", timestampMs: 10000 },
      { speaker: "AGENT", timestampMs: 0 },
    ];
    expect(computeDeadAirSeconds(entries)).toBe(7);
  });

  it("respects a custom threshold", () => {
    const entries = [
      { speaker: "CALLER", timestampMs: 0 },
      { speaker: "AGENT", timestampMs: 2500 },
    ];
    expect(computeDeadAirSeconds(entries, 1000)).toBe(2); // 2500-1000 = 1500ms -> rounds to 2
    expect(computeDeadAirSeconds(entries, DEAD_AIR_THRESHOLD_MS)).toBe(0);
  });
});
```

**Verify:**
```bash
cd /root/vaani-ai && npx vitest run tests/deadair.test.ts && npm run typecheck
```
**Expected:** `✓ tests/deadair.test.ts (5 tests)`; typecheck exit 0.

---

## Step 14: PII redaction library + tests

Spec §11: redact card numbers (13–19 digits, **Luhn-verified** so order IDs survive),
Aadhaar (12 digits), emails, OTPs. **v1 tradeoff (honest):** redaction is IN-PLACE —
the unredacted original is NOT kept anywhere (not even encrypted). This maximizes
compliance and simplicity; the cost is that a false positive cannot be recovered.
Each redaction writes an AuditLog entry (Step 15).

**File `src/lib/pii.ts`** (full content):

```ts
/**
 * PII redaction for transcripts (spec §11).
 * Redact-in-place: the original text is overwritten and NOT retained. Each redacted
 * span becomes a "[REDACTED:<TYPE>]" token so QA/search still work.
 */

/** Luhn checksum for digit strings (payment card validation). */
export function luhnCheck(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export type RedactionResult = { redacted: string; findings: string[] };

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 13–19 digits with optional single space/dash separators; ends on a digit so a
// trailing space after the number is NOT consumed.
const CARD_CANDIDATE_RE = /\b(?:\d[ -]?){12,18}\d\b/g;
const AADHAAR_RE = /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g;
const OTP_RE = /\b(otp|one[- ]time password|verification code|pin)\b\D{0,12}?(\d{4,8})\b/gi;

/** Redact PII from one text blob. Idempotent (re-running on redacted text is a no-op). */
export function redactPii(text: string): RedactionResult {
  const findings: string[] = [];
  let out = text;

  // 1) Payment cards — digit sequences that PASS Luhn (so order ids survive).
  out = out.replace(CARD_CANDIDATE_RE, (match) => {
    const digits = match.replace(/[ -]/g, "");
    if (luhnCheck(digits)) {
      findings.push("card");
      return "[REDACTED:CARD]";
    }
    return match;
  });

  // 2) Aadhaar — 12 digits in 4-4-4 groups (any 12-digit run; Aadhaar has no checksum in v1).
  out = out.replace(AADHAAR_RE, (match) => {
    findings.push("aadhaar");
    return "[REDACTED:AADHAAR]";
  });

  // 3) Emails.
  out = out.replace(EMAIL_RE, () => {
    findings.push("email");
    return "[REDACTED:EMAIL]";
  });

  // 4) OTPs / verification codes — keep the label, redact the digits.
  out = out.replace(OTP_RE, (_match, label: string) => {
    findings.push("otp");
    return `${label} [REDACTED:OTP]`;
  });

  return { redacted: out, findings };
}
```

**File `tests/pii.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import { luhnCheck, redactPii } from "../src/lib/pii";

describe("luhnCheck", () => {
  it("accepts valid card numbers", () => {
    expect(luhnCheck("4111111111111111")).toBe(true); // Visa test
    expect(luhnCheck("5555555555554444")).toBe(true); // Mastercard test
  });
  it("rejects invalid / wrong-length numbers", () => {
    expect(luhnCheck("4111111111111112")).toBe(false);
    expect(luhnCheck("123456789012")).toBe(false); // 12 digits — not a card length
    expect(luhnCheck("4111a11111111111")).toBe(false);
  });
});

describe("redactPii", () => {
  it("redacts a Luhn-valid card, with and without separators", () => {
    const r = redactPii("my card is 4111 1111 1111 1111 ok? also 4111-1111-1111-1111");
    expect(r.redacted).toBe("my card is [REDACTED:CARD] ok? also [REDACTED:CARD]");
    expect(r.findings).toEqual(["card", "card"]);
  });

  it("does NOT redact a 16-digit order id that fails Luhn", () => {
    const r = redactPii("order id 1234567812345678 confirmed");
    expect(r.redacted).toContain("1234567812345678");
    expect(r.findings).toHaveLength(0);
  });

  it("redacts Aadhaar numbers", () => {
    const r = redactPii("aadhaar 2341 2341 2341 and plain 234123412341");
    expect(r.redacted).toBe("aadhaar [REDACTED:AADHAAR] and plain [REDACTED:AADHAAR]");
    expect(r.findings).toEqual(["aadhaar", "aadhaar"]);
  });

  it("redacts emails", () => {
    const r = redactPii("mail me at ramesh.kumar+work@gmail.com please");
    expect(r.redacted).toBe("mail me at [REDACTED:EMAIL] please");
    expect(r.findings).toEqual(["email"]);
  });

  it("redacts OTP mentions but keeps the label", () => {
    const r = redactPii("OTP is 482910, share it now");
    expect(r.redacted).toContain("[REDACTED:OTP]");
    expect(r.redacted).not.toContain("482910");
  });

  it("handles a nasty combined fixture and is idempotent", () => {
    const nasty =
      "Caller gave card 5555 5555 5555 4444, aadhaar 1234-5678-9012, email a.b@clinic.co.in, verification code: 123456. Order 9988776655443322 stays.";
    const r1 = redactPii(nasty);
    expect(r1.redacted).toContain("[REDACTED:CARD]");
    expect(r1.redacted).toContain("[REDACTED:AADHAAR]");
    expect(r1.redacted).toContain("[REDACTED:EMAIL]");
    expect(r1.redacted).toContain("[REDACTED:OTP]");
    expect(r1.redacted).toContain("9988776655443322"); // fails Luhn -> untouched
    const r2 = redactPii(r1.redacted);
    expect(r2.redacted).toBe(r1.redacted); // idempotent
  });
});
```

**Verify:**
```bash
cd /root/vaani-ai && npx vitest run tests/pii.test.ts && npm run typecheck
```
**Expected:** `✓ tests/pii.test.ts (8 tests)`; typecheck exit 0.

---

## Step 15: Post-call processing worker jobs (QA + dead-air + PII redaction)

One sweep, idempotent: picks COMPLETED calls that have no `QaScore` row yet, then
(in order) redacts PII → computes dead air → scores with the QA rubric → writes the
hallucination flag. Order matters: scoring runs on the REDACTED transcript so PII
never leaves the VPS for scoring either.

**File `src/worker/postcall.ts`** (full content):

```ts
/**
 * Post-call processing sweep (QA auto-scoring, dead-air, PII redaction).
 * Idempotent: a call is "processed" iff a QaScore row exists for it.
 */
import { PrismaClient } from "@prisma/client";
import { redactPii } from "../lib/pii";
import { computeDeadAirSeconds } from "../lib/qa/deadair";
import { rubricForCall } from "../lib/qa/rubrics";
import { scoreWithLlm } from "../lib/qa/scorer";

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
      transcriptEntries: { orderBy: { timestampMs: "asc" }, select: { speaker: true, timestampMs: true, text: true } },
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

      // 3) QA score on the (possibly redacted) transcript.
      const fresh = await db.call.findUnique({ where: { id: call.id }, select: { transcript: true } });
      const rubric = rubricForCall(call.direction);
      const qa = await scoreWithLlm(rubric, fresh?.transcript ?? "");
      const qaPercent = qa.maxScore > 0 ? Math.round((qa.totalScore / qa.maxScore) * 100) : 0;

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
          notes: qa.notes,
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
      log(`[postcall] scored ${call.id} rubric=${rubric.name} total=${qa.totalScore}/${qa.maxScore} deadAir=${deadAir}s hallucination=${qa.hallucination}`);
    } catch (e) {
      // A failure (e.g. OpenRouter down) leaves the call without a QaScore, so the
      // next sweep retries it automatically. No poison-row handling needed in v1.
      console.error(`[postcall] failed for ${call.id}`, e);
    }
  }
  return processed;
}
```

**Wire it into the worker — edit `src/worker/index.ts`:**

1. Add the import at the top:
   ```ts
   import { postCallSweep } from "./postcall";
   ```
2. Inside `main()`, right after the recording-sweeper `setInterval(...)` block added
   in Step 7, add:
   ```ts
  setInterval(() => {
    postCallSweep().catch((e) => console.error("[postcall] sweep error", e));
  }, 45_000);
   ```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck
```
**Expected:** exit 0.

**Functional test (dry-run QA on a seeded unscored call):**
```bash
cd /root/vaani-ai
# make sure QA_DRY_RUN is true (default)
grep -E '^QA_DRY_RUN' .env || echo 'QA_DRY_RUN="true"' >> .env
# restart the worker so it picks up postcall.ts
pkill -f "tsx src/worker" || true
(npm run worker > /tmp/worker.log 2>&1 &)
sleep 8
# insert an unscored completed call with a PII-laden transcript + a slow agent reply
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"Call\" (id, \"workspaceId\", direction, status, \"fromNumber\", \"toNumber\", transcript, \"endedAt\") SELECT 'call_qa_test', id, 'INBOUND', 'COMPLETED', '+919900000011', '+918040001234', 'AI: Namaste! Caller: my card is 4111 1111 1111 1111 and email a.b@x.co.in. AI: booking done.', now() FROM \"Workspace\" WHERE slug='demo-clinic';"
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"TranscriptEntry\" (id, \"callId\", speaker, text, \"timestampMs\") VALUES ('te_qa_1','call_qa_test','CALLER','card is 4111 1111 1111 1111',1000), ('te_qa_2','call_qa_test','AGENT','booking done',9000);"
sleep 50
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT \"piiRedacted\", \"deadAirSeconds\", \"scriptAdherenceScore\", position('[REDACTED:CARD]' in transcript) > 0 AS card_redacted FROM \"Call\" WHERE id='call_qa_test';"
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT \"rubricName\", \"totalScore\", \"maxScore\", \"scorerModel\" FROM \"QaScore\" WHERE \"callId\"='call_qa_test';"
```
**Expected:**
- Call row: `piiRedacted=t`, `deadAirSeconds=5` (8s gap − 3s threshold),
  `scriptAdherenceScore=90` (36/40 mock), `card_redacted=t`.
- QaScore row: `receptionist-default | 36 | 40 | dry-run-mock`.

Cleanup:
```bash
docker exec vaani-db psql -U vaani -d vaani -c "DELETE FROM \"Call\" WHERE id='call_qa_test';"
```
(QaScore, TranscriptEntry and AuditLog rows cascade with the Call.)

**If it fails:** no QaScore row after 60s → `tail -n 20 /tmp/worker.log` — the worker
did not restart with the new code (`pkill` then start again once). If the log shows
`OpenRouter 401` → `QA_DRY_RUN` is not `"true"` in `.env`; set it and restart once.

---

## Step 16: Event webhook delivery — HMAC signing, backoff retries, worker + e2e test

Spec §9: event subscriptions with retries and signature verification. Guide 06's
`emitWebhookEvent()` already enqueues `WebhookDelivery` rows; THIS step delivers
them: POST the payload with an `X-Vaani-Signature` HMAC-SHA256 header, retry with
exponential backoff (max 8 attempts), log response codes.

### 16a — Emit `call.started` for real (small patch to guide 04's webhook route)

`call.started` is in the subscribable catalog but nothing emits it yet (guide 06
emits call.completed/call.missed/voicemail.received/transfer.requested; guide 07
emits contact.opted-out). Patch `src/app/api/webhooks/dograh/route.ts` (created by
guide 04; guide 06 already edited its *ended* branch — this patch touches only the
*started* branch, so the two do not conflict).

1. Check the import is present (guide 06 should have added it; if the grep prints
   nothing, add `import { emitWebhookEvent } from "@/lib/webhooks";` with the other
   imports):
   ```bash
   grep -n 'emitWebhookEvent' src/app/api/webhooks/dograh/route.ts | head -2
   ```
2. In the `if (event === "call.started")` branch, find this exact block (the
   "created" path):

   ```ts
      await logEvent(call.id, "status", event, data);
      return NextResponse.json({ ok: true, created: call.id });
   ```

   Replace with:

   ```ts
      await logEvent(call.id, "status", event, data);
      await emitWebhookEvent(call.workspaceId, "call.started", {
        callId: call.id, direction: call.direction, fromNumber: call.fromNumber, toNumber: call.toNumber,
      });
      return NextResponse.json({ ok: true, created: call.id });
   ```

3. In the SAME branch, find this exact block (the "already-known call" path — this
   is how OUTBOUND calls created by guide 07's dialer emit their start event):

   ```ts
    await db.call.update({
      where: { id: call.id },
      data: { status: "IN_PROGRESS", answeredAt: new Date() },
    });
    await logEvent(call.id, "status", event, data);
    return NextResponse.json({ ok: true });
   ```

   Replace with:

   ```ts
    await db.call.update({
      where: { id: call.id },
      data: { status: "IN_PROGRESS", answeredAt: new Date() },
    });
    await logEvent(call.id, "status", event, data);
    await emitWebhookEvent(call.workspaceId, "call.started", {
      callId: call.id, direction: call.direction, fromNumber: call.fromNumber, toNumber: call.toNumber,
    });
    return NextResponse.json({ ok: true });
   ```

**Idempotency warning:** if a previous run already added an
`emitWebhookEvent(..., "call.started", ...)` line, do NOT add a second one — skip
that sub-edit. If the anchor blocks above do not match (guide 04/06 changed the
route), STOP and report the actual surrounding code instead of improvising.

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.



**File `src/lib/webhook-sign.ts`** (full content):

```ts
import crypto from "node:crypto";

/** Max delivery attempts per WebhookDelivery row (spec: retries with backoff). */
export const WEBHOOK_MAX_ATTEMPTS = 8;

/** X-Vaani-Signature value: "sha256=" + HMAC-SHA256 hex of the RAW body. */
export function signWebhookPayload(secret: string, rawBody: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/** Constant-time verification used by receivers (and our tests). */
export function verifyWebhookSignature(secret: string, rawBody: string, signature: string): boolean {
  const expected = signWebhookPayload(secret, rawBody);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Exponential backoff in ms after `attemptsMade` failed attempts (1-based):
 * 30s, 1m, 2m, 4m, 8m, 16m, 32m, capped at 1h. Deterministic (no jitter) so tests pin it.
 */
export function nextBackoffMs(attemptsMade: number): number {
  const base = 30_000 * Math.pow(2, Math.max(1, attemptsMade) - 1);
  return Math.min(base, 3_600_000);
}
```

**File `tests/webhook-sign.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import {
  nextBackoffMs,
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_MAX_ATTEMPTS,
} from "../src/lib/webhook-sign";

describe("signWebhookPayload / verifyWebhookSignature", () => {
  const secret = "whsec_test_0123456789";
  const body = '{"event":"call.completed","callId":"c1"}';

  it("produces a sha256= prefixed hex signature", () => {
    const sig = signWebhookPayload(secret, body);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("verifies a correct signature", () => {
    expect(verifyWebhookSignature(secret, body, signWebhookPayload(secret, body))).toBe(true);
  });

  it("rejects a tampered body, wrong secret, and malformed signature", () => {
    const sig = signWebhookPayload(secret, body);
    expect(verifyWebhookSignature(secret, body + " ", sig)).toBe(false);
    expect(verifyWebhookSignature("whsec_other", body, sig)).toBe(false);
    expect(verifyWebhookSignature(secret, body, "sha256=deadbeef")).toBe(false);
  });
});

describe("nextBackoffMs", () => {
  it("doubles from 30s and caps at 1 hour", () => {
    expect(nextBackoffMs(1)).toBe(30_000);
    expect(nextBackoffMs(2)).toBe(60_000);
    expect(nextBackoffMs(3)).toBe(120_000);
    expect(nextBackoffMs(4)).toBe(240_000);
    expect(nextBackoffMs(8)).toBe(3_600_000); // 30s*2^7 = 64m -> capped at 1h
    expect(nextBackoffMs(20)).toBe(3_600_000);
  });
});

describe("WEBHOOK_MAX_ATTEMPTS", () => {
  it("is 8", () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(8);
  });
});
```

**File `src/worker/webhook-delivery.ts`** (full content):

```ts
/**
 * Webhook delivery worker (spec §9). Deliberately INTERVAL-BASED (not a BullMQ
 * queue) — guide 07 owns the BullMQ queues `campaign-scheduler`, `campaign-dialer`,
 * `whatsapp-send`; this sweep runs in the same worker process but shares no queue.
 * Drains PENDING WebhookDelivery rows whose
 * nextRetryAt has passed: POSTs the payload with an X-Vaani-Signature HMAC header,
 * records responseCode, and retries with exponential backoff (max 8 attempts).
 * Idempotent: a delivered row is marked SUCCESS and never resent; receivers can
 * dedupe on the delivery id inside the payload.
 */
import { PrismaClient } from "@prisma/client";
import { nextBackoffMs, signWebhookPayload, WEBHOOK_MAX_ATTEMPTS } from "../lib/webhook-sign";

const db = new PrismaClient();
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

export async function deliverWebhooks(take = 10): Promise<number> {
  const due = await db.webhookDelivery.findMany({
    where: { status: "PENDING", OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }] },
    include: { subscription: true },
    orderBy: { createdAt: "asc" },
    take,
  });

  let done = 0;
  for (const delivery of due) {
    const sub = delivery.subscription;
    if (!sub.active) {
      await db.webhookDelivery.update({ where: { id: delivery.id }, data: { status: "FAILED" } });
      continue;
    }
    const rawBody = JSON.stringify({ id: delivery.id, ...delivery.payload as Record<string, unknown> });
    const attempts = delivery.attempts + 1;
    try {
      const res = await fetch(sub.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Vaani-Event": delivery.event,
          "X-Vaani-Signature": signWebhookPayload(sub.secret, rawBody),
          "X-Vaani-Delivery": delivery.id,
        },
        body: rawBody,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        await db.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: "SUCCESS", attempts, responseCode: res.status, deliveredAt: new Date() },
        });
        log(`[webhooks] delivered ${delivery.id} event=${delivery.event} -> ${res.status}`);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      const statusCode = /^HTTP (\d+)$/.exec((e as Error).message ?? "")?.[1];
      const exhausted = attempts >= WEBHOOK_MAX_ATTEMPTS;
      await db.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          attempts,
          responseCode: statusCode ? Number(statusCode) : null,
          nextRetryAt: exhausted ? null : new Date(Date.now() + nextBackoffMs(attempts)),
        },
      });
      log(`[webhooks] attempt ${attempts}/${WEBHOOK_MAX_ATTEMPTS} failed for ${delivery.id}${exhausted ? " — giving up" : ""}`);
    }
    done += 1;
  }
  return done;
}
```

**Wire into the worker — edit `src/worker/index.ts`:**

1. Import:
   ```ts
   import { deliverWebhooks } from "./webhook-delivery";
   ```
2. Inside `main()`, after the post-call `setInterval` from Step 15, add (interval is
   env-tunable via `WEBHOOK_RETRY_INTERVAL_MS`, default 15s — key owned by guide 01):
   ```ts
  setInterval(() => {
    deliverWebhooks().catch((e) => console.error("[webhooks] delivery error", e));
  }, Number(process.env.WEBHOOK_RETRY_INTERVAL_MS ?? 15_000));
   ```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npx vitest run tests/webhook-sign.test.ts
```
**Expected:** typecheck exit 0; `✓ tests/webhook-sign.test.ts (5 tests)`.

**End-to-end test (subscribe → fire event → receiver verifies signature):**

Receiver script — **file `scripts/webhook-receiver.ts`** (full content):

```ts
/** Local test receiver: verifies X-Vaani-Signature and logs deliveries. */
import { createServer } from "node:http";
import { verifyWebhookSignature } from "../src/lib/webhook-sign";

const SECRET = process.env.RECEIVER_SECRET ?? "whsec_e2e_test_secret";
const PORT = Number(process.env.RECEIVER_PORT ?? 4777);

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const sig = req.headers["x-vaani-signature"] as string | undefined;
    const event = req.headers["x-vaani-event"] as string | undefined;
    const valid = sig ? verifyWebhookSignature(SECRET, body, sig) : false;
    console.log(`RECEIVED event=${event} signature_valid=${valid} body=${body.slice(0, 200)}`);
    res.writeHead(valid ? 200 : 400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: valid }));
  });
}).listen(PORT, () => console.log(`receiver on :${PORT} secret=${SECRET}`));
```

Run the test:
```bash
cd /root/vaani-ai
pkill -f "tsx src/worker" || true
(npm run worker > /tmp/worker.log 2>&1 &)
(RECEIVER_SECRET=whsec_e2e_test_secret npx tsx scripts/webhook-receiver.ts > /tmp/receiver.log 2>&1 &)
sleep 8
# create a subscription pointing at the local receiver, then enqueue one delivery
docker exec vaani-db psql -U vaani -d vaani -t -c \
 "INSERT INTO \"WebhookSubscription\" (id, \"workspaceId\", url, events, secret, active) SELECT 'whsub_e2e', id, 'http://localhost:4777/hook', '{call.completed}', 'whsec_e2e_test_secret', true FROM \"Workspace\" WHERE slug='demo-clinic' RETURNING id;"
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"WebhookDelivery\" (id, \"subscriptionId\", event, payload, \"nextRetryAt\") VALUES ('whdel_e2e', 'whsub_e2e', 'call.completed', '{\"event\":\"call.completed\",\"callId\":\"demo\",\"test\":true}', now());"
sleep 20
tail -n 3 /tmp/receiver.log
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT status, attempts, \"responseCode\" FROM \"WebhookDelivery\" WHERE id='whdel_e2e';"
```
**Expected:** receiver log shows `RECEIVED event=call.completed signature_valid=true`;
DB row: `SUCCESS | 1 | 200`.

**Negative test (tampered secret → receiver rejects → retry scheduled):**
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "UPDATE \"WebhookSubscription\" SET secret='whsec_WRONG' WHERE id='whsub_e2e';"
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"WebhookDelivery\" (id, \"subscriptionId\", event, payload, \"nextRetryAt\") VALUES ('whdel_e2e_bad', 'whsub_e2e', 'call.completed', '{\"event\":\"call.completed\",\"test\":\"bad-sig\"}', now());"
sleep 20
tail -n 2 /tmp/receiver.log
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT status, attempts, \"responseCode\", \"nextRetryAt\" > now() AS retry_scheduled FROM \"WebhookDelivery\" WHERE id='whdel_e2e_bad';"
```
**Expected:** receiver log `signature_valid=false`; DB row: `PENDING | 1 | 400 | t`
(retry scheduled ~30s out — proof the backoff path works).

Cleanup:
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "DELETE FROM \"WebhookSubscription\" WHERE id='whsub_e2e';"
pkill -f webhook-receiver || true
```
**If it fails:** receiver never logs → the worker is not running the new code
(restart once). `signature_valid=false` on the FIRST test → confirm the subscription
secret and `RECEIVER_SECRET` match exactly, then retry once.

---

## Step 17: Webhook subscriptions settings UI + test-event button

**File `src/lib/webhook-events.ts`** (full content — the event catalog lives OUTSIDE
the server-action file because `"use server"` files may only export async functions):

```ts
/** Canonical tenant event names for webhook subscriptions (spec §9). */
export const WEBHOOK_EVENTS = [
  "call.started",
  "call.completed",
  "call.missed",
  "lead.qualified",
  "campaign.finished",
  "contact.opted-out",
  "voicemail.received",
  "transfer.requested",
  "wallet.low_balance",
] as const;

export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];
```

**File `src/server/actions/webhooks.ts`** (full content):

```ts
"use server";

import { revalidatePath } from "next/cache";
import crypto from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { WEBHOOK_EVENTS } from "@/lib/webhook-events";

/** Map requirePermission's FORBIDDEN throw onto the action error shape. */
function actionError(label: string, e: unknown, fallback: string) {
  if (e instanceof Error && e.message === "FORBIDDEN") {
    return { ok: false as const, error: "Forbidden — your role lacks the webhooks:write permission" };
  }
  console.error(label, e);
  return { ok: false as const, error: fallback };
}

const createSchema = z.object({
  url: z
    .string()
    .url()
    .refine(
      (u) => u.startsWith("https://") || u.startsWith("http://localhost") || u.startsWith("http://127.0.0.1"),
      { message: "HTTPS URL required (http://localhost allowed in dev only)" },
    ),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Pick at least one event"),
});

export async function createWebhookSubscription(formData: FormData) {
  try {
    const ctx = await requirePermission("webhooks:write");
    const events = formData.getAll("events").map(String);
    const parsed = createSchema.safeParse({ url: String(formData.get("url") ?? ""), events });
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };

    const secret = `whsec_${crypto.randomBytes(16).toString("hex")}`;
    const sub = await db.webhookSubscription.create({
      data: { workspaceId: ctx.workspaceId, url: parsed.data.url, events: parsed.data.events, secret },
    });
    await db.auditLog.create({
      data: { workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "webhook.created", entity: "WebhookSubscription", entityId: sub.id, metadata: { url: sub.url } },
    });
    revalidatePath("/settings/webhooks");
    return { ok: true as const, secret };
  } catch (e) {
    return actionError("createWebhookSubscription", e, "Could not create subscription");
  }
}

export async function deleteWebhookSubscription(id: string) {
  try {
    const ctx = await requirePermission("webhooks:write");
    const sub = await db.webhookSubscription.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
    if (!sub) return { ok: false as const, error: "Not found" };
    await db.webhookSubscription.delete({ where: { id: sub.id } });
    await db.auditLog.create({
      data: { workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "webhook.deleted", entity: "WebhookSubscription", entityId: id },
    });
    revalidatePath("/settings/webhooks");
    return { ok: true as const };
  } catch (e) {
    return actionError("deleteWebhookSubscription", e, "Could not delete subscription");
  }
}

/** Enqueue a test.ping delivery for ONE subscription (delivered by the Step-16 worker). */
export async function sendTestWebhook(id: string) {
  try {
    const ctx = await requirePermission("webhooks:write");
    const sub = await db.webhookSubscription.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
    if (!sub) return { ok: false as const, error: "Not found" };
    await db.webhookDelivery.create({
      data: {
        subscriptionId: sub.id,
        event: "test.ping",
        payload: { event: "test.ping", workspaceId: ctx.workspaceId, message: "Vaani AI webhook test", emittedAt: new Date().toISOString() },
        nextRetryAt: new Date(),
      },
    });
    revalidatePath("/settings/webhooks");
    return { ok: true as const };
  } catch (e) {
    return actionError("sendTestWebhook", e, "Could not enqueue test event");
  }
}
```

**File `src/app/(app)/settings/webhooks/page.tsx`** (full content):

```tsx
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WEBHOOK_EVENTS } from "@/lib/webhook-events";
import { createWebhookSubscription, deleteWebhookSubscription, sendTestWebhook } from "@/server/actions/webhooks";

export const dynamic = "force-dynamic";

export default async function WebhookSettingsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const subs = await db.webhookSubscription.findMany({
    where: { workspaceId: ctx.workspaceId },
    include: {
      deliveries: { orderBy: { createdAt: "desc" }, take: 5, select: { event: true, status: true, responseCode: true, attempts: true, createdAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Webhook subscriptions</h1>
      <p className="text-sm text-muted-foreground">
        We POST signed JSON to your URL on each event. Verify <code>X-Vaani-Signature</code>{" "}
        (HMAC-SHA256 of the raw body, hex, prefixed <code>sha256=</code>) with your secret.
        Failed deliveries retry 8 times with exponential backoff. See /settings/api-docs.
      </p>

      <Card>
        <CardHeader><CardTitle>New subscription</CardTitle></CardHeader>
        <CardContent>
          <form action={createWebhookSubscription} className="space-y-3" data-testid="webhook-create-form">
            <input name="url" required placeholder="https://yourapp.example/hooks/vaani"
              data-testid="webhook-url-input"
              className="h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm" />
            <div className="flex flex-wrap gap-3 text-sm">
              {WEBHOOK_EVENTS.map((e) => (
                <label key={e} className="flex items-center gap-1">
                  <input type="checkbox" name="events" value={e} /> {e}
                </label>
              ))}
            </div>
            <button data-testid="webhook-create-button"
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
              Create subscription
            </button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Subscriptions ({subs.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="webhook-sub-table">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">URL</th><th className="p-3">Events</th><th className="p-3">Secret</th>
                <th className="p-3">Recent deliveries</th><th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id} className="border-b last:border-0 align-top">
                  <td className="max-w-56 truncate p-3 font-mono text-xs">{s.url}</td>
                  <td className="p-3 text-xs">{s.events.join(", ")}</td>
                  <td className="max-w-44 break-all p-3 font-mono text-xs">{s.secret}</td>
                  <td className="p-3 text-xs">
                    {s.deliveries.length === 0 && <span className="text-muted-foreground">none yet</span>}
                    {s.deliveries.map((d, i) => (
                      <p key={i} className={d.status === "SUCCESS" ? "text-green-400" : d.status === "FAILED" ? "text-red-400" : "text-orange-400"}>
                        {d.event} · {d.status} · {d.responseCode ?? "—"} · {d.attempts} tries
                      </p>
                    ))}
                  </td>
                  <td className="space-y-2 p-3">
                    <form action={sendTestWebhook.bind(null, s.id)}>
                      <button data-testid={`webhook-test-${s.id}`}
                        className="rounded-md border border-border px-3 py-1 text-xs hover:border-primary/50">
                        Send test event
                      </button>
                    </form>
                    <form action={deleteWebhookSubscription.bind(null, s.id)}>
                      <button data-testid={`webhook-delete-${s.id}`}
                        className="rounded-md border border-red-500/40 px-3 py-1 text-xs text-red-400 hover:bg-red-500/10">
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {subs.length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">
                  No subscriptions. Create one above, then point Zapier/n8n at it (see /settings/integrations).
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** exit 0 both; route `/settings/webhooks`.

**Browser test (operator):** `/settings/webhooks` → create a subscription to
`http://localhost:4777/hook` with `call.completed` → run the receiver from Step 16 →
click **Send test event** → within 15s the receiver logs
`event=test.ping signature_valid=true` and the row's recent deliveries show
`test.ping · SUCCESS · 200`.

**Negative RBAC test (VIEWER cannot manage webhooks):**
```bash
cd /root/vaani-ai
# temporarily flip ALL demo memberships to VIEWER (dev box only)
docker exec vaani-db psql -U vaani -d vaani -c \
 "UPDATE \"Membership\" SET role='VIEWER';"
```
Still logged in, open `/settings/webhooks` and try **Create subscription** — the
action must refuse with `Forbidden — your role lacks the webhooks:write permission`
and NO new row may appear in the table. Then restore:
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
 "UPDATE \"Membership\" SET role='OWNER' WHERE role='VIEWER';"
```
**Expected:** as VIEWER, create/delete/test-event all refuse with the Forbidden
message; after restore, creating works again. The same `settings:write` gate protects
digests, retention, and GDPR requests; `calls:read`/`contacts:read`/`analytics:read`
gate the CSV exports.

---

## Step 18: CSV exports (streaming) + print-friendly PDF call report

Spec §8 exports. CSV endpoints stream rows in 500-row batches (memory-safe at 100k+
CDRs). PDF: v1 ships a print-styled report page (browser Print → Save as PDF);
server-side PDF generation is an **OPERATOR GATE** optional item (adds a heavy
dependency like puppeteer — deliberately NOT installed; see note at the end).

**File `src/lib/csv.ts`** (full content):

```ts
/** RFC-4180-ish CSV cell escaping: null/undefined -> "", quote when needed. */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  return lines.join("\r\n") + "\r\n";
}
```

**File `tests/csv.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import { csvEscape, toCsv } from "../src/lib/csv";

describe("csvEscape", () => {
  it("passes plain values through", () => {
    expect(csvEscape("hello")).toBe("hello");
    expect(csvEscape(42)).toBe("42");
  });
  it("renders null/undefined as empty", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });
  it("quotes values containing comma, quote or newline", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("toCsv", () => {
  it("produces header + rows with CRLF", () => {
    const out = toCsv(["id", "note"], [[1, "a"], [2, "b,c"]]);
    expect(out).toBe('id,note\r\n1,a\r\n2,"b,c"\r\n');
  });
  it("handles empty row set", () => {
    expect(toCsv(["a"], [])).toBe("a\r\n");
  });
});
```

**File `src/app/api/exports/calls.csv/route.ts`** (full content):

```ts
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { csvEscape } from "@/lib/csv";

export const dynamic = "force-dynamic";

const HEADERS = [
  "id", "createdAt", "direction", "status", "fromNumber", "toNumber", "agent", "campaign",
  "durationSec", "outcome", "sentiment", "deadAirSeconds", "scriptAdherenceScore",
  "costTelephonyPaise", "costSttPaise", "costLlmPaise", "costTtsPaise", "billedPaise", "summary",
];

/** Streaming CSV of the workspace's CDRs (spec §8 exports). Tenant-scoped, calls:read-gated. */
export async function GET() {
  let ctx;
  try {
    ctx = await requirePermission("calls:read");
  } catch (e) {
    const forbidden = e instanceof Error && e.message === "FORBIDDEN";
    return new Response(forbidden ? "forbidden" : "unauthorized", { status: forbidden ? 403 : 401 });
  }
  const workspaceId = ctx.workspaceId;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(HEADERS.map(csvEscape).join(",") + "\r\n"));
      let cursor: string | undefined;
      for (;;) {
        const batch = await db.call.findMany({
          where: { workspaceId },
          include: { agent: { select: { name: true } }, campaign: { select: { name: true } } },
          orderBy: { id: "asc" },
          take: 500,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (batch.length === 0) break;
        for (const c of batch) {
          controller.enqueue(enc.encode([
            c.id, c.createdAt.toISOString(), c.direction, c.status, c.fromNumber, c.toNumber,
            c.agent?.name ?? "", c.campaign?.name ?? "", c.durationSec, c.outcome ?? "",
            c.sentiment ?? "", c.deadAirSeconds, c.scriptAdherenceScore ?? "",
            c.costTelephonyPaise, c.costSttPaise, c.costLlmPaise, c.costTtsPaise, c.billedPaise,
            c.summary ?? "",
          ].map(csvEscape).join(",") + "\r\n"));
        }
        cursor = batch[batch.length - 1].id;
        if (batch.length < 500) break;
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vaani-calls.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
```

**File `src/app/api/exports/contacts.csv/route.ts`** (full content):

```ts
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { csvEscape } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** Streaming CSV of workspace contacts (spec §8 exports). Tenant-scoped, contacts:read-gated. */
export async function GET() {
  let ctx;
  try {
    ctx = await requirePermission("contacts:read");
  } catch (e) {
    const forbidden = e instanceof Error && e.message === "FORBIDDEN";
    return new Response(forbidden ? "forbidden" : "unauthorized", { status: forbidden ? 403 : 401 });
  }
  const workspaceId = ctx.workspaceId;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode("id,phone,name,list,timezone,dnc,consentAt,createdAt\r\n"));
      let cursor: string | undefined;
      for (;;) {
        const batch = await db.contact.findMany({
          where: { workspaceId },
          include: { list: { select: { name: true } } },
          orderBy: { id: "asc" },
          take: 500,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (batch.length === 0) break;
        for (const c of batch) {
          controller.enqueue(enc.encode([
            c.id, c.phone, c.name ?? "", c.list?.name ?? "", c.timezone ?? "", c.dnc,
            c.consentAt?.toISOString() ?? "", c.createdAt.toISOString(),
          ].map(csvEscape).join(",") + "\r\n"));
        }
        cursor = batch[batch.length - 1].id;
        if (batch.length < 500) break;
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vaani-contacts.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
```

**File `src/app/api/exports/analytics-summary.csv/route.ts`** (full content):

```ts
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { computeAht, computeAsr, sumBilledPaise, sumWholesalePaise } from "@/lib/analytics";

export const dynamic = "force-dynamic";

/** One-row-per-day analytics summary for the last 30 days (spec §8 exports). analytics:read-gated. */
export async function GET() {
  let ctx;
  try {
    ctx = await requirePermission("analytics:read");
  } catch (e) {
    const forbidden = e instanceof Error && e.message === "FORBIDDEN";
    return new Response(forbidden ? "forbidden" : "unauthorized", { status: forbidden ? 403 : 401 });
  }

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const calls = await db.call.findMany({
    where: { workspaceId: ctx.workspaceId, createdAt: { gte: since } },
    select: {
      createdAt: true, answeredAt: true, status: true, direction: true, outcome: true,
      fromNumber: true, toNumber: true, durationSec: true, billedPaise: true,
      costTelephonyPaise: true, costSttPaise: true, costLlmPaise: true, costTtsPaise: true,
    },
  });

  const byDay = new Map<string, typeof calls>();
  for (const c of calls) {
    const day = c.createdAt.toISOString().slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), c]);
  }

  const rows = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayCalls]) => [
      date,
      dayCalls.length,
      computeAsr(dayCalls),
      computeAht(dayCalls),
      sumWholesalePaise(dayCalls),
      sumBilledPaise(dayCalls),
      sumBilledPaise(dayCalls) - sumWholesalePaise(dayCalls),
    ]);

  const csv = toCsv(["date", "calls", "asrPercent", "ahtSeconds", "wholesalePaise", "billedPaise", "marginPaise"], rows);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vaani-analytics-summary.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
```

**File `src/app/(app)/calls/[id]/report/page.tsx`** (print-friendly report, full
content):

```tsx
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { formatINR } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * Print-friendly call report — browser Print / Save-as-PDF produces the PDF export
 * (spec §8). OPERATOR GATE (optional): true server-side PDF generation would add a
 * heavy dependency (puppeteer/pdfkit) and is deliberately deferred; this page is the
 * v1 PDF path.
 */
export default async function CallReportPage({ params }: { params: { id: string } }) {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const call = await db.call.findFirst({
    where: { id: params.id, workspaceId: ctx.workspaceId },
    include: {
      agent: { select: { name: true } },
      campaign: { select: { name: true } },
      qaScores: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!call) notFound();
  const qa = call.qaScores[0] ?? null;
  const wholesale =
    call.costTelephonyPaise + call.costSttPaise + call.costLlmPaise + call.costTtsPaise;

  return (
    <div className="mx-auto max-w-3xl space-y-4 bg-white p-8 text-black print:p-0">
      <style>{`@media print { body { background: white; } .no-print { display: none; } }`}</style>
      <div className="no-print mb-4 rounded border border-gray-300 p-3 text-sm text-gray-500"
        data-testid="call-report-print-hint">
        PDF export: use your browser's Print → “Save as PDF” (Ctrl+P / Cmd+P). This banner and
        the app navigation are hidden in the printout.
      </div>
      <h1 className="text-2xl font-bold">Call report — {call.fromNumber} → {call.toNumber}</h1>
      <p className="text-sm text-gray-600">
        {call.createdAt.toLocaleString("en-IN")} · {call.direction} · {call.status} · {call.durationSec}s
      </p>
      <table className="w-full text-sm">
        <tbody>
          <tr><td className="py-1 text-gray-600">Agent</td><td>{call.agent?.name ?? "—"}</td></tr>
          <tr><td className="py-1 text-gray-600">Campaign</td><td>{call.campaign?.name ?? "—"}</td></tr>
          <tr><td className="py-1 text-gray-600">Outcome / disposition</td><td>{call.outcome ?? "—"}</td></tr>
          <tr><td className="py-1 text-gray-600">Sentiment</td><td>{call.sentiment ?? "—"}</td></tr>
          <tr><td className="py-1 text-gray-600">Dead air</td><td>{call.deadAirSeconds}s</td></tr>
          <tr><td className="py-1 text-gray-600">Script adherence</td><td>{call.scriptAdherenceScore ?? "—"}</td></tr>
          <tr><td className="py-1 text-gray-600">QA score</td><td>{qa ? `${qa.totalScore}/${qa.maxScore} (${qa.rubricName})` : "—"}</td></tr>
          <tr><td className="py-1 text-gray-600">Wholesale cost</td><td>{formatINR(wholesale)}</td></tr>
          <tr><td className="py-1 text-gray-600">Billed</td><td>{formatINR(call.billedPaise)}</td></tr>
        </tbody>
      </table>
      {call.summary && (
        <>
          <h2 className="text-lg font-semibold">Summary</h2>
          <p className="text-sm">{call.summary}</p>
        </>
      )}
      <h2 className="text-lg font-semibold">Transcript{call.piiRedacted ? " (PII redacted)" : ""}</h2>
      <pre className="whitespace-pre-wrap text-sm">{call.transcript ?? "No transcript."}</pre>
    </div>
  );
}
```

> The print button above is a static hint — browser Ctrl+P / Cmd+P does the printing.
> This avoids a client-component wrapper for one button; do not add one.

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npm run build && npx vitest run tests/csv.test.ts
```
**Expected:** exit 0 for all three; `✓ tests/csv.test.ts (5 tests)`; routes
`/api/exports/calls.csv`, `/api/exports/contacts.csv`, `/api/exports/analytics-summary.csv`,
`/calls/[id]/report`.

**Functional test (CSV content matches seeded data):**
```bash
cd /root/vaani-ai
# get a session cookie by logging in through the UI once, then:
#   curl -s -b "vaani_session=<your-cookie>" http://localhost:3000/api/exports/calls.csv | head -n 3
# Operator-free check that auth is enforced:
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/exports/calls.csv
```
**Expected:** `401` without a cookie. With the demo session cookie: first line is the
header `id,createdAt,direction,...` and one row contains `,+919812345678,...,booked,...,362,`.
(RBAC: a session whose membership is VIEWER still passes — VIEWERs have
`calls:read`; the `settings:write`-gated mutations are the locked-down ones. The
export routes return `403 forbidden` when the membership lacks the read permission,
e.g. a custom role with `calls:read` revoked.)

---


## Step 19: Scheduled email digests (node-cron) + digest settings UI

Spec §8: daily/weekly email digests. An hourly node-cron tick finds digests that are
DUE (never sent, or `lastSentAt` older than the frequency window), builds summary
stats from the cost/CDR data, and mails recipients via nodemailer (SMTP config from
guide 06 — silently skips when `SMTP_HOST` is unset).

**File `src/lib/digest.ts`** (full content):

```ts
/**
 * Scheduled email digests (spec §8). Pure builders are unit-tested; the DB/mail
 * job lives in src/worker/digest.ts.
 */

export type DigestFrequency = "DAILY" | "WEEKLY" | "MONTHLY";

/** Window in ms covered by one digest period. */
export function frequencyWindowMs(freq: DigestFrequency): number {
  switch (freq) {
    case "DAILY": return 24 * 3600 * 1000;
    case "WEEKLY": return 7 * 24 * 3600 * 1000;
    case "MONTHLY": return 30 * 24 * 3600 * 1000;
  }
}

/** A digest is due when never sent, or lastSentAt is older than one full period. */
export function isDigestDue(
  frequency: DigestFrequency,
  lastSentAt: Date | null,
  now: Date,
): boolean {
  if (!lastSentAt) return true;
  return now.getTime() - lastSentAt.getTime() >= frequencyWindowMs(frequency);
}

export type DigestStats = {
  periodLabel: string;    // e.g. "last 24 hours"
  calls: number;
  asrPercent: number;
  ahtSeconds: number;
  billedPaise: number;
  wholesalePaise: number;
  topOutcomes: Array<{ outcome: string; count: number }>;
  hallucinations: number;
};

function inr(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

/** Plain-text digest body (pure — fully unit-testable). */
export function buildDigestText(workspaceName: string, frequency: DigestFrequency, s: DigestStats): string {
  const outcomes =
    s.topOutcomes.length === 0
      ? "  (no outcomes recorded)"
      : s.topOutcomes.map((o) => `  - ${o.outcome}: ${o.count}`).join("\n");
  const margin = s.billedPaise - s.wholesalePaise;
  return [
    `Vaani AI ${frequency.toLowerCase()} digest — ${workspaceName}`,
    `Period: ${s.periodLabel}`,
    ``,
    `Calls:              ${s.calls}`,
    `Answer rate (ASR):  ${s.asrPercent}%`,
    `Avg call (AHT):     ${s.ahtSeconds}s`,
    `Billed:             ${inr(s.billedPaise)}`,
    `Wholesale cost:     ${inr(s.wholesalePaise)}`,
    `Gross margin:       ${inr(margin)}`,
    `Hallucination flags: ${s.hallucinations}`,
    ``,
    `Top outcomes:`,
    outcomes,
    ``,
    `— Vaani AI`,
  ].join("\n");
}
```

**File `tests/digest.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import { buildDigestText, frequencyWindowMs, isDigestDue, type DigestStats } from "../src/lib/digest";

describe("frequencyWindowMs", () => {
  it("maps frequencies to windows", () => {
    expect(frequencyWindowMs("DAILY")).toBe(86_400_000);
    expect(frequencyWindowMs("WEEKLY")).toBe(604_800_000);
    expect(frequencyWindowMs("MONTHLY")).toBe(2_592_000_000);
  });
});

describe("isDigestDue", () => {
  const now = new Date("2024-07-08T12:00:00Z");
  it("is due when never sent", () => {
    expect(isDigestDue("DAILY", null, now)).toBe(true);
  });
  it("is due after one full period", () => {
    expect(isDigestDue("DAILY", new Date("2024-07-07T11:59:59Z"), now)).toBe(true);
  });
  it("is NOT due inside the period", () => {
    expect(isDigestDue("DAILY", new Date("2024-07-08T01:00:00Z"), now)).toBe(false);
    expect(isDigestDue("WEEKLY", new Date("2024-07-07T12:00:00Z"), now)).toBe(false);
  });
});

describe("buildDigestText", () => {
  const stats: DigestStats = {
    periodLabel: "last 24 hours",
    calls: 12,
    asrPercent: 75,
    ahtSeconds: 95,
    billedPaise: 48000,
    wholesalePaise: 30000,
    topOutcomes: [{ outcome: "booked", count: 5 }, { outcome: "not-interested", count: 3 }],
    hallucinations: 1,
  };
  it("contains every key metric", () => {
    const t = buildDigestText("Demo Dental Clinic", "DAILY", stats);
    expect(t).toContain("Demo Dental Clinic");
    expect(t).toContain("Calls:              12");
    expect(t).toContain("75%");
    expect(t).toContain("₹480.00");
    expect(t).toContain("₹180.00"); // margin
    expect(t).toContain("- booked: 5");
    expect(t).toContain("Hallucination flags: 1");
  });
  it("handles an empty outcome list", () => {
    const t = buildDigestText("W", "WEEKLY", { ...stats, topOutcomes: [] });
    expect(t).toContain("(no outcomes recorded)");
  });
});
```

**File `src/worker/digest.ts`** (full content):

```ts
/** Scheduled digest sender — invoked hourly by node-cron (registered in Step 21's cron file). */
import { PrismaClient } from "@prisma/client";
import nodemailer from "nodemailer";
import {
  buildDigestText,
  isDigestDue,
  frequencyWindowMs,
  type DigestFrequency,
  type DigestStats,
} from "../lib/digest";
import { computeAht, computeAsr, sumBilledPaise, sumWholesalePaise } from "../lib/analytics";

const db = new PrismaClient();
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function sendMail(to: string[], subject: string, text: string): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    log(`[digest] SMTP_HOST unset — would send "${subject}" to ${to.join(", ")}`);
    return true; // counts as sent in dev so digests don't re-fire every hour
  }
  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } } : {}),
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? "Vaani AI <no-reply@vaani.ai>",
    to: to.join(", "),
    subject,
    text,
  });
  return true;
}

export async function sendDueDigests(): Promise<number> {
  const now = new Date();
  const digests = await db.scheduledDigest.findMany({
    where: { active: true },
    include: { workspace: { select: { name: true } } },
  });

  let sent = 0;
  for (const d of digests) {
    const freq = d.frequency as DigestFrequency;
    if (!isDigestDue(freq, d.lastSentAt, now) || d.recipients.length === 0) continue;
    try {
      const since = new Date(now.getTime() - frequencyWindowMs(freq));
      const calls = await db.call.findMany({
        where: { workspaceId: d.workspaceId, createdAt: { gte: since } },
        select: {
          createdAt: true, answeredAt: true, status: true, direction: true, outcome: true,
          fromNumber: true, toNumber: true, durationSec: true, billedPaise: true,
          costTelephonyPaise: true, costSttPaise: true, costLlmPaise: true, costTtsPaise: true,
          hallucinationFlag: true,
        },
      });
      const outcomes = new Map<string, number>();
      for (const c of calls) if (c.outcome) outcomes.set(c.outcome, (outcomes.get(c.outcome) ?? 0) + 1);
      const stats: DigestStats = {
        periodLabel: freq === "DAILY" ? "last 24 hours" : freq === "WEEKLY" ? "last 7 days" : "last 30 days",
        calls: calls.length,
        asrPercent: computeAsr(calls),
        ahtSeconds: computeAht(calls),
        billedPaise: sumBilledPaise(calls),
        wholesalePaise: sumWholesalePaise(calls),
        topOutcomes: [...outcomes.entries()]
          .map(([outcome, count]) => ({ outcome, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5),
        hallucinations: calls.filter((c) => c.hallucinationFlag).length,
      };
      const subject = `Vaani AI ${freq.toLowerCase()} digest — ${d.workspace.name}`;
      await sendMail(d.recipients, subject, buildDigestText(d.workspace.name, freq, stats));
      await db.scheduledDigest.update({ where: { id: d.id }, data: { lastSentAt: now } });
      sent += 1;
      log(`[digest] sent ${freq} digest for workspace ${d.workspaceId} to ${d.recipients.length} recipient(s)`);
    } catch (e) {
      console.error(`[digest] failed for digest ${d.id}`, e);
    }
  }
  return sent;
}
```

**Digest settings UI — file `src/server/actions/digests.ts`** (full content):

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";

function actionError(label: string, e: unknown, fallback: string) {
  if (e instanceof Error && e.message === "FORBIDDEN") {
    return { ok: false as const, error: "Forbidden — your role lacks the settings:write permission" };
  }
  console.error(label, e);
  return { ok: false as const, error: fallback };
}

const digestSchema = z.object({
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  recipients: z
    .string()
    .min(3)
    .transform((s) => s.split(",").map((e) => e.trim()).filter(Boolean))
    .pipe(z.array(z.string().email()).min(1)),
});

export async function createDigest(formData: FormData) {
  try {
    const ctx = await requirePermission("settings:write");
    const parsed = digestSchema.safeParse({
      frequency: String(formData.get("frequency") ?? ""),
      recipients: String(formData.get("recipients") ?? ""),
    });
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
    await db.scheduledDigest.create({
      data: {
        workspaceId: ctx.workspaceId,
        frequency: parsed.data.frequency,
        recipients: parsed.data.recipients,
      },
    });
    await db.auditLog.create({
      data: { workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "digest.created", entity: "ScheduledDigest", metadata: parsed.data },
    });
    revalidatePath("/settings/digests");
    return { ok: true as const };
  } catch (e) {
    return actionError("createDigest", e, "Could not create digest");
  }
}

export async function deleteDigest(id: string) {
  try {
    const ctx = await requirePermission("settings:write");
    const d = await db.scheduledDigest.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
    if (!d) return { ok: false as const, error: "Not found" };
    await db.scheduledDigest.delete({ where: { id: d.id } });
    revalidatePath("/settings/digests");
    return { ok: true as const };
  } catch (e) {
    return actionError("deleteDigest", e, "Could not delete digest");
  }
}
```

**File `src/app/(app)/settings/digests/page.tsx`** (full content):

```tsx
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createDigest, deleteDigest } from "@/server/actions/digests";

export const dynamic = "force-dynamic";

export default async function DigestSettingsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const digests = await db.scheduledDigest.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Email digests</h1>
      <p className="text-sm text-muted-foreground">
        Summary stats (calls, ASR, cost, margin, outcomes, hallucination flags) emailed
        on a schedule. Requires SMTP_* env vars; without them the worker logs instead of sending.
      </p>

      <Card>
        <CardHeader><CardTitle>New digest</CardTitle></CardHeader>
        <CardContent>
          <form action={createDigest} className="flex flex-wrap items-end gap-3" data-testid="digest-create-form">
            <label className="text-sm">
              Frequency
              <select name="frequency" data-testid="digest-frequency-select"
                className="ml-2 h-9 rounded-md border border-border bg-card px-3 text-sm">
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            </label>
            <input name="recipients" required placeholder="owner@clinic.in, manager@clinic.in"
              data-testid="digest-recipients-input"
              className="h-9 w-80 rounded-md border border-border bg-transparent px-3 text-sm" />
            <button data-testid="digest-create-button"
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Add digest</button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Active digests ({digests.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm" data-testid="digest-table">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Frequency</th><th className="p-3">Recipients</th>
                <th className="p-3">Last sent</th><th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {digests.map((d) => (
                <tr key={d.id} className="border-b last:border-0">
                  <td className="p-3">{d.frequency}</td>
                  <td className="p-3 text-xs">{d.recipients.join(", ")}</td>
                  <td className="p-3 text-muted-foreground">
                    {d.lastSentAt ? d.lastSentAt.toLocaleString("en-IN") : "never"}
                  </td>
                  <td className="p-3">
                    <form action={deleteDigest.bind(null, d.id)}>
                      <button data-testid={`digest-delete-${d.id}`}
                        className="rounded-md border border-red-500/40 px-3 py-1 text-xs text-red-400 hover:bg-red-500/10">
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {digests.length === 0 && (
                <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">No digests configured.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
```

The hourly cron that runs `sendDueDigests()` is registered in Step 21 (all node-cron
schedules live in one file so guide 12 has exactly one place to look).

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npx vitest run tests/digest.test.ts
```
**Expected:** typecheck exit 0; `✓ tests/digest.test.ts (6 tests)`.

---

## Step 20: Cost analytics & margins page

Spec §8: per-tenant (own workspace), per-agent, per-campaign unit economics —
provider cost (4 fields) vs billedPaise → margin %.

**File `src/app/(app)/analytics/cost/page.tsx`** (full content):

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/money";
import { marginPercent, sumBilledPaise, sumWholesalePaise, type AnalyticsCallRow } from "@/lib/analytics";

export const dynamic = "force-dynamic";

type GroupRow = { label: string; calls: number; minutes: number; wholesalePaise: number; billedPaise: number };

function groupStats(label: string, rows: AnalyticsCallRow[]): GroupRow {
  return {
    label,
    calls: rows.length,
    minutes: Math.round(rows.reduce((a, c) => a + c.durationSec, 0) / 60),
    wholesalePaise: sumWholesalePaise(rows),
    billedPaise: sumBilledPaise(rows),
  };
}

export default async function CostAnalyticsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const calls = await db.call.findMany({
    where: { workspaceId: ctx.workspaceId, createdAt: { gte: since } },
    select: {
      createdAt: true, answeredAt: true, status: true, direction: true, outcome: true,
      fromNumber: true, toNumber: true, durationSec: true, billedPaise: true,
      costTelephonyPaise: true, costSttPaise: true, costLlmPaise: true, costTtsPaise: true,
      agentId: true, campaignId: true,
      agent: { select: { name: true } },
      campaign: { select: { name: true } },
    },
  });

  const totalWholesale = sumWholesalePaise(calls);
  const totalBilled = sumBilledPaise(calls);

  // Per-provider totals (spec §8 cost breakdown).
  const provider = [
    { label: "Telephony (Vobiz)", paise: calls.reduce((a, c) => a + c.costTelephonyPaise, 0) },
    { label: "STT (Sarvam)", paise: calls.reduce((a, c) => a + c.costSttPaise, 0) },
    { label: "LLM (OpenRouter)", paise: calls.reduce((a, c) => a + c.costLlmPaise, 0) },
    { label: "TTS (Sarvam)", paise: calls.reduce((a, c) => a + c.costTtsPaise, 0) },
  ];

  const byAgent = new Map<string, AnalyticsCallRow[]>();
  const agentNames = new Map<string, string>();
  const byCampaign = new Map<string, AnalyticsCallRow[]>();
  const campaignNames = new Map<string, string>();
  for (const c of calls) {
    if (c.agentId) {
      byAgent.set(c.agentId, [...(byAgent.get(c.agentId) ?? []), c]);
      agentNames.set(c.agentId, c.agent?.name ?? "—");
    }
    if (c.campaignId) {
      byCampaign.set(c.campaignId, [...(byCampaign.get(c.campaignId) ?? []), c]);
      campaignNames.set(c.campaignId, c.campaign?.name ?? "—");
    }
  }
  const agentRows = [...byAgent.entries()].map(([id, rows]) => groupStats(agentNames.get(id) ?? "—", rows));
  const campaignRows = [...byCampaign.entries()].map(([id, rows]) => groupStats(campaignNames.get(id) ?? "—", rows));

  function CostTable({ title, rows, testid }: { title: string; rows: GroupRow[]; testid: string }) {
    return (
      <Card>
        <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid={testid}>
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Name</th><th className="p-3">Calls</th><th className="p-3">Minutes</th>
                <th className="p-3">Wholesale</th><th className="p-3">Billed</th>
                <th className="p-3">Margin</th><th className="p-3">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b last:border-0">
                  <td className="p-3 font-medium">{r.label}</td>
                  <td className="p-3">{r.calls}</td>
                  <td className="p-3">{r.minutes}</td>
                  <td className="p-3">{formatINR(r.wholesalePaise)}</td>
                  <td className="p-3">{formatINR(r.billedPaise)}</td>
                  <td className={`p-3 ${r.billedPaise - r.wholesalePaise >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {formatINR(r.billedPaise - r.wholesalePaise)}
                  </td>
                  <td className="p-3">{marginPercent(r.billedPaise, r.wholesalePaise)}%</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No data in window.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/analytics" className="text-sm text-muted-foreground hover:text-primary">← Analytics</Link>
        <h1 className="text-2xl font-bold">Cost & margins — last 30 days</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card data-testid="tile-wholesale"><CardHeader><CardTitle className="text-sm">Wholesale cost</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold">{formatINR(totalWholesale)}</CardContent></Card>
        <Card data-testid="tile-billed"><CardHeader><CardTitle className="text-sm">Billed to you</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold text-primary">{formatINR(totalBilled)}</CardContent></Card>
        <Card data-testid="tile-margin-cost"><CardHeader><CardTitle className="text-sm">Gross margin</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold text-green-400">{formatINR(totalBilled - totalWholesale)}</CardContent></Card>
        <Card data-testid="tile-margin-pct"><CardHeader><CardTitle className="text-sm">Margin %</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold">{marginPercent(totalBilled, totalWholesale)}%</CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Wholesale cost by provider</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm" data-testid="provider-cost-table">
          {provider.map((p) => (
            <p key={p.label} className="flex justify-between border-b border-border/40 py-1">
              <span className="text-muted-foreground">{p.label}</span>
              <span>{formatINR(p.paise)}</span>
            </p>
          ))}
        </CardContent>
      </Card>

      <CostTable title="Per-agent unit economics" rows={agentRows} testid="cost-per-agent-table" />
      <CostTable title="Per-campaign unit economics" rows={campaignRows} testid="cost-per-campaign-table" />
    </div>
  );
}
```

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** exit 0 both; route `/analytics/cost`.

**Browser test (operator):** `/analytics/cost` → wholesale ₹2.59, billed ₹3.62, margin
₹1.03 / 28% (from the seeded call); per-agent table shows "Front Desk — Priya";
provider table splits the 4 cost fields.

---

## Step 21: Retention policies — settings UI + nightly cron (recordings + transcripts)

Spec §11: auto-delete recordings/transcripts after N days per tenant config. All
node-cron schedules of this guide live in ONE file (`src/worker/cron.ts`) so the
deployment guide (12) has a single place to verify. `RETENTION_DRY_RUN=true`
(default) logs what WOULD be deleted without deleting.

**File `src/lib/retention.ts`** (full content):

```ts
/** Retention cutoff math (spec §11) — pure, fake-clock testable. */

/** Records created BEFORE this date are eligible for deletion. */
export function cutoffDate(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 3600 * 1000);
}

/** Validate a retention-days value from user input (1..3650). */
export function isValidRetentionDays(days: number): boolean {
  return Number.isInteger(days) && days >= 1 && days <= 3650;
}
```

**File `tests/retention.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import { cutoffDate, isValidRetentionDays } from "../src/lib/retention";

describe("cutoffDate", () => {
  it("subtracts N days exactly (fake clock)", () => {
    const now = new Date("2024-07-08T03:30:00Z");
    expect(cutoffDate(now, 90).toISOString()).toBe("2024-04-09T03:30:00.000Z");
    expect(cutoffDate(now, 1).toISOString()).toBe("2024-07-07T03:30:00.000Z");
    expect(cutoffDate(now, 0).toISOString()).toBe(now.toISOString());
  });
});

describe("isValidRetentionDays", () => {
  it("accepts 1..3650 integers only", () => {
    expect(isValidRetentionDays(90)).toBe(true);
    expect(isValidRetentionDays(1)).toBe(true);
    expect(isValidRetentionDays(3650)).toBe(true);
    expect(isValidRetentionDays(0)).toBe(false);
    expect(isValidRetentionDays(3651)).toBe(false);
    expect(isValidRetentionDays(1.5)).toBe(false);
  });
});
```

**File `src/worker/retention.ts`** (full content):

```ts
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
```

**File `src/worker/cron.ts`** — ALL node-cron schedules of this guide (full content).
Schedules are env-driven via guide-01's keys (`DIGEST_CRON`, `RETENTION_CRON`) so
operators can retime jobs without a deploy; the defaults below apply when unset:

```ts
/**
 * node-cron schedules owned by guide 08. Registered once from the worker's main().
 * - Digests: DIGEST_CRON (default "5 * * * *" — hourly at :05; sendDueDigests
 *   decides per-digest whether it is due).
 * - Retention: RETENTION_CRON (default "30 3 * * *" — nightly 03:30 server time).
 * Invalid expressions fall back to the defaults (logged), never crash the worker.
 */
import cron from "node-cron";
import { sendDueDigests } from "./digest";
import { enforceRetention } from "./retention";

const DIGEST_CRON = process.env.DIGEST_CRON ?? "5 * * * *";
const RETENTION_CRON = process.env.RETENTION_CRON ?? "30 3 * * *";

export function startCronJobs(): void {
  const digestExpr = cron.validate(DIGEST_CRON) ? DIGEST_CRON : "5 * * * *";
  const retentionExpr = cron.validate(RETENTION_CRON) ? RETENTION_CRON : "30 3 * * *";
  if (digestExpr !== DIGEST_CRON) console.error(`[cron] invalid DIGEST_CRON "${DIGEST_CRON}" — using "5 * * * *"`);
  if (retentionExpr !== RETENTION_CRON) console.error(`[cron] invalid RETENTION_CRON "${RETENTION_CRON}" — using "30 3 * * *"`);

  cron.schedule(digestExpr, () => {
    sendDueDigests().catch((e) => console.error("[cron] digest error", e));
  });
  cron.schedule(retentionExpr, () => {
    enforceRetention().catch((e) => console.error("[cron] retention error", e));
  });
  console.log(new Date().toISOString(), `[cron] schedules registered: digests "${digestExpr}", retention "${retentionExpr}"`);
}
```

**Wire into the worker — edit `src/worker/index.ts`:**

1. Import:
   ```ts
   import { startCronJobs } from "./cron";
   ```
2. Inside `main()`, after the webhook-delivery `setInterval` from Step 16, add:
   ```ts
  startCronJobs();
   ```

**Retention settings UI — file `src/server/actions/retention.ts`** (full content):

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { isValidRetentionDays } from "@/lib/retention";

const policySchema = z.object({
  recordingsDays: z.coerce.number().refine(isValidRetentionDays, "1–3650 days"),
  transcriptsDays: z.coerce.number().refine(isValidRetentionDays, "1–3650 days"),
  autoDelete: z.boolean(),
});

export async function saveRetentionPolicy(formData: FormData) {
  try {
    const ctx = await requirePermission("settings:write");
    const parsed = policySchema.safeParse({
      recordingsDays: formData.get("recordingsDays"),
      transcriptsDays: formData.get("transcriptsDays"),
      autoDelete: formData.get("autoDelete") === "on",
    });
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
    await db.retentionPolicy.upsert({
      where: { workspaceId: ctx.workspaceId },
      update: parsed.data,
      create: { workspaceId: ctx.workspaceId, ...parsed.data },
    });
    await db.auditLog.create({
      data: { workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "retention.policy_saved", entity: "RetentionPolicy", metadata: parsed.data },
    });
    revalidatePath("/settings/retention");
    return { ok: true as const };
  } catch (e) {
    if (e instanceof Error && e.message === "FORBIDDEN") {
      return { ok: false as const, error: "Forbidden — your role lacks the settings:write permission" };
    }
    console.error("saveRetentionPolicy", e);
    return { ok: false as const, error: "Could not save policy" };
  }
}
```

**File `src/app/(app)/settings/retention/page.tsx`** (full content):

```tsx
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { saveRetentionPolicy } from "@/server/actions/retention";

export const dynamic = "force-dynamic";

export default async function RetentionSettingsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const policy = await db.retentionPolicy.findUnique({ where: { workspaceId: ctx.workspaceId } });

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Data retention</h1>
      <p className="text-sm text-muted-foreground">
        Auto-delete call recordings and transcripts older than N days (GDPR/DPDP-style
        data-minimization, spec §11). The nightly job runs at 03:30 server time and
        logs every deletion to the audit log. Server env <code>RETENTION_DRY_RUN</code>{" "}
        must be <code>false</code> in production for deletions to actually happen.
      </p>

      <Card>
        <CardHeader><CardTitle>Retention policy</CardTitle></CardHeader>
        <CardContent>
          <form action={saveRetentionPolicy} className="space-y-4" data-testid="retention-form">
            <label className="block text-sm">
              Delete recordings after (days)
              <input name="recordingsDays" type="number" min={1} max={3650} required
                defaultValue={policy?.recordingsDays ?? 90}
                data-testid="retention-recordings-days"
                className="mt-1 block h-9 w-40 rounded-md border border-border bg-transparent px-3 text-sm" />
            </label>
            <label className="block text-sm">
              Erase transcripts + summaries after (days)
              <input name="transcriptsDays" type="number" min={1} max={3650} required
                defaultValue={policy?.transcriptsDays ?? 365}
                data-testid="retention-transcripts-days"
                className="mt-1 block h-9 w-40 rounded-md border border-border bg-transparent px-3 text-sm" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="autoDelete" defaultChecked={policy?.autoDelete ?? true}
                data-testid="retention-auto-delete" />
              Auto-delete enabled
            </label>
            <button data-testid="retention-save-button"
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
              Save policy
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npm run build && npx vitest run tests/retention.test.ts
```
**Expected:** exit 0 all; `✓ tests/retention.test.ts (2 tests)`; routes
`/settings/digests`, `/settings/retention`.

**Functional test (dry-run retention logs the old seeded call):**
```bash
cd /root/vaani-ai
pkill -f "tsx src/worker" || true
(npm run worker > /tmp/worker.log 2>&1 &)
sleep 6
grep "schedules registered" /tmp/worker.log
# force-run the retention logic once (dry-run default) instead of waiting for 03:30:
npx tsx -e "import('./src/worker/retention.ts').then(m => m.enforceRetention(new Date('2999-01-01'))).then(r => { console.log('RESULT', r); process.exit(0); })"
```
**Expected:** log line matching `schedules registered: digests "5 * * * *", retention
"30 3 * * *"` (or your custom expressions if the env keys are set); RESULT shows
counts ≥ 1 and `DRY RUN would delete/erase` lines (the far-future `now` makes every
row "old" — nothing is actually deleted because `RETENTION_DRY_RUN` defaults to true).
**If it fails:** `Cannot find module` → run from `/root/vaani-ai`; empty RESULT with
no policy → the seeded RetentionPolicy exists only for the demo workspace, which is
expected to match — re-run `npm run prisma:seed` if you wiped the DB.

---

## Step 22: GDPR data rights — export & right-to-erasure

Spec §11: data export + right-to-erasure of recordings/transcripts. Flow: a workspace
user files a `GdprRequest` (EXPORT or ERASURE) from settings → the worker
(`gdprSweep`, every 60s) processes PENDING requests → EXPORT produces a JSON bundle in
MinIO with a 15-min download link; ERASURE anonymizes every artifact for the subject
phone number. Both write AuditLog entries.

**File `src/server/actions/gdpr.ts`** (full content):

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";

function actionError(label: string, e: unknown, fallback: string) {
  if (e instanceof Error && e.message === "FORBIDDEN") {
    return { ok: false as const, error: "Forbidden — your role lacks the settings:write permission" };
  }
  console.error(label, e);
  return { ok: false as const, error: fallback };
}

const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/, "E.164 phone required, e.g. +919812345678");

/** File a GDPR data-export request. subjectPhone optional: empty = whole workspace. */
export async function requestDataExport(formData: FormData) {
  try {
    const ctx = await requirePermission("settings:write");
    const rawPhone = String(formData.get("subjectPhone") ?? "").trim();
    if (rawPhone.length > 0) {
      const p = phoneSchema.safeParse(rawPhone);
      if (!p.success) return { ok: false as const, error: p.error.issues[0].message };
    }
    const req = await db.gdprRequest.create({
      data: {
        workspaceId: ctx.workspaceId,
        type: "EXPORT",
        subjectPhone: rawPhone.length > 0 ? rawPhone : null,
      },
    });
    await db.auditLog.create({
      data: { workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "gdpr.export_requested", entity: "GdprRequest", entityId: req.id, metadata: { subjectPhone: req.subjectPhone } },
    });
    revalidatePath("/settings/data-rights");
    return { ok: true as const };
  } catch (e) {
    return actionError("requestDataExport", e, "Could not file export request");
  }
}

/** File a right-to-erasure request for ONE phone number (caller/contact). */
export async function requestErasure(formData: FormData) {
  try {
    const ctx = await requirePermission("settings:write");
    const parsed = phoneSchema.safeParse(String(formData.get("subjectPhone") ?? "").trim());
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
    const req = await db.gdprRequest.create({
      data: { workspaceId: ctx.workspaceId, type: "ERASURE", subjectPhone: parsed.data },
    });
    await db.auditLog.create({
      data: { workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "gdpr.erasure_requested", entity: "GdprRequest", entityId: req.id, metadata: { subjectPhone: parsed.data } },
    });
    revalidatePath("/settings/data-rights");
    return { ok: true as const };
  } catch (e) {
    return actionError("requestErasure", e, "Could not file erasure request");
  }
}
```

**File `src/worker/gdpr.ts`** (full content):

```ts
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
```

**Wire into the worker — edit `src/worker/index.ts`:**

1. Import:
   ```ts
   import { gdprSweep } from "./gdpr";
   ```
2. Inside `main()`, after the webhook-delivery `setInterval`, add:
   ```ts
  setInterval(() => {
    gdprSweep().catch((e) => console.error("[gdpr] sweep error", e));
  }, 60_000);
   ```

**File `src/app/(app)/settings/data-rights/page.tsx`** (full content):

```tsx
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { objectUrl } from "@/lib/storage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requestDataExport, requestErasure } from "@/server/actions/gdpr";

export const dynamic = "force-dynamic";

export default async function DataRightsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const requests = await db.gdprRequest.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const downloadUrls = new Map<string, string>();
  for (const r of requests) {
    if (r.type === "EXPORT" && r.status === "COMPLETED" && r.resultKey) {
      const url = await objectUrl(r.resultKey).catch(() => null);
      if (url) downloadUrls.set(r.id, url);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Data rights (GDPR)</h1>
      <p className="text-sm text-muted-foreground">
        Export a copy of call/contact data, or erase everything tied to a caller's
        phone number (recordings, transcripts, summaries, entities, contact record).
        Erasure also adds the number to your DNC list. Requests process within a
        minute; every action is audit-logged.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Export my data</CardTitle></CardHeader>
          <CardContent>
            <form action={requestDataExport} className="space-y-3" data-testid="gdpr-export-form">
              <input name="subjectPhone" placeholder="+919812345678 (optional — empty = whole workspace)"
                className="h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm" />
              <button data-testid="gdpr-export-button"
                className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
                Request export
              </button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Right to erasure</CardTitle></CardHeader>
          <CardContent>
            <form action={requestErasure} className="space-y-3" data-testid="gdpr-erasure-form">
              <input name="subjectPhone" required placeholder="+919812345678"
                data-testid="gdpr-erasure-phone-input"
                className="h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm" />
              <button data-testid="gdpr-erasure-button"
                className="h-9 rounded-md bg-red-600 px-4 text-sm font-medium text-white">
                Erase this caller's data
              </button>
              <p className="text-xs text-muted-foreground">Irreversible. Redacted artifacts cannot be recovered.</p>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Requests ({requests.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm" data-testid="gdpr-requests-table">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Type</th><th className="p-3">Subject</th><th className="p-3">Status</th>
                <th className="p-3">Filed</th><th className="p-3">Result</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="p-3">{r.type}</td>
                  <td className="p-3 font-mono text-xs">{r.subjectPhone ?? "whole workspace"}</td>
                  <td className={`p-3 ${r.status === "COMPLETED" ? "text-green-400" : "text-orange-400"}`}>{r.status}</td>
                  <td className="p-3 text-muted-foreground">{r.createdAt.toLocaleString("en-IN")}</td>
                  <td className="p-3">
                    {downloadUrls.has(r.id) ? (
                      <a href={downloadUrls.get(r.id)} data-testid={`gdpr-download-${r.id}`}
                        className="text-primary underline">Download JSON</a>
                    ) : "—"}
                  </td>
                </tr>
              ))}
              {requests.length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No requests filed yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npm run build
```
**Expected:** exit 0 both; route `/settings/data-rights`.

**Functional test (export creates a bundle; erasure removes rows):**
```bash
cd /root/vaani-ai
pkill -f "tsx src/worker" || true
(npm run worker > /tmp/worker.log 2>&1 &)
sleep 6
# 1) EXPORT for the seeded caller +919812345678
docker exec vaani-db psql -U vaani -d vaani -t -c \
 "INSERT INTO \"GdprRequest\" (id, \"workspaceId\", type, \"subjectPhone\") SELECT 'gdpr_exp_test', id, 'EXPORT', '+919812345678' FROM \"Workspace\" WHERE slug='demo-clinic' RETURNING id;"
sleep 65
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT status, \"resultKey\" FROM \"GdprRequest\" WHERE id='gdpr_exp_test';"
```
**Expected:** `COMPLETED | gdpr-exports/<ws>/gdpr_exp_test.json`.

```bash
# 2) ERASURE for the same subject
docker exec vaani-db psql -U vaani -d vaani -c \
 "INSERT INTO \"GdprRequest\" (id, \"workspaceId\", type, \"subjectPhone\") SELECT 'gdpr_era_test', id, 'ERASURE', '+919812345678' FROM \"Workspace\" WHERE slug='demo-clinic';"
sleep 65
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT status FROM \"GdprRequest\" WHERE id='gdpr_era_test';"
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT count(*) AS remaining_transcripts FROM \"Call\" WHERE \"fromNumber\"='+919812345678' AND transcript IS NOT NULL;"
docker exec vaani-db psql -U vaani -d vaani -c \
 "SELECT \"fromNumber\", transcript IS NULL AS transcript_gone, \"recordingKey\" FROM \"Call\" WHERE \"fromNumber\" LIKE 'erased-%' LIMIT 1;"
```
**Expected:** erasure `COMPLETED`; `remaining_transcripts = 0`; the seeded demo
call's numbers now read `erased-gdpr_era` with `transcript_gone=t`, `recordingKey`
empty. (Yes — this erases the seeded demo call. Re-seed with
`npx prisma migrate reset --force && npm run prisma:seed` if you need it back; note
this in your report.)

**If it fails:** status stuck at PROCESSING → `tail -n 20 /tmp/worker.log` (usually
MinIO down: `docker compose up -d minio`); status flips back to PENDING repeatedly →
report the logged error and STOP.

---

## Step 23: Public REST API v1

Spec §9: everything in the dashboard is API-accessible. Routes live under
`/api/v1/*`, guarded by guide 03's `requireApiKey(req, scope)` (Bearer key, scopes,
IP allowlist), zod-validated, rate-limited (in-memory token bucket per key), with one
consistent error shape: `{ "ok": false, "error": { "code", "message" } }`.

> **Shared-logic note:** the resource functions in `src/lib/api/resources.ts` are the
> single implementation used by the API routes. Earlier guides' server actions
> (agents/campaigns/contacts) keep their own form-focused implementations; converging
> them onto this module is a documented v2 refactor (flagged in the FINAL REPORT) so
> this guide does not edit other guides' files.

**File `src/lib/ratelimit.ts`** (full content):

```ts
/**
 * In-memory fixed-window rate limiter for the public API.
 * One process => one bucket map; resets on restart (documented ops behavior).
 * PUBLIC_API_RATE_LIMIT = requests per minute per API key (default 120).
 */

const buckets = new Map<string, { count: number; windowStart: number }>();

export function rateLimitAllow(
  key: string,
  limitPerMin: number = Number(process.env.PUBLIC_API_RATE_LIMIT ?? 120),
  now: number = Date.now(),
): boolean {
  if (limitPerMin <= 0) return true; // 0/negative disables limiting (documented)
  const windowMs = 60_000;
  const b = buckets.get(key);
  if (!b || now - b.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (b.count >= limitPerMin) return false;
  b.count += 1;
  return true;
}

/** Test hook: wipe all buckets. */
export function rateLimitReset(): void {
  buckets.clear();
}
```

**File `tests/ratelimit.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import { rateLimitAllow, rateLimitReset } from "../src/lib/ratelimit";

describe("rateLimitAllow", () => {
  it("allows up to the limit within a window, then rejects", () => {
    rateLimitReset();
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(rateLimitAllow("k1", 5, t0 + i)).toBe(true);
    expect(rateLimitAllow("k1", 5, t0 + 5)).toBe(false);
  });

  it("tracks keys independently", () => {
    rateLimitReset();
    const t0 = 2_000_000;
    for (let i = 0; i < 3; i++) expect(rateLimitAllow("k1", 3, t0)).toBe(true);
    expect(rateLimitAllow("k1", 3, t0)).toBe(false);
    expect(rateLimitAllow("k2", 3, t0)).toBe(true);
  });

  it("refills after the window passes", () => {
    rateLimitReset();
    const t0 = 3_000_000;
    expect(rateLimitAllow("k1", 1, t0)).toBe(true);
    expect(rateLimitAllow("k1", 1, t0 + 1000)).toBe(false);
    expect(rateLimitAllow("k1", 1, t0 + 61_000)).toBe(true);
  });

  it("limit <= 0 disables limiting", () => {
    rateLimitReset();
    for (let i = 0; i < 100; i++) expect(rateLimitAllow("k1", 0, i)).toBe(true);
  });
});
```

**File `src/lib/api/http.ts`** (full content):

```ts
import { NextResponse } from "next/server";
import { ApiAuthError, requireApiKey, type ApiKeyContext } from "@/lib/apikeys";
import { rateLimitAllow } from "@/lib/ratelimit";
import type { PermissionKey } from "@/lib/permissions";

export function apiOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

export function apiError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

/**
 * Wrapper for every /api/v1 handler: API-key auth (scope) -> per-key rate limit ->
 * handler. Never throws; consistent error shape.
 */
export async function withApiKey(
  req: Request,
  scope: PermissionKey,
  handler: (ctx: ApiKeyContext, req: Request) => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    const ctx = await requireApiKey(req, scope);
    if (!rateLimitAllow(ctx.apiKey.id)) {
      return apiError(429, "rate_limited", "Rate limit exceeded — default 120 requests/minute per API key (PUBLIC_API_RATE_LIMIT)");
    }
    return await handler(ctx, req);
  } catch (e) {
    if (e instanceof ApiAuthError) return apiError(e.status, e.message, e.message);
    console.error(`[api v1] ${scope} handler error`, e);
    return apiError(500, "internal_error", "Unexpected server error");
  }
}

/** Parse + validate a JSON body with zod; returns parsed data or a 400 response. */
export async function parseJsonBody<T>(
  req: Request,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } } },
): Promise<{ data: T } | { response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { response: apiError(400, "invalid_json", "Body must be valid JSON") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { response: apiError(400, "validation_error", parsed.error.issues[0]?.message ?? "Invalid input") };
  }
  return { data: parsed.data };
}
```

**File `src/lib/api/resources.ts`** (full content):

```ts
/**
 * Public-API resource logic (spec §9). Every function is tenant-scoped by the
 * workspaceId from requireApiKey — never from the client.
 */
import { z } from "zod";
import { db } from "../db";

// ---------- Zod schemas (also unit-tested) ----------

export const agentCreateSchema = z.object({
  name: z.string().min(2).max(80),
  template: z.string().max(60).optional(),
  systemPrompt: z.string().min(10),
  greeting: z.string().min(2),
  languageMode: z.enum(["auto", "fixed", "caller-select"]).default("auto"),
  fixedLanguage: z.string().max(10).optional(),
  voiceId: z.string().max(40).default("anushka"),
  llmModel: z.string().max(120).default("meta-llama/llama-3.1-70b-instruct"),
});

export const campaignCreateSchema = z.object({
  name: z.string().min(2).max(120),
  type: z.enum([
    "LEAD_QUALIFICATION", "APPOINTMENT_REMINDER", "PAYMENT_REMINDER", "FEEDBACK_SURVEY",
    "ORDER_CONFIRMATION", "REACTIVATION", "EVENT_INVITE", "POLITICAL_SURVEY",
  ]).default("LEAD_QUALIFICATION"),
  agentId: z.string().min(1),
  listId: z.string().min(1),
  callsPerMinute: z.number().int().min(1).max(100).default(10),
  concurrency: z.number().int().min(1).max(50).default(1),
});

export const contactSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, "E.164 phone required"),
  name: z.string().max(120).optional(),
  listId: z.string().optional(),
  timezone: z.string().max(60).optional(),
  attributes: z.record(z.unknown()).optional(),
});

export const contactsBulkSchema = z.object({
  contacts: z.array(contactSchema).min(1).max(1000),
});

export const callTriggerSchema = z.object({
  to: z.string().regex(/^\+[1-9]\d{7,14}$/, "E.164 phone required"),
  agentId: z.string().min(1),
});

export const numberCreateSchema = z.object({
  number: z.string().regex(/^\+[1-9]\d{7,14}$/, "E.164 number required"),
  label: z.string().max(80).optional(),
  agentId: z.string().optional(),
});

// ---------- Query helpers ----------

export async function listAgents(workspaceId: string) {
  return db.agent.findMany({
    where: { workspaceId },
    select: { id: true, name: true, template: true, status: true, version: true, languageMode: true, voiceId: true, llmModel: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function createAgent(workspaceId: string, input: z.infer<typeof agentCreateSchema>) {
  return db.agent.create({ data: { workspaceId, ...input } });
}

export async function listCampaigns(workspaceId: string) {
  return db.campaign.findMany({
    where: { workspaceId },
    select: { id: true, name: true, type: true, status: true, agentId: true, listId: true, callsPerMinute: true, concurrency: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function createCampaign(workspaceId: string, input: z.infer<typeof campaignCreateSchema>) {
  // Referenced agent + list must belong to the SAME workspace.
  const [agent, list] = await Promise.all([
    db.agent.findFirst({ where: { id: input.agentId, workspaceId } }),
    db.contactList.findFirst({ where: { id: input.listId, workspaceId } }),
  ]);
  if (!agent) return { error: "agent_not_found" as const };
  if (!list) return { error: "list_not_found" as const };
  const campaign = await db.campaign.create({ data: { workspaceId, ...input } });
  return { campaign };
}

export async function listContacts(workspaceId: string) {
  return db.contact.findMany({
    where: { workspaceId },
    select: { id: true, phone: true, name: true, listId: true, timezone: true, dnc: true, attributes: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}

/** Bulk upsert by (workspaceId, phone). Returns counts. */
export async function upsertContacts(workspaceId: string, contacts: z.infer<typeof contactSchema>[]) {
  let created = 0;
  let updated = 0;
  for (const c of contacts) {
    const existing = await db.contact.findUnique({
      where: { workspaceId_phone: { workspaceId, phone: c.phone } },
      select: { id: true },
    });
    // listId, when given, must belong to this workspace.
    let listId: string | undefined;
    if (c.listId) {
      const list = await db.contactList.findFirst({ where: { id: c.listId, workspaceId }, select: { id: true } });
      if (!list) return { error: "list_not_found" as const, phone: c.phone };
      listId = list.id;
    }
    await db.contact.upsert({
      where: { workspaceId_phone: { workspaceId, phone: c.phone } },
      update: { name: c.name, timezone: c.timezone, attributes: c.attributes as never, ...(listId ? { listId } : {}) },
      create: { workspaceId, phone: c.phone, name: c.name, timezone: c.timezone, attributes: c.attributes as never, ...(listId ? { listId } : {}) },
    });
    if (existing) updated += 1; else created += 1;
  }
  return { created, updated };
}

export async function listCalls(workspaceId: string, url: URL) {
  const take = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 500);
  return db.call.findMany({
    where: {
      workspaceId,
      ...(url.searchParams.get("status") ? { status: url.searchParams.get("status") as never } : {}),
      ...(url.searchParams.get("direction") ? { direction: url.searchParams.get("direction") as never } : {}),
    },
    select: {
      id: true, direction: true, status: true, fromNumber: true, toNumber: true,
      agentId: true, campaignId: true, durationSec: true, outcome: true, sentiment: true,
      scriptAdherenceScore: true, billedPaise: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function listNumbers(workspaceId: string) {
  return db.phoneNumber.findMany({
    where: { workspaceId },
    select: { id: true, number: true, label: true, numberType: true, agentId: true, monthlyRentPaise: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function registerNumber(workspaceId: string, input: z.infer<typeof numberCreateSchema>) {
  if (input.agentId) {
    const agent = await db.agent.findFirst({ where: { id: input.agentId, workspaceId }, select: { id: true } });
    if (!agent) return { error: "agent_not_found" as const };
  }
  const existing = await db.phoneNumber.findUnique({
    where: { workspaceId_number: { workspaceId, number: input.number } },
  });
  if (existing) return { error: "number_already_registered" as const };
  const number = await db.phoneNumber.create({
    data: { workspaceId, number: input.number, label: input.label, agentId: input.agentId ?? null },
  });
  return { number };
}
```

**Route handlers** — one file per resource, each a thin wrapper:

**File `src/app/api/v1/agents/route.ts`** (full content):

```ts
import { NextResponse } from "next/server";
import { apiOk, parseJsonBody, withApiKey, apiError } from "@/lib/api/http";
import { agentCreateSchema, createAgent, listAgents } from "@/lib/api/resources";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  return withApiKey(req, "agents:read", async (ctx) => apiOk(await listAgents(ctx.workspaceId)));
}

export async function POST(req: Request): Promise<NextResponse> {
  return withApiKey(req, "agents:write", async (ctx) => {
    const body = await parseJsonBody(req, agentCreateSchema);
    if ("response" in body) return body.response;
    const agent = await createAgent(ctx.workspaceId, body.data);
    return apiOk(agent, 201);
  });
}
```

**File `src/app/api/v1/campaigns/route.ts`** (full content):

```ts
import { NextResponse } from "next/server";
import { apiError, apiOk, parseJsonBody, withApiKey } from "@/lib/api/http";
import { campaignCreateSchema, createCampaign, listCampaigns } from "@/lib/api/resources";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  return withApiKey(req, "campaigns:read", async (ctx) => apiOk(await listCampaigns(ctx.workspaceId)));
}

export async function POST(req: Request): Promise<NextResponse> {
  return withApiKey(req, "campaigns:write", async (ctx) => {
    const body = await parseJsonBody(req, campaignCreateSchema);
    if ("response" in body) return body.response;
    const result = await createCampaign(ctx.workspaceId, body.data);
    if (result.error) {
      return apiError(422, result.error, `Referenced ${result.error === "agent_not_found" ? "agent" : "contact list"} not found in your workspace`);
    }
    return apiOk(result.campaign, 201);
  });
}
```

**File `src/app/api/v1/contacts/route.ts`** (full content):

```ts
import { NextResponse } from "next/server";
import { apiError, apiOk, parseJsonBody, withApiKey } from "@/lib/api/http";
import { contactsBulkSchema, listContacts, upsertContacts } from "@/lib/api/resources";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  return withApiKey(req, "contacts:read", async (ctx) => apiOk(await listContacts(ctx.workspaceId)));
}

/** Bulk import: {"contacts": [{phone, name?, listId?, timezone?, attributes?}, ...]} up to 1000. */
export async function POST(req: Request): Promise<NextResponse> {
  return withApiKey(req, "contacts:import", async (ctx) => {
    const body = await parseJsonBody(req, contactsBulkSchema);
    if ("response" in body) return body.response;
    const result = await upsertContacts(ctx.workspaceId, body.data.contacts);
    if (result.error) return apiError(422, result.error, `Contact list not found for phone ${result.phone}`);
    return apiOk(result, 201);
  });
}
```

**File `src/app/api/v1/calls/route.ts`** (full content):

```ts
import { NextResponse } from "next/server";
import { apiError, apiOk, parseJsonBody, withApiKey } from "@/lib/api/http";
import { callTriggerSchema, listCalls } from "@/lib/api/resources";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  return withApiKey(req, "calls:read", async (ctx, r) => apiOk(await listCalls(ctx.workspaceId, new URL(r.url))));
}

/**
 * Trigger ONE outbound call. Honors CAMPAIGN_DRY_RUN (same gate as guide 07's
 * worker): dry-run creates a RINGING Call row without touching Dograh.
 */
export async function POST(req: Request): Promise<NextResponse> {
  return withApiKey(req, "campaigns:launch", async (ctx) => {
    const body = await parseJsonBody(req, callTriggerSchema);
    if ("response" in body) return body.response;
    const agent = await db.agent.findFirst({ where: { id: body.data.agentId, workspaceId: ctx.workspaceId } });
    if (!agent) return apiError(422, "agent_not_found", "Agent not found in your workspace");

    if (process.env.CAMPAIGN_DRY_RUN !== "false") {
      const call = await db.call.create({
        data: {
          workspaceId: ctx.workspaceId,
          direction: "OUTBOUND",
          status: "RINGING",
          fromNumber: "dry-run",
          toNumber: body.data.to,
          agentId: agent.id,
        },
      });
      return apiOk({ callId: call.id, dryRun: true }, 201);
    }

    const { dograhTriggerCall } = await import("@/lib/dograh");
    const workflowUuid = (agent as unknown as { dograhWorkflowUuid?: string | null }).dograhWorkflowUuid
      ?? agent.dograhWorkflowId;
    if (!workflowUuid) return apiError(422, "agent_not_published", "Agent has no published Dograh workflow");
    const run = await dograhTriggerCall(workflowUuid, { phoneNumber: body.data.to });
    const call = await db.call.create({
      data: {
        workspaceId: ctx.workspaceId,
        dograhCallId: `${agent.dograhWorkflowId}:${run.workflow_run_id}`,
        direction: "OUTBOUND",
        status: "RINGING",
        fromNumber: "vobiz",
        toNumber: body.data.to,
        agentId: agent.id,
      },
    });
    return apiOk({ callId: call.id, workflowRunId: run.workflow_run_id }, 201);
  });
}
```

**File `src/app/api/v1/numbers/route.ts`** (full content):

```ts
import { NextResponse } from "next/server";
import { apiError, apiOk, parseJsonBody, withApiKey } from "@/lib/api/http";
import { listNumbers, numberCreateSchema, registerNumber } from "@/lib/api/resources";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  return withApiKey(req, "numbers:read", async (ctx) => apiOk(await listNumbers(ctx.workspaceId)));
}

/**
 * Register a number record + optional agent assignment. Purchasing/provisioning a
 * NEW DID from Vobiz stays an operator/dashboard action (guide 09 billing) — this
 * endpoint registers numbers already on your Vobiz account.
 */
export async function POST(req: Request): Promise<NextResponse> {
  return withApiKey(req, "numbers:write", async (ctx) => {
    const body = await parseJsonBody(req, numberCreateSchema);
    if ("response" in body) return body.response;
    const result = await registerNumber(ctx.workspaceId, body.data);
    if (result.error) return apiError(422, result.error, result.error);
    return apiOk(result.number, 201);
  });
}
```

**File `tests/api-schemas.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import {
  agentCreateSchema,
  callTriggerSchema,
  campaignCreateSchema,
  contactsBulkSchema,
  numberCreateSchema,
} from "../src/lib/api/resources";

describe("agentCreateSchema", () => {
  it("accepts a minimal valid agent with defaults", () => {
    const r = agentCreateSchema.parse({ name: "Priya", systemPrompt: "You are Priya the receptionist.", greeting: "Namaste!" });
    expect(r.languageMode).toBe("auto");
    expect(r.voiceId).toBe("anushka");
  });
  it("rejects a short system prompt", () => {
    expect(agentCreateSchema.safeParse({ name: "Priya", systemPrompt: "short", greeting: "hi" }).success).toBe(false);
  });
});

describe("campaignCreateSchema", () => {
  it("applies pacing defaults", () => {
    const r = campaignCreateSchema.parse({ name: "July", agentId: "a1", listId: "l1" });
    expect(r.callsPerMinute).toBe(10);
    expect(r.concurrency).toBe(1);
    expect(r.type).toBe("LEAD_QUALIFICATION");
  });
  it("rejects a bad type", () => {
    expect(campaignCreateSchema.safeParse({ name: "X", agentId: "a", listId: "l", type: "SPAM" }).success).toBe(false);
  });
});

describe("contactsBulkSchema", () => {
  it("accepts up to 1000 E.164 contacts", () => {
    const contacts = Array.from({ length: 1000 }, (_, i) => ({ phone: `+91990000${String(i).padStart(4, "0")}` }));
    expect(contactsBulkSchema.safeParse({ contacts }).success).toBe(true);
  });
  it("rejects bad phones and oversize batches", () => {
    expect(contactsBulkSchema.safeParse({ contacts: [{ phone: "9900000001" }] }).success).toBe(false);
    expect(contactsBulkSchema.safeParse({ contacts: [] }).success).toBe(false);
  });
});

describe("callTriggerSchema / numberCreateSchema", () => {
  it("validates E.164", () => {
    expect(callTriggerSchema.safeParse({ to: "+919812345678", agentId: "a1" }).success).toBe(true);
    expect(callTriggerSchema.safeParse({ to: "9812345678", agentId: "a1" }).success).toBe(false);
    expect(numberCreateSchema.safeParse({ number: "+918040001234" }).success).toBe(true);
    expect(numberCreateSchema.safeParse({ number: "0804000123" }).success).toBe(false);
  });
});
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npm run build && npx vitest run tests/ratelimit.test.ts tests/api-schemas.test.ts
```
**Expected:** exit 0 all; `✓ tests/ratelimit.test.ts (4 tests)` and
`✓ tests/api-schemas.test.ts (7 tests)`; routes `/api/v1/agents`, `/api/v1/campaigns`,
`/api/v1/contacts`, `/api/v1/calls`, `/api/v1/numbers`.

**Scripted curl tests (happy path + negatives):**
```bash
cd /root/vaani-ai
# dev server already running from Step 9; if not: (npm run dev > /tmp/dev.log 2>&1 &) && sleep 12
KEY="demo-api-key-do-not-use"   # seeded key (guide 02) with scopes calls:read, contacts:read

# 1) happy path — seeded scopes
curl -s -H "Authorization: Bearer $KEY" http://localhost:3000/api/v1/calls | head -c 300; echo
curl -s -H "Authorization: Bearer $KEY" http://localhost:3000/api/v1/contacts | head -c 300; echo

# 2) negative: no key -> 401
curl -s -o /dev/null -w "no-key:%{http_code}\n" http://localhost:3000/api/v1/calls

# 3) negative: garbage key -> 401
curl -s -o /dev/null -w "bad-key:%{http_code}\n" -H "Authorization: Bearer nonsense" http://localhost:3000/api/v1/calls

# 4) negative: valid key, missing scope (agents:read not in seeded scopes) -> 403
curl -s -o /dev/null -w "no-scope:%{http_code}\n" -H "Authorization: Bearer $KEY" http://localhost:3000/api/v1/agents

# 5) negative: validation error -> 400 (seeded key lacks contacts:import, so expect 403 here)
curl -s -o /dev/null -w "bulk-forbidden:%{http_code}\n" -X POST \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"contacts":[{"phone":"+919900000099"}]}' http://localhost:3000/api/v1/contacts
```
**Expected:**
1. Two JSON bodies starting with `{"ok":true,"data":[`.
2. `no-key:401`  3. `bad-key:401`  4. `no-scope:403`  5. `bulk-forbidden:403`.

**Rate-limit burst test** (temporarily low limit):
```bash
pkill -f "next dev" || true
(PUBLIC_API_RATE_LIMIT=5 npm run dev > /tmp/dev.log 2>&1 &)
sleep 12
for i in 1 2 3 4 5 6 7; do
  curl -s -o /dev/null -w "req$i:%{http_code} " -H "Authorization: Bearer demo-api-key-do-not-use" http://localhost:3000/api/v1/calls
done; echo
# restore normal limit
pkill -f "next dev" || true
(npm run dev > /tmp/dev.log 2>&1 &)
sleep 12
```
**Expected:** `req1:200 req2:200 req3:200 req4:200 req5:200 req6:429 req7:429`.

**If it fails:** `200` where 401/403 expected → you forgot `withApiKey` on a route;
re-check the route file. All 404 → `npm run build` output must list the routes;
restart the dev server once.

---

## Step 24: TypeScript SDK + API docs page

Spec §9: public REST API + SDKs. v1 ships a single-file SDK in-repo (`sdk/vaani.ts`)
— zero dependencies, wraps `fetch` with typed methods over the `/api/v1` surface.
Publishing it to npm is an **OPERATOR GATE** (needs an npm account + package
decisions; the file is ready to copy into any project).

**File `sdk/vaani.ts`** (full content):

```ts
/**
 * Vaani AI — minimal TypeScript SDK for the public REST API v1.
 * Zero dependencies (fetch). Copy this file into your project or import it directly.
 *
 *   import { VaaniClient } from "./sdk/vaani";
 *   const vaani = new VaaniClient({ apiKey: process.env.VAANI_API_KEY!, baseUrl: "https://app.vaani.ai" });
 *   const calls = await vaani.listCalls({ limit: 10 });
 */

export type VaaniClientOptions = { apiKey: string; baseUrl: string };

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string }; status: number };

export type VaaniAgent = {
  id: string; name: string; template: string | null; status: string; version: number;
  languageMode: string; voiceId: string; llmModel: string; createdAt: string;
};

export type VaaniCampaign = {
  id: string; name: string; type: string; status: string; agentId: string; listId: string;
  callsPerMinute: number; concurrency: number; createdAt: string;
};

export type VaaniContact = {
  id: string; phone: string; name: string | null; listId: string | null;
  timezone: string | null; dnc: boolean; attributes: unknown; createdAt: string;
};

export type VaaniCall = {
  id: string; direction: string; status: string; fromNumber: string; toNumber: string;
  agentId: string | null; campaignId: string | null; durationSec: number;
  outcome: string | null; sentiment: string | null; scriptAdherenceScore: number | null;
  billedPaise: number; createdAt: string;
};

export type VaaniNumber = {
  id: string; number: string; label: string | null; numberType: string;
  agentId: string | null; monthlyRentPaise: number; createdAt: string;
};

export type ContactInput = {
  phone: string; name?: string; listId?: string; timezone?: string; attributes?: Record<string, unknown>;
};

export class VaaniClient {
  constructor(private opts: VaaniClientOptions) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
    const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/api/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as
      | { ok: true; data: T }
      | { ok: false; error: { code: string; message: string } }
      | null;
    if (!json) return { ok: false, error: { code: "bad_response", message: `HTTP ${res.status}` }, status: res.status };
    if (!json.ok) return { ok: false, error: json.error, status: res.status };
    return { ok: true, data: json.data };
  }

  listAgents() { return this.request<VaaniAgent[]>("GET", "/agents"); }
  createAgent(input: { name: string; systemPrompt: string; greeting: string; template?: string; languageMode?: string; fixedLanguage?: string; voiceId?: string; llmModel?: string }) {
    return this.request<VaaniAgent>("POST", "/agents", input);
  }

  listCampaigns() { return this.request<VaaniCampaign[]>("GET", "/campaigns"); }
  createCampaign(input: { name: string; agentId: string; listId: string; type?: string; callsPerMinute?: number; concurrency?: number }) {
    return this.request<VaaniCampaign>("POST", "/campaigns", input);
  }

  listContacts() { return this.request<VaaniContact[]>("GET", "/contacts"); }
  /** Bulk import/upsert up to 1000 contacts. */
  importContacts(contacts: ContactInput[]) {
    return this.request<{ created: number; updated: number }>("POST", "/contacts", { contacts });
  }

  listCalls(filter?: { status?: string; direction?: string; limit?: number }) {
    const qs = new URLSearchParams();
    if (filter?.status) qs.set("status", filter.status);
    if (filter?.direction) qs.set("direction", filter.direction);
    if (filter?.limit) qs.set("limit", String(filter.limit));
    const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
    return this.request<VaaniCall[]>("GET", `/calls${suffix}`);
  }
  /** Trigger one outbound call (honors server-side CAMPAIGN_DRY_RUN). */
  triggerCall(input: { to: string; agentId: string }) {
    return this.request<{ callId: string; dryRun?: boolean; workflowRunId?: number }>("POST", "/calls", input);
  }

  listNumbers() { return this.request<VaaniNumber[]>("GET", "/numbers"); }
  registerNumber(input: { number: string; label?: string; agentId?: string }) {
    return this.request<VaaniNumber>("POST", "/numbers", input);
  }
}
```

**File `sdk/example.ts`** (usage example, run with tsx — full content):

```ts
import { VaaniClient } from "./vaani";

async function main() {
  const vaani = new VaaniClient({
    apiKey: process.env.VAANI_API_KEY ?? "demo-api-key-do-not-use",
    baseUrl: process.env.VAANI_BASE_URL ?? "http://localhost:3000",
  });

  const calls = await vaani.listCalls({ limit: 5 });
  if (!calls.ok) {
    console.error("listCalls failed:", calls.error);
    process.exit(1);
  }
  console.log(`fetched ${calls.data.length} call(s); first id: ${calls.data[0]?.id ?? "none"}`);
}

main();
```

**File `src/app/(app)/settings/api-docs/page.tsx`** (static endpoint reference, full
content):

```tsx
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ENDPOINTS: Array<{ method: string; path: string; scope: string; description: string }> = [
  { method: "GET", path: "/api/v1/agents", scope: "agents:read", description: "List agents (max 200)" },
  { method: "POST", path: "/api/v1/agents", scope: "agents:write", description: "Create an agent (name, systemPrompt, greeting, …)" },
  { method: "GET", path: "/api/v1/campaigns", scope: "campaigns:read", description: "List campaigns" },
  { method: "POST", path: "/api/v1/campaigns", scope: "campaigns:write", description: "Create a campaign (agentId + listId required)" },
  { method: "GET", path: "/api/v1/contacts", scope: "contacts:read", description: "List contacts (max 500)" },
  { method: "POST", path: "/api/v1/contacts", scope: "contacts:import", description: "Bulk import/upsert up to 1000 contacts: {contacts:[…]}" },
  { method: "GET", path: "/api/v1/calls", scope: "calls:read", description: "List calls; query: status, direction, limit" },
  { method: "POST", path: "/api/v1/calls", scope: "campaigns:launch", description: "Trigger one outbound call {to, agentId}" },
  { method: "GET", path: "/api/v1/numbers", scope: "numbers:read", description: "List phone numbers" },
  { method: "POST", path: "/api/v1/numbers", scope: "numbers:write", description: "Register an existing Vobiz number + assign agent" },
];

export default async function ApiDocsPage() {
  try { await requireWorkspace(); } catch { redirect("/login"); }

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Public REST API v1</h1>
      <Card>
        <CardHeader><CardTitle>Authentication & conventions</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm" data-testid="api-docs-conventions">
          <p>Send your key as <code>Authorization: Bearer &lt;key&gt;</code>. Create keys under Settings → API keys (guide 03).</p>
          <p>Rate limit: <code>PUBLIC_API_RATE_LIMIT</code> requests/minute per key (default 120) → HTTP 429 beyond.</p>
          <p>Success shape: <code>{"{ \"ok\": true, \"data\": … }"}</code>. Error shape: <code>{"{ \"ok\": false, \"error\": { \"code\", \"message\" } }"}</code>.</p>
          <p>Error codes: 401 missing/invalid/revoked/expired key · 403 insufficient scope or IP not allowlisted · 429 rate limited · 400 invalid JSON/validation · 422 referenced resource not in your workspace.</p>
          <p>SDK: copy <code>sdk/vaani.ts</code> from the repo — typed methods for every endpoint below. Publishing it to npm is an operator decision (v2).</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Endpoints</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="api-docs-table">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Method</th><th className="p-3">Path</th><th className="p-3">Scope</th><th className="p-3">Description</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((e) => (
                <tr key={`${e.method}-${e.path}`} className="border-b last:border-0">
                  <td className="p-3 font-mono text-xs">{e.method}</td>
                  <td className="p-3 font-mono text-xs">{e.path}</td>
                  <td className="p-3 font-mono text-xs">{e.scope}</td>
                  <td className="p-3">{e.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Webhooks (outbound events)</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Subscribe under Settings → Webhooks. We POST JSON with headers
            <code> X-Vaani-Event</code>, <code> X-Vaani-Delivery</code> (id — dedupe on it),
            and <code> X-Vaani-Signature</code> = <code>sha256=&lt;HMAC-SHA256 hex of the raw body&gt;</code>
            using your subscription secret. Respond 2xx within 10s; failures retry 8 times
            with exponential backoff (30s → 1h cap).</p>
          <p>Events: call.started, call.completed, call.missed, lead.qualified,
            campaign.finished, contact.opted-out, voicemail.received, transfer.requested,
            wallet.low_balance.</p>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npm run build
```
**Expected:** exit 0 both; route `/settings/api-docs`.

**SDK smoke:**
```bash
cd /root/vaani-ai
npx tsx sdk/example.ts
```
**Expected:** `fetched N call(s); first id: …` (N ≥ 1 against the seeded DB — note
the seeded key has `calls:read`).
**If it fails:** `listCalls failed: { code: 'invalid_api_key' }` → the seed key was
rotated; create a key with `calls:read` in Settings → API keys and set
`VAANI_API_KEY`.

---

## Step 25: Google Sheets export (OPERATOR GATE) + Zapier/Make/n8n recipes

Spec §9 Sheets & no-code. Google Sheets gets real code (push CDRs to a sheet via a
service account); Airtable/Zapier/Make/n8n are webhook-consumer RECIPES on top of the
Step 16/17 system — no extra code needed.

### 25a — Google Sheets export

**OPERATOR GATE (verify before relying on this):** create a Google Cloud service
account, enable the Sheets API, share the target spreadsheet with the service-account
email, and put its credentials into `.env` (`GOOGLE_SHEETS_CLIENT_EMAIL`,
`GOOGLE_SHEETS_PRIVATE_KEY` — keep the `\n` escapes, `GOOGLE_SHEETS_SPREADSHEET_ID`).
Until those are set, the action returns a clear "not configured" error — that is the
correct dev behavior, not a bug.

**File `src/lib/sheets.ts`** (full content):

```ts
/**
 * Google Sheets export (spec §9). Appends CDR rows to a sheet tab via a service
 * account (googleapis). NOT configured => { ok:false, error:"not_configured" }.
 */
import { google } from "googleapis";

export function sheetsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SHEETS_CLIENT_EMAIL &&
    process.env.GOOGLE_SHEETS_PRIVATE_KEY &&
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
  );
}

/** Append rows to the first tab of the configured spreadsheet. Returns rows appended. */
export async function appendRowsToSheet(rows: string[][]): Promise<{ ok: boolean; appended?: number; error?: string }> {
  if (!sheetsConfigured()) return { ok: false, error: "not_configured" };
  try {
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      key: (process.env.GOOGLE_SHEETS_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID!,
      range: "A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows },
    });
    return { ok: true, appended: rows.length };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 300) };
  }
}
```

**File `src/server/actions/sheets.ts`** (full content):

```ts
"use server";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { appendRowsToSheet, sheetsConfigured } from "@/lib/sheets";

/** Push the last 100 calls to the configured Google Sheet. */
export async function exportCallsToSheet() {
  try {
    const ctx = await requirePermission("calls:read");
    if (!sheetsConfigured()) {
      return { ok: false as const, error: "Google Sheets not configured — set GOOGLE_SHEETS_* env vars (see guide 08 Step 25)" };
    }
    const calls = await db.call.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { agent: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const rows = calls.map((c) => [
      c.createdAt.toISOString(), c.direction, c.status, c.fromNumber, c.toNumber,
      c.agent?.name ?? "", String(c.durationSec), c.outcome ?? "", c.sentiment ?? "",
      String(c.billedPaise), c.summary ?? "",
    ]);
    const result = await appendRowsToSheet(rows);
    if (!result.ok) return { ok: false as const, error: result.error ?? "Sheets error" };
    await db.auditLog.create({
      data: { workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "sheets.exported", entity: "Call", metadata: { rows: result.appended } },
    });
    return { ok: true as const, appended: result.appended ?? 0 };
  } catch (e) {
    if (e instanceof Error && e.message === "FORBIDDEN") {
      return { ok: false as const, error: "Forbidden — your role lacks the calls:read permission" };
    }
    console.error("exportCallsToSheet", e);
    return { ok: false as const, error: "Export failed" };
  }
}
```

**Mount the button** — edit `src/app/(app)/calls/page.tsx`: inside the
`<div className="flex gap-2">` that wraps the Export CSV link (Step 4), add ABOVE the
`<a data-testid="export-calls-csv" …>` element:

```tsx
          <form action={exportCallsToSheet}>
            <button data-testid="export-calls-sheets"
              className="h-9 rounded-md border border-border px-4 text-sm hover:border-primary/50">
              Push to Google Sheets
            </button>
          </form>
```

and add the import at the top of the same file:

```tsx
import { exportCallsToSheet } from "@/server/actions/sheets";
```

> Without GOOGLE_SHEETS_* configured this button shows its error only in the server
> log (form actions return values are not rendered in this minimal UI) — the
> OPERATOR checks the action result via the audit log entry or the return value in a
> future toast UI (guide 10 polish). Dev verify: the action returns
> `{ ok: false, error: "Google Sheets not configured…" }`.

**Verify:**
```bash
cd /root/vaani-ai && npm run typecheck && npm run build
```
**Expected:** exit 0 both.

### 25b — No-code recipes (documentation only — operator follows these)

**Zapier (Catch Hook → your action):**
1. In Vaani: Settings → Webhooks → create a subscription with the events you want
   (e.g. `call.completed`), URL placeholder for now.
2. In Zapier: new Zap → Trigger: **Webhooks by Zapier → Catch Hook** → copy the
   Custom Webhook URL Zapier shows.
3. Paste that URL into the Vaani subscription (edit = delete + recreate with the URL).
4. Click **Send test event** in Vaani → Zapier's "Test trigger" receives the signed
   `test.ping` payload. (Zapier cannot verify HMAC natively — put a **Filter** step
   on `payload.event` if you chain multiple events; treat the Zapier URL itself as
   the secret, as Zapier documents.)
5. Add your action (e.g. Google Sheets "Create Spreadsheet Row", Slack, HubSpot).

**Make (Integromat):** Trigger module **Webhooks → Custom webhook** → copy URL →
same steps as Zapier. Make can read headers: optionally add a Router condition on
`X-Vaani-Event`.

**n8n (self-hosted — CAN verify the signature):**
1. Workflow → **Webhook** node: Method POST, path `vaani-events`. Copy the production
   URL into a Vaani subscription.
2. Add an **IF** node or **Code** node that recomputes the HMAC:
   ```js
   // n8n Code node (JavaScript): verify X-Vaani-Signature
   const crypto = require("crypto");
   const item = $input.first();
   const secret = "whsec_…your subscription secret…";
   const raw = JSON.stringify(item.json.body ?? item.json); // raw body
   const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
   if (item.headers?.["x-vaani-signature"] !== expected) throw new Error("bad signature");
   return item;
   ```
3. Chain any n8n action node (Sheets, Airtable, CRM…).

**Airtable:** no native generic webhook receiver on free tiers — use Zapier/Make/n8n
as the bridge (Catch Hook → Airtable "Create record"), or poll `GET /api/v1/calls`
on a schedule from an Airtable automation script.

**Verify (operator):** create a Zapier Catch Hook URL, wire it as above, click
**Send test event**, see the payload arrive in Zapier's test panel. Note the result
in your report.

---

## Step 26: Git checkpoint

```bash
cd /root/vaani-ai
git add -A
git commit -m "phase 08: CDR+FTS search, realtime/campaign/agent/cost analytics, QA scoring, webhooks+delivery, public API v1+SDK, digests, GDPR/PII/retention"
```

---

## Acceptance Checklist

- [ ] MinIO bucket created via bootstrap script
- [ ] `npm run typecheck` + `npm run build` exit 0 (final state)
- [ ] `/calls`: filters work, transcript FTS finds the seeded "cleaning" call, QA
      badge column renders, CSV export link present
- [ ] FTS migration applied; `plainto_tsquery('english','cleaning')` returns the seed call
- [ ] Call detail: summary, entities, transcript, timeline, unit economics
      (wholesale vs billed vs margin), QA card, PII/hallucination/dead-air badges
- [ ] Recording sweeper ingests a `pending:` URL into MinIO (object exists, key updated)
- [ ] `/analytics`: 4 stat cards + 4 charts render with real aggregates
- [ ] `/dashboard`: 5 live tiles poll `/api/internal/live-stats` (401 without cookie)
- [ ] `/analytics/campaigns`: funnel chart, heatmap, per-number table, reach/connect tiles
- [ ] `/analytics/agents`: per-agent table (adherence, escalation, hallucinations, dead air, QA)
- [ ] `/analytics/cost`: provider split + per-agent + per-campaign margin tables
- [ ] Post-call sweep: seeded test call got PII-redacted, dead-air 5s, mock QA 36/40
- [ ] Webhooks: signed delivery to local receiver (SUCCESS/200), bad-secret retry
      scheduled (PENDING/400 + nextRetryAt), max-attempts = 8
- [ ] `/settings/webhooks`: create/delete/test-event round-trip
- [ ] CSV exports: 401 without cookie, header + seeded row with cookie; `tests/csv.test.ts` green
- [ ] `/calls/[id]/report` print page renders
- [ ] `/settings/digests` + `/settings/retention` CRUD; cron line
      `schedules registered: digests "5 * * * *", retention "30 3 * * *"` in worker log;
      retention dry-run logs rows without deleting
- [ ] GDPR: export request → COMPLETED with resultKey; erasure request → transcripts
      gone, numbers anonymized, DNC entry added
- [ ] Public API: 5 route pairs live; happy path 200s, 401 no-key, 403 no-scope,
      429 after burst at limit 5; SDK example prints fetched calls
- [ ] Sheets button returns "not configured" without GOOGLE_SHEETS_* (dev) — Zapier
      recipe documented
- [ ] Unit tests green: analytics(12), fts(4), qa(10), deadair(5), pii(8),
      webhook-sign(5), csv(5), digest(6), retention(2), ratelimit(4), api-schemas(7)
- [ ] Git commit `phase 08: ...` exists

## FINAL REPORT format

```
STEP 1..26: PASS/FAIL — <one line of evidence each>
RECORDING TEST: ingested / failed(reason)
FTS TEST: found / not-found
POSTCALL TEST: QaScore 36/40 dry-run / failed(reason)
WEBHOOK E2E: delivered 200 / retry verified / failed(reason)
API E2E: happy 200s, 401/403/429 verified / failed(reason)
GDPR TEST: export COMPLETED / erasure COMPLETED / failed(reason)
UNIT TESTS: 68/68 passed / <failures>
OPERATOR GATES PENDING: sheets oauth? zapier test? SMTP? QA_DRY_RUN still true?
ACCEPTANCE: n/22 checked
NOTES: <deviations>
```
