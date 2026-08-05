# 10 — UI Polish, Onboarding Wizard, In-App Guidance, KYC Flow, White-Label & Landing Page

> **KICKOFF PROMPT — copy everything between the lines and paste into Hermes:**
>
> ---
> You are the EXECUTOR for the Vaani AI project. Read
> `/root/vaani-ai/plan/00_MASTER_PLAN.md` and execute
> `/root/vaani-ai/plan/10_ui_polish_and_landing_page.md` exactly. Create files with the
> EXACT contents shown — landing page copy is deliberate sales copy, do not rewrite it.
> Run every Verify, compare with Expected, max 2 fix attempts, then STOP and report.
> This guide builds UI on top of guides 05/06/09 contracts — never edit those guides'
> files except where this guide shows an EXACT patch. End with the FINAL REPORT.
> ---

---

## Goal

1. **Conversion landing page** — extended with the competitive-edge comparison table
   (readme §14), roadmap teaser, and a feature grid covering the FULL feature set
   (HITL, integrations, QA scoring, white-label, reseller).
2. **Guided onboarding wizard** (readme §13) — `/onboarding`: pick industry → pick
   template agent (guide 05 library) → connect knowledge base → test call in browser
   → register/assign number (KYC-gated, guide 09 `TrialState`) → go live. Tracked in
   `OnboardingState` (currentStep + checklist JSON), resumes on login when
   incomplete, "go live in <30 minutes" progress bar.
3. **In-app guidance** — dismissible checklist widget on the dashboard, a Tooltip
   component with exact placements, and **sample data mode**
   (`OnboardingState.sampleDataEnabled` + `seedSampleData` / `clearSampleData`).
4. **India KYC flow UI** (readme §13) — `/settings/kyc`: document upload → MinIO →
   `KycRecord` PENDING + `TrialState.kycStatus` banner. (Guide 09 enforces the
   purchase gate; this guide builds the UI.)
5. **White-label branding** (readme §3.1) — `/settings/branding`: logo upload
   (MinIO), primary color picker (CSS var override injected by the app layout),
   custom domain + DNS verification (node `dns.promises`), `whiteLabelEnabled`
   gated by `checkFeatureGate(workspaceId, "whiteLabel")` (guide 09).
6. **Polish** — loading/error/404 states, settings page, active-nav highlight, page
   titles, responsive pass. Dark premium theme throughout; every interactive
   element gets a stable `data-testid`.

**Time estimate:** 5 hours. **Prerequisites:** guides 01–09 green. Contracts consumed
(do NOT redefine): `AGENT_TEMPLATES` + `createAgentFromTemplateAction`,
`publishAgentAction`, `createTestRunAction`, `addFaqDocumentAction` (guide 05);
`registerNumberAction`, `assignAgentAction` (guide 06, KYC-gated by guide 09);
`checkFeatureGate` (`src/lib/feature-gates.ts`), `kycGateError`, `isKycVerified`,
`REGULATED_NUMBER_TYPES` (`src/lib/trial.ts`) (guide 09); `requirePermission`
(guide 03); `putObject`, `s3`, `ensureBucket` (`src/lib/storage.ts`, guide 05).

---

## Step 0: Env additions + contract sanity check

New env vars for this guide (append to `.env` AND `.env.example`; never commit `.env`):

```bash
cd /root/vaani-ai
grep -q '^S3_BUCKET_KYC=' .env || cat >> .env <<'EOF'
# MinIO bucket for KYC document uploads (guide 10)
S3_BUCKET_KYC=vaani-kyc
# MinIO bucket for white-label workspace logos (guide 10)
S3_BUCKET_BRANDING=vaani-branding
# E.164 number used as the trial sandbox DID by the onboarding wizard (operator:
# a real DID already provisioned in the Vobiz dashboard for trial users; leave
# CHANGE_ME until then — the wizard shows an operator-gate notice instead).
TRIAL_SANDBOX_NUMBER=CHANGE_ME
EOF
grep -c "S3_BUCKET_KYC\|S3_BUCKET_BRANDING\|TRIAL_SANDBOX_NUMBER" .env
```

**Expected:** `3` (or more).

Append the same three lines (with the same comments) to `.env.example`:
```bash
grep -q '^S3_BUCKET_KYC=' .env.example || cat >> .env.example <<'EOF'
S3_BUCKET_KYC=vaani-kyc
S3_BUCKET_BRANDING=vaani-branding
TRIAL_SANDBOX_NUMBER=CHANGE_ME
EOF
grep -c "S3_BUCKET_KYC" .env.example
```
**Expected:** `1`.

Contract sanity check (files from earlier guides MUST exist):
```bash
cd /root/vaani-ai
ls src/lib/templates.ts src/lib/feature-gates.ts src/lib/trial.ts src/lib/storage.ts src/server/actions/agents.ts src/server/actions/numbers.ts src/server/actions/knowledge.ts
grep -n "export async function checkFeatureGate" src/lib/feature-gates.ts
grep -n "export function kycGateError" src/lib/trial.ts
```
**Expected:** all `ls` paths print (no "No such file"); both greps print one line each.
**If it fails:** a prerequisite guide is incomplete — STOP and report which file is
missing; do NOT recreate it here.

---

## Step 1: The landing page (extended — comparison table, roadmap, full feature grid)

**File `src/app/page.tsx`** — replace the WHOLE file:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PhoneCall, Languages, IndianRupee, Clock, ShieldCheck, BarChart3,
  PhoneOutgoing, CalendarCheck, CheckCircle2, Headphones, Plug,
  ClipboardCheck, Paintbrush, Store, BookOpen, Rocket,
} from "lucide-react";

const FEATURES = [
  { icon: PhoneCall, title: "Answers every call, 24/7", desc: "No hold music. No missed leads. Unlimited simultaneous calls — even at 2 AM on a Sunday." },
  { icon: Languages, title: "Speaks 11+ Indian languages", desc: "Hindi, Tamil, Telugu, Bengali, Marathi, Hinglish — your AI matches the caller's language automatically." },
  { icon: PhoneOutgoing, title: "Outbound campaigns at scale", desc: "Upload a CSV, pick an agent, press start. Reminders, follow-ups, surveys — thousands of calls a day with TRAI-compliant windows." },
  { icon: CalendarCheck, title: "Books while it talks", desc: "Appointments, site visits, callbacks — confirmed on the call, not in a follow-up email." },
  { icon: Headphones, title: "Human-in-the-loop", desc: "Supervisors listen live, whisper guidance to the AI, or take over the call. Warm transfers with full context." },
  { icon: Plug, title: "Integrations & API", desc: "HubSpot, Zoho, Salesforce, Google Calendar, Sheets. Signed webhooks and a full REST API for everything else." },
  { icon: ClipboardCheck, title: "AI QA auto-scoring", desc: "Every call scored against your rubric — greeting, compliance lines, closing. Sample 100% of calls, not 2%." },
  { icon: BookOpen, title: "Knowledge-base answers", desc: "Upload PDFs, FAQs, price lists. Your agent answers from YOUR facts — or says it will call back." },
  { icon: Paintbrush, title: "White-label ready", desc: "Your logo, your colors, your domain. Agencies resell Vaani AI under their own brand." },
  { icon: Store, title: "Reseller panel", desc: "Sub-account provisioning, wholesale rate cards and per-client margin reports for agencies and BPOs." },
  { icon: BarChart3, title: "Every call, measured", desc: "Transcripts, recordings, outcomes and cost-per-call on one dashboard. Know exactly what your AI earns you." },
  { icon: ShieldCheck, title: "Compliance built in", desc: "TRAI-friendly calling windows, DNC honoring, recording disclosure, retention policies and full audit trails." },
];

const COMPARISON = [
  { vs: "Human telecallers", edge: "~90% cost reduction, 24/7, infinite scale, zero attrition/training, perfect script adherence, instantly multilingual." },
  { vs: "Vapi/Retell-based resellers", edge: "No per-minute platform fee (self-hosted Dograh) → better margins; data-sovereignty option for regulated customers." },
  { vs: "Single-model voice bots", edge: "OpenRouter = 400+ models with cost-optimized routing and automatic failover — a provider outage never kills a live call." },
  { vs: "Global voice platforms", edge: "Sarvam = best-in-class Indian language/code-mixed speech; Vobiz = native TRAI/DLT compliance, 140/1600 numbers, INR billing." },
  { vs: "Legacy IVR", edge: "Natural conversation instead of keypad menus. Resolves, not just routes." },
];

const ROADMAP = [
  { icon: Rocket, title: "Shipping now", desc: "Inbound receptionist, outbound campaigns, wallet billing, analytics, QA scoring, white-label, reseller panel." },
  { icon: Clock, title: "Next quarter", desc: "WhatsApp campaigns at scale, voice cloning (your brand voice), predictive dialing, public SDKs." },
  { icon: CheckCircle2, title: "Later", desc: "Speech-to-speech models for ultra-low latency, community template marketplace, enterprise air-gapped installs." },
];

const PLANS = [
  { name: "Starter", price: "₹2,999", period: "/mo", points: ["500 included minutes", "2 AI agents", "2 team seats", "Inbound receptionist", "Email support"], cta: "Start free trial" },
  { name: "Growth", price: "₹7,999", period: "/mo", points: ["2,500 included minutes", "10 AI agents", "10 team seats", "Outbound campaigns", "Priority support"], cta: "Start free trial", featured: true },
  { name: "Enterprise", price: "₹24,999", period: "/mo", points: ["12,000 included minutes", "Unlimited agents", "50 team seats", "White-label ready", "Dedicated success manager"], cta: "Talk to us" },
];

export default function LandingPage() {
  return (
    <main className="mx-auto max-w-6xl px-4">
      {/* Nav */}
      <header className="flex items-center justify-between py-6">
        <span className="text-xl font-bold">Vaani <span className="text-primary">AI</span></span>
        <div className="flex items-center gap-3">
          <Link href="/status" className="text-sm text-muted-foreground hover:text-foreground">Status</Link>
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">Sign in</Link>
          <Button asChild size="sm"><Link href="/register">Start free — ₹1,000 credit</Link></Button>
        </div>
      </header>

      {/* Hero */}
      <section className="py-20 text-center">
        <p className="mx-auto mb-4 w-fit rounded-full border border-primary/30 bg-primary/10 px-4 py-1 text-sm text-primary">
          AI voice agents for Indian businesses
        </p>
        <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">
          The receptionist that speaks your customer&apos;s{" "}
          <span className="text-primary">language</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          Vaani AI answers every inbound call and runs your outbound campaigns — in
          Hindi, English and 9 more languages — for less than one day of a
          telecaller&apos;s salary per month.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Button asChild size="lg"><Link href="/register">Go live in 30 minutes</Link></Button>
          <Button asChild size="lg" variant="outline"><Link href="#pricing">See pricing</Link></Button>
        </div>
        <div className="mx-auto mt-12 grid max-w-3xl grid-cols-3 gap-4 text-center">
          <div><p className="text-3xl font-bold text-primary">24/7</p><p className="text-sm text-muted-foreground">always answering</p></div>
          <div><p className="text-3xl font-bold text-primary">11+</p><p className="text-sm text-muted-foreground">Indian languages</p></div>
          <div><p className="text-3xl font-bold text-primary">~90%</p><p className="text-sm text-muted-foreground">cheaper than telecallers</p></div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-16">
        <h2 className="text-center text-3xl font-bold">Live before lunch</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {[
            ["1", "Pick a template", "Clinic receptionist, real-estate qualifier, EMI reminders — proven scripts, ready to go."],
            ["2", "Make it yours", "Your business name, your prices, your rules. Change the script any time, no code."],
            ["3", "Get a number & go live", "Attach a phone number and your AI starts answering. Transcripts and recordings land on your dashboard."],
          ].map(([n, t, d]) => (
            <Card key={n}>
              <CardHeader>
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">{n}</span>
                <CardTitle className="text-lg">{t}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{d}</CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="py-16">
        <h2 className="text-center text-3xl font-bold">One AI. Every phone job in your business.</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title}>
              <CardHeader>
                <f.icon className="h-6 w-6 text-primary" />
                <CardTitle className="text-base">{f.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{f.desc}</CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Competitive edge (readme §14) */}
      <section className="py-16" data-testid="landing-comparison">
        <h2 className="text-center text-3xl font-bold">Why teams switch to Vaani AI</h2>
        <div className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-3 pr-4 font-medium">vs. Alternative</th>
                <th className="py-3 font-medium">Your advantage with Vaani AI</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.vs} className="border-b border-border/60">
                  <td className="py-4 pr-4 font-semibold">{row.vs}</td>
                  <td className="py-4 text-muted-foreground">{row.edge}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-16">
        <h2 className="text-center text-3xl font-bold">Pricing that pays for itself in a week</h2>
        <p className="mt-3 text-center text-muted-foreground">
          A telecaller costs ₹15,000–25,000/month and handles one call at a time.
        </p>
        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {PLANS.map((p) => (
            <Card key={p.name} className={p.featured ? "border-primary" : ""}>
              <CardHeader>
                {p.featured && <span className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">Most popular</span>}
                <CardTitle>{p.name}</CardTitle>
                <p className="text-3xl font-bold">{p.price}<span className="text-base font-normal text-muted-foreground">{p.period}</span></p>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2 text-sm">
                  {p.points.map((pt) => (
                    <li key={pt} className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />{pt}
                    </li>
                  ))}
                </ul>
                <Button asChild className="w-full" variant={p.featured ? "default" : "outline"}>
                  <Link href="/register">{p.cta}</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <IndianRupee className="mr-1 inline h-4 w-4" />
          Every plan starts with ₹1,000 free call credit. Extra usage billed per second from your wallet.
        </p>
      </section>

      {/* Roadmap teaser */}
      <section className="py-16" data-testid="landing-roadmap">
        <h2 className="text-center text-3xl font-bold">Where we&apos;re headed</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {ROADMAP.map((r) => (
            <Card key={r.title}>
              <CardHeader>
                <r.icon className="h-6 w-6 text-primary" />
                <CardTitle className="text-base">{r.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{r.desc}</CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 text-center">
        <h2 className="text-3xl font-bold">Your next customer is calling right now.</h2>
        <p className="mt-3 text-muted-foreground">Will a human pick up — or your AI?</p>
        <Button asChild size="lg" className="mt-6"><Link href="/register">Start free trial</Link></Button>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t py-8 text-sm text-muted-foreground">
        <span>Vaani <span className="text-primary">AI</span> — AI voice agents for India</span>
        <div className="flex items-center gap-4">
          <Clock className="h-4 w-4" /> Built on Vobiz · Dograh · Sarvam · OpenRouter
        </div>
      </footer>
    </main>
  );
}
```

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** exit 0 both.

**Browser test (operator):** open `/` logged out → hero with the exact headline,
3-step section, 12 feature cards, comparison table with 5 rows, 3 pricing cards
(Growth highlighted), roadmap teaser with 3 cards, footer. On a phone-width viewport:
nav collapses gracefully, table scrolls horizontally inside its section, pricing
cards stack, no page-level horizontal scroll.

---

## Step 2: Loading & error states for every app route

Next.js conventions — one file per route segment. Create ALL of these exactly.

**File `src/app/(app)/loading.tsx`:**
```tsx
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />)}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
```

**File `src/app/(app)/error.tsx`:**
```tsx
"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <h2 className="text-xl font-bold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">
        The team has been notified via server logs. Try again — if it persists, check the status page.
      </p>
      <Button onClick={reset}>Retry</Button>
    </div>
  );
}
```

**File `src/app/not-found.tsx`:**
```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <p className="text-6xl font-bold text-primary">404</p>
      <p className="text-muted-foreground">This page hung up on us.</p>
      <Button asChild variant="outline"><Link href="/dashboard">Back to dashboard</Link></Button>
    </main>
  );
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0. (Browser: throttle network in dev tools, open `/calls` →
skeleton appears; open a nonsense URL inside the app → the 404 page shows.)

---

## Step 3: Settings page (workspace profile + team + audit log + links to branding & KYC)

**File `src/app/(app)/settings/page.tsx`** (full content — overwrite):

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole, requireWorkspace } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const metadata = { title: "Settings — Vaani AI" };

export default async function SettingsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const [workspace, members, auditLogs] = await Promise.all([
    db.workspace.findUnique({ where: { id: ctx.workspaceId } }),
    db.membership.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { user: { select: { email: true, fullName: true } } },
    }),
    db.auditLog.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  async function renameWorkspace(formData: FormData) {
    "use server";
    const ctx = await requireRole("ADMIN");
    const name = String(formData.get("name") ?? "").trim();
    if (name.length < 2) return;
    await db.workspace.update({ where: { id: ctx.workspaceId }, data: { name } });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "workspace.rename", entity: "Workspace", entityId: ctx.workspaceId,
      metadata: { name },
    });
    revalidatePath("/settings");
  }

  async function setIndustry(formData: FormData) {
    "use server";
    const ctx = await requireRole("ADMIN");
    const industry = String(formData.get("industry") ?? "").trim() || null;
    await db.workspace.update({ where: { id: ctx.workspaceId }, data: { industry } });
    revalidatePath("/settings");
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader><CardTitle>Workspace</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <form action={renameWorkspace} className="flex gap-2">
            <Input name="name" defaultValue={workspace?.name} className="max-w-xs" data-testid="settings-name-input" />
            <Button type="submit" variant="outline" data-testid="settings-rename-btn">Rename</Button>
          </form>
          <form action={setIndustry} className="flex gap-2">
            <select name="industry" defaultValue={workspace?.industry ?? ""}
              data-testid="settings-industry-select"
              className="h-9 rounded-md border border-border bg-card px-3 text-sm">
              <option value="">— industry —</option>
              {["healthcare", "real-estate", "education", "bfsi", "e-commerce", "logistics", "salon-spa", "hospitality", "recruitment", "d2c", "agency"].map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
            <Button type="submit" variant="outline" data-testid="settings-industry-save">Save</Button>
          </form>
          <p className="text-xs text-muted-foreground">Workspace slug: {workspace?.slug}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Workspace setup</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <Link href="/settings/branding" className="text-primary hover:underline" data-testid="settings-branding-link">
              White-label branding →
            </Link>{" "}
            <span className="text-muted-foreground">logo, brand color, custom domain (yourbrand.com).</span>
          </p>
          <p>
            <Link href="/settings/kyc" className="text-primary hover:underline" data-testid="settings-kyc-link">
              India KYC →
            </Link>{" "}
            <span className="text-muted-foreground">required before buying regulated 140/1600-series numbers.</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Team</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {members.map((m) => (
            <div key={m.id} className="flex items-center justify-between border-b pb-2 text-sm last:border-0">
              <span>{m.user.fullName} <span className="text-muted-foreground">({m.user.email})</span></span>
              <span className="rounded-full border px-2 py-0.5 text-xs">{m.role}</span>
            </div>
          ))}
          <p className="pt-2 text-xs text-muted-foreground">
            Inviting teammates ships in v2 — today the workspace owner manages everything.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Audit log (latest 30)</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs">
          {auditLogs.map((a) => (
            <p key={a.id} className="flex justify-between gap-4 border-b pb-1 last:border-0">
              <span><span className="text-primary">{a.action}</span> · {a.entity}</span>
              <span className="text-muted-foreground whitespace-nowrap">
                {a.createdAt.toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
              </span>
            </p>
          ))}
          {auditLogs.length === 0 && <p className="text-muted-foreground">No activity yet.</p>}
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
**Expected:** exit 0 both; route `/settings` present. Browser: rename the workspace →
name updates in the sidebar/dashboard; audit log shows `workspace.rename`; the
"Workspace setup" card links to `/settings/branding` and `/settings/kyc` (those
pages are created in Steps 9–10 — links will 404 until then; that is expected now).

---

## Step 4: Pure logic libs — onboarding state machine, sample data, branding color, domain verify

Four dependency-free modules. All pure logic lives here so it is unit-testable
without Next.js or a database.

**File `src/lib/onboarding.ts`** (full content):

```ts
/**
 * Onboarding wizard state machine (readme §13). Pure — unit-tested.
 * Checklist JSON shape stored in OnboardingState.checklist:
 *   { industry, template, knowledge, test_call, number, dismissed? }
 * currentStep is an index into WIZARD_STEPS (0..5). Step 5 = "go live".
 */

export const WIZARD_STEPS = [
  { index: 0, key: "industry", title: "Pick your industry" },
  { index: 1, key: "template", title: "Pick a template agent" },
  { index: 2, key: "knowledge", title: "Connect knowledge base" },
  { index: 3, key: "test_call", title: "Test call in browser" },
  { index: 4, key: "number", title: "Get a number" },
  { index: 5, key: "live", title: "Go live" },
] as const;

export type WizardStepKey = (typeof WIZARD_STEPS)[number]["key"];

export type OnboardingChecklist = {
  industry?: boolean;
  template?: boolean;
  knowledge?: boolean;
  test_call?: boolean;
  number?: boolean;
  dismissed?: boolean;
};

/** The five checklist items that drive the progress bar ("live" is the finish line). */
export const CHECKLIST_KEYS: Exclude<WizardStepKey, "live">[] = [
  "industry",
  "template",
  "knowledge",
  "test_call",
  "number",
];

export function parseChecklist(raw: unknown): OnboardingChecklist {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as OnboardingChecklist;
  }
  return {};
}

/** Merge a patch into the existing checklist (never drops unrelated keys). */
export function mergeChecklist(
  existing: OnboardingChecklist,
  patch: Partial<OnboardingChecklist>,
): OnboardingChecklist {
  return { ...existing, ...patch };
}

/** First incomplete step index (0..4). Returns 5 ("go live") when all five are done. */
export function nextStep(checklist: OnboardingChecklist): number {
  for (let i = 0; i < CHECKLIST_KEYS.length; i++) {
    if (!checklist[CHECKLIST_KEYS[i]]) return i;
  }
  return 5;
}

/** Progress toward go-live, 0..100. */
export function progressPercent(checklist: OnboardingChecklist): number {
  const done = CHECKLIST_KEYS.filter((k) => checklist[k]).length;
  return Math.round((done / CHECKLIST_KEYS.length) * 100);
}

/**
 * Minimum needed to finish the wizard ("go live"): industry + template picked.
 * Knowledge/test-call/number are strongly recommended but skippable — the
 * dashboard checklist keeps nudging after the wizard closes.
 */
export function canGoLive(checklist: OnboardingChecklist): boolean {
  return Boolean(checklist.industry && checklist.template);
}

export function isOnboardingComplete(state: {
  completedAt: Date | null;
} | null): boolean {
  return state?.completedAt != null;
}
```

**File `src/lib/sample-data.ts`** (full content):

```ts
/**
 * Sample data mode (readme §13): believable demo calls/campaigns/contacts so a new
 * workspace never looks empty. Pure builders here; DB writes live in
 * src/server/actions/onboarding.ts.
 *
 * Identification convention (NO schema change): every sample row is marked by
 *  - phone numbers in the reserved range +917777000001..+917777000099, and
 *  - names/campaign/list titles prefixed with SAMPLE_PREFIX.
 * clearSampleData deletes by BOTH markers, always workspace-scoped.
 */

export const SAMPLE_PREFIX = "Sample — ";
export const SAMPLE_PHONE_PREFIX = "+9177770000";

export type SampleContactRow = {
  workspaceId: string;
  phone: string;
  name: string;
  attributes: { city: string; sample: true };
  timezone: string;
};

export function buildSampleContacts(workspaceId: string): SampleContactRow[] {
  const people: Array<[string, string, string]> = [
    ["+917777000001", "Sample — Anita Desai", "Pune"],
    ["+917777000002", "Sample — Vikram Mehta", "Mumbai"],
    ["+917777000003", "Sample — Lakshmi Nair", "Chennai"],
    ["+917777000004", "Sample — Rohan Gupta", "Delhi"],
    ["+917777000005", "Sample — Farah Khan", "Hyderabad"],
  ];
  return people.map(([phone, name, city]) => ({
    workspaceId,
    phone,
    name,
    attributes: { city, sample: true },
    timezone: "Asia/Kolkata",
  }));
}

export type SampleCallRow = {
  workspaceId: string;
  agentId: string | null;
  campaignId: string | null;
  direction: "INBOUND" | "OUTBOUND";
  status: "COMPLETED";
  fromNumber: string;
  toNumber: string;
  durationSec: number;
  summary: string;
  sentiment: string;
  outcome: string;
  transcript: string;
  costTelephonyPaise: number;
  costSttPaise: number;
  costLlmPaise: number;
  costTtsPaise: number;
  billedPaise: number;
};

export function buildSampleCalls(args: {
  workspaceId: string;
  agentId: string | null;
  campaignId: string | null;
  businessNumber: string;
}): SampleCallRow[] {
  const { workspaceId, agentId, campaignId, businessNumber } = args;
  const base = {
    workspaceId,
    agentId,
    status: "COMPLETED" as const,
    toNumber: businessNumber,
    costTelephonyPaise: 45,
    costSttPaise: 30,
    costLlmPaise: 20,
    costTtsPaise: 37,
  };
  return [
    {
      ...base,
      campaignId: null,
      direction: "INBOUND",
      fromNumber: "+917777000001",
      durationSec: 142,
      summary: "Sample — caller asked for pricing and booked a Saturday slot.",
      sentiment: "positive",
      outcome: "booked",
      transcript: "AI: Namaste! How may I help you?\nCaller: What is the price for a consultation?\nAI: It is ₹500. Shall I book a slot for you?",
      billedPaise: 185,
    },
    {
      ...base,
      campaignId: null,
      direction: "INBOUND",
      fromNumber: "+917777000002",
      durationSec: 68,
      summary: "Sample — caller asked for opening hours; no booking.",
      sentiment: "neutral",
      outcome: "faq-answered",
      transcript: "AI: Namaste! How may I help you?\nCaller: What time do you open?\nAI: We are open 10am to 8pm, Monday to Saturday.",
      billedPaise: 88,
    },
    {
      ...base,
      campaignId,
      direction: "OUTBOUND",
      fromNumber: businessNumber,
      toNumber: "+917777000003",
      durationSec: 95,
      summary: "Sample — appointment reminder delivered; caller confirmed.",
      sentiment: "positive",
      outcome: "confirmed",
      transcript: "AI: Namaste, this is a reminder about your appointment tomorrow at 11am.\nCaller: Yes, I will be there.",
      billedPaise: 126,
    },
    {
      ...base,
      campaignId,
      direction: "OUTBOUND",
      fromNumber: businessNumber,
      toNumber: "+917777000004",
      durationSec: 0,
      summary: "Sample — no answer after 45s; retry scheduled by policy.",
      sentiment: "neutral",
      outcome: "no-answer",
      transcript: "",
      billedPaise: 0,
    },
    {
      ...base,
      campaignId,
      direction: "OUTBOUND",
      fromNumber: businessNumber,
      toNumber: "+917777000005",
      durationSec: 130,
      summary: "Sample — feedback survey completed; NPS 9.",
      sentiment: "positive",
      outcome: "survey-completed",
      transcript: "AI: On a scale of 0 to 10, how likely are you to recommend us?\nCaller: Nine.\nAI: Thank you! Have a great day.",
      billedPaise: 169,
    },
  ];
}

/** Prisma `where` fragments used by clearSampleData — always add workspaceId. */
export function sampleCallWhere(workspaceId: string) {
  return {
    workspaceId,
    OR: [
      { fromNumber: { startsWith: SAMPLE_PHONE_PREFIX } },
      { toNumber: { startsWith: SAMPLE_PHONE_PREFIX } },
      { summary: { startsWith: SAMPLE_PREFIX } },
    ],
  };
}

export function sampleContactWhere(workspaceId: string) {
  return { workspaceId, phone: { startsWith: SAMPLE_PHONE_PREFIX } };
}
```

**File `src/lib/branding.ts`** (full content):

```ts
/**
 * White-label branding helpers (readme §3.1). Pure — unit-tested.
 * The app shell (guide 10 layout) injects the workspace brand color as the
 * shadcn `--primary` HSL triplet (guide 01 globals.css: `--primary: 174 72% 46%`).
 */

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_RE.test(value);
}

/** Convert "#rrggbb" → "H S% L%" triplet for the CSS var. Returns null on bad input. */
export function hexToHslTriplet(hex: string): string | null {
  if (!isValidHexColor(hex)) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return `0 0% ${Math.round(l * 100)}%`;
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  } else if (max === g) {
    h = ((b - r) / d + 2) * 60;
  } else {
    h = ((r - g) / d + 4) * 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** MinIO object key for a workspace logo (extension preserved, lowercased). */
export function logoStorageKey(workspaceId: string, filename: string): string {
  const ext = (filename.split(".").pop() ?? "png").toLowerCase();
  return `branding/${workspaceId}/logo.${ext}`;
}

const LOGO_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export const LOGO_MAX_BYTES = 512 * 1024; // 512 KB

export function validateLogoUpload(
  filename: string,
  sizeBytes: number,
): { ok: true } | { ok: false; error: string } {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  if (!LOGO_TYPES[ext]) {
    return { ok: false, error: "Logo must be a PNG, JPG, WEBP or SVG file." };
  }
  if (sizeBytes <= 0) return { ok: false, error: "File is empty." };
  if (sizeBytes > LOGO_MAX_BYTES) {
    return { ok: false, error: "Logo must be under 512 KB." };
  }
  return { ok: true };
}

export function logoContentType(filename: string): string {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  return LOGO_TYPES[ext] ?? "application/octet-stream";
}
```

**File `src/lib/domain-verify.ts`** (full content):

```ts
/**
 * Custom-domain verification for white-label workspaces (readme §3.1).
 * The resolver is INJECTED so unit tests never touch the network; production code
 * passes node:dns/promises (see src/server/actions/branding.ts).
 *
 * A workspace proves ownership of `app.theirbrand.com` by EITHER:
 *  - TXT record on the domain:  vaani-verification=<workspaceId>   (preferred), OR
 *  - CNAME record pointing at our app host (e.g. app.vaani.ai).
 * On success the server action sets Workspace.customDomainVerifiedAt; guide 12's
 * Caddy on-demand TLS "ask" endpoint (/api/domain-ask) only approves verified domains.
 */

export const VERIFICATION_TXT_PREFIX = "vaani-verification=";

export interface DnsResolver {
  resolveTxt(hostname: string): Promise<string[][]>;
  resolveCname(hostname: string): Promise<string[]>;
}

export function expectedTxtValue(workspaceId: string): string {
  return `${VERIFICATION_TXT_PREFIX}${workspaceId}`;
}

/** Lowercase, strip protocol/path/trailing dot. Returns null when invalid. */
export function normalizeDomain(input: string): string | null {
  const d = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) {
    return null;
  }
  return d;
}

export type VerifyResult = {
  ok: boolean;
  method?: "txt" | "cname";
  error?: string;
  found?: string[];
};

export async function verifyDomainOwnership(args: {
  domain: string;
  workspaceId: string;
  appHost: string; // e.g. "app.vaani.ai" — CNAME target
  resolver: DnsResolver;
}): Promise<VerifyResult> {
  const { domain, workspaceId, appHost, resolver } = args;
  const expected = expectedTxtValue(workspaceId);

  // 1. TXT check
  try {
    const records = await resolver.resolveTxt(domain);
    const flat = records.map((chunks) => chunks.join(""));
    if (flat.includes(expected)) {
      return { ok: true, method: "txt", found: flat };
    }
  } catch {
    // ENOTFOUND / ENODATA — fall through to CNAME
  }

  // 2. CNAME check
  try {
    const cnames = await resolver.resolveCname(domain);
    const target = appHost.replace(/\.$/, "").toLowerCase();
    const match = cnames.some((c) => c.replace(/\.$/, "").toLowerCase() === target);
    if (match) return { ok: true, method: "cname", found: cnames };
    return {
      ok: false,
      error: `CNAME points at ${cnames[0] ?? "nothing"} — expected ${appHost}, or add TXT "${expected}".`,
      found: cnames,
    };
  } catch {
    return {
      ok: false,
      error: `No verification record found. Add TXT "${expected}" or a CNAME to ${appHost} on ${domain}, then retry.`,
    };
  }
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.

---

## Step 5: Unit tests — onboarding state machine, sample data, branding, domain verify

**File `tests/onboarding.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import {
  CHECKLIST_KEYS,
  WIZARD_STEPS,
  canGoLive,
  isOnboardingComplete,
  mergeChecklist,
  nextStep,
  parseChecklist,
  progressPercent,
} from "@/lib/onboarding";

describe("WIZARD_STEPS", () => {
  it("has exactly the readme §13 six steps in order", () => {
    expect(WIZARD_STEPS.map((s) => s.key)).toEqual([
      "industry",
      "template",
      "knowledge",
      "test_call",
      "number",
      "live",
    ]);
    expect(CHECKLIST_KEYS).toHaveLength(5);
  });
});

describe("parseChecklist", () => {
  it("returns {} for null/undefined/arrays/scalars", () => {
    expect(parseChecklist(null)).toEqual({});
    expect(parseChecklist(undefined)).toEqual({});
    expect(parseChecklist([])).toEqual({});
    expect(parseChecklist("x")).toEqual({});
  });
  it("passes through objects", () => {
    expect(parseChecklist({ industry: true })).toEqual({ industry: true });
  });
});

describe("mergeChecklist", () => {
  it("merges without dropping unrelated keys", () => {
    const merged = mergeChecklist({ industry: true, dismissed: true }, { template: true });
    expect(merged).toEqual({ industry: true, dismissed: true, template: true });
  });
  it("later patch wins on conflicts", () => {
    expect(mergeChecklist({ knowledge: false }, { knowledge: true }).knowledge).toBe(true);
  });
});

describe("nextStep", () => {
  it("returns the first incomplete step", () => {
    expect(nextStep({})).toBe(0);
    expect(nextStep({ industry: true })).toBe(1);
    expect(nextStep({ industry: true, template: true })).toBe(2);
    expect(nextStep({ industry: true, template: true, knowledge: true, test_call: true })).toBe(4);
  });
  it("returns 5 (go live) when all five checklist items are done", () => {
    expect(
      nextStep({ industry: true, template: true, knowledge: true, test_call: true, number: true }),
    ).toBe(5);
  });
});

describe("progressPercent", () => {
  it("is 0 with nothing done, 100 with all five done", () => {
    expect(progressPercent({})).toBe(0);
    expect(
      progressPercent({ industry: true, template: true, knowledge: true, test_call: true, number: true }),
    ).toBe(100);
  });
  it("counts only the five checklist keys (dismissed is ignored)", () => {
    expect(progressPercent({ industry: true, dismissed: true })).toBe(20);
  });
});

describe("canGoLive", () => {
  it("requires industry AND template only", () => {
    expect(canGoLive({})).toBe(false);
    expect(canGoLive({ industry: true })).toBe(false);
    expect(canGoLive({ template: true })).toBe(false);
    expect(canGoLive({ industry: true, template: true })).toBe(true);
  });
});

describe("isOnboardingComplete", () => {
  it("is false for null and for completedAt=null, true otherwise", () => {
    expect(isOnboardingComplete(null)).toBe(false);
    expect(isOnboardingComplete({ completedAt: null })).toBe(false);
    expect(isOnboardingComplete({ completedAt: new Date() })).toBe(true);
  });
});
```

**File `tests/sample-data.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import {
  SAMPLE_PHONE_PREFIX,
  SAMPLE_PREFIX,
  buildSampleCalls,
  buildSampleContacts,
  sampleCallWhere,
  sampleContactWhere,
} from "@/lib/sample-data";

const WS = "ws_test_123";

describe("buildSampleContacts", () => {
  it("creates 5 contacts, all workspace-scoped and marked by the reserved phone range", () => {
    const rows = buildSampleContacts(WS);
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.workspaceId).toBe(WS);
      expect(r.phone.startsWith(SAMPLE_PHONE_PREFIX)).toBe(true);
      expect(r.name.startsWith(SAMPLE_PREFIX)).toBe(true);
      expect(r.attributes.sample).toBe(true);
      expect(r.timezone).toBe("Asia/Kolkata");
    }
  });

  it("phone numbers are unique", () => {
    const phones = buildSampleContacts(WS).map((r) => r.phone);
    expect(new Set(phones).size).toBe(phones.length);
  });
});

describe("buildSampleCalls", () => {
  const calls = buildSampleCalls({
    workspaceId: WS,
    agentId: "agent_1",
    campaignId: "camp_1",
    businessNumber: "+918040009999",
  });

  it("creates 5 completed calls with integer-paise cost fields", () => {
    expect(calls).toHaveLength(5);
    for (const c of calls) {
      expect(c.workspaceId).toBe(WS);
      expect(c.status).toBe("COMPLETED");
      for (const field of [
        c.costTelephonyPaise,
        c.costSttPaise,
        c.costLlmPaise,
        c.costTtsPaise,
        c.billedPaise,
      ]) {
        expect(Number.isInteger(field)).toBe(true);
      }
    }
  });

  it("mixes inbound and outbound; outbound calls are tied to the sample campaign", () => {
    const inbound = calls.filter((c) => c.direction === "INBOUND");
    const outbound = calls.filter((c) => c.direction === "OUTBOUND");
    expect(inbound.length).toBeGreaterThan(0);
    expect(outbound.length).toBeGreaterThan(0);
    for (const c of outbound) expect(c.campaignId).toBe("camp_1");
    for (const c of inbound) expect(c.campaignId).toBeNull();
  });

  it("every call touches either the sample phone range or the Sample prefix (clearable)", () => {
    for (const c of calls) {
      const marked =
        c.fromNumber.startsWith(SAMPLE_PHONE_PREFIX) ||
        c.toNumber.startsWith(SAMPLE_PHONE_PREFIX) ||
        c.summary.startsWith(SAMPLE_PREFIX);
      expect(marked).toBe(true);
    }
  });

  it("billed paise is 0 for a 0-second call (no free-ride, no negative)", () => {
    const noAnswer = calls.find((c) => c.durationSec === 0);
    expect(noAnswer?.billedPaise).toBe(0);
  });
});

describe("sample where fragments", () => {
  it("are always workspace-scoped", () => {
    expect(sampleCallWhere(WS).workspaceId).toBe(WS);
    expect(sampleContactWhere(WS).workspaceId).toBe(WS);
    expect(sampleContactWhere(WS).phone.startsWith).toBe(SAMPLE_PHONE_PREFIX);
  });
});
```

**File `tests/branding.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import {
  hexToHslTriplet,
  isValidHexColor,
  logoContentType,
  logoStorageKey,
  validateLogoUpload,
} from "@/lib/branding";

describe("isValidHexColor", () => {
  it("accepts #rrggbb only", () => {
    expect(isValidHexColor("#7c3aed")).toBe(true);
    expect(isValidHexColor("#ABCDEF")).toBe(true);
    expect(isValidHexColor("#fff")).toBe(false);
    expect(isValidHexColor("7c3aed")).toBe(false);
    expect(isValidHexColor("#gg0000")).toBe(false);
    expect(isValidHexColor("")).toBe(false);
  });
});

describe("hexToHslTriplet", () => {
  it("converts known colors", () => {
    expect(hexToHslTriplet("#ff0000")).toBe("0 100% 50%");
    expect(hexToHslTriplet("#00ff00")).toBe("120 100% 50%");
    expect(hexToHslTriplet("#0000ff")).toBe("240 100% 50%");
    expect(hexToHslTriplet("#000000")).toBe("0 0% 0%");
    expect(hexToHslTriplet("#ffffff")).toBe("0 0% 100%");
  });
  it("converts the Vaani teal family (#14b8a6 ≈ 173 80% 40%)", () => {
    expect(hexToHslTriplet("#14b8a6")).toBe("173 80% 40%");
  });
  it("returns null on invalid input", () => {
    expect(hexToHslTriplet("#fff")).toBeNull();
    expect(hexToHslTriplet("red")).toBeNull();
  });
});

describe("logoStorageKey", () => {
  it("keys under branding/<workspaceId>/logo.<ext>, lowercased ext", () => {
    expect(logoStorageKey("ws1", "My Logo.PNG")).toBe("branding/ws1/logo.png");
    expect(logoStorageKey("ws1", "logo.svg")).toBe("branding/ws1/logo.svg");
  });
});

describe("validateLogoUpload", () => {
  it("accepts png/jpg/webp/svg under 512KB", () => {
    expect(validateLogoUpload("logo.png", 1000).ok).toBe(true);
    expect(validateLogoUpload("logo.svg", 512 * 1024).ok).toBe(true);
  });
  it("rejects bad types, empty and oversized files", () => {
    expect(validateLogoUpload("logo.gif", 1000).ok).toBe(false);
    expect(validateLogoUpload("logo.png", 0).ok).toBe(false);
    expect(validateLogoUpload("logo.png", 512 * 1024 + 1).ok).toBe(false);
  });
});

describe("logoContentType", () => {
  it("maps extensions to mime types", () => {
    expect(logoContentType("a.PNG")).toBe("image/png");
    expect(logoContentType("a.svg")).toBe("image/svg+xml");
    expect(logoContentType("a.bin")).toBe("application/octet-stream");
  });
});
```

**File `tests/domain-verify.test.ts`** (full content):

```ts
import { describe, expect, it } from "vitest";
import {
  expectedTxtValue,
  normalizeDomain,
  verifyDomainOwnership,
  type DnsResolver,
} from "@/lib/domain-verify";

const WS = "ckyz123abc";
const HOST = "app.vaani.ai";

function resolver(opts: { txt?: string[][]; cname?: string[]; txtThrows?: boolean; cnameThrows?: boolean }): DnsResolver {
  return {
    async resolveTxt() {
      if (opts.txtThrows ?? true) throw new Error("ENODATA");
      return opts.txt ?? [];
    },
    async resolveCname() {
      if (opts.cnameThrows ?? true) throw new Error("ENODATA");
      return opts.cname ?? [];
    },
  };
}

describe("expectedTxtValue", () => {
  it("is vaani-verification=<workspaceId>", () => {
    expect(expectedTxtValue(WS)).toBe(`vaani-verification=${WS}`);
  });
});

describe("normalizeDomain", () => {
  it("lowercases and strips protocol, path and trailing dot", () => {
    expect(normalizeDomain("https://App.Brand.com/")).toBe("app.brand.com");
    expect(normalizeDomain("calls.brand.com.")).toBe("calls.brand.com");
  });
  it("rejects garbage", () => {
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("-bad.com")).toBeNull();
  });
});

describe("verifyDomainOwnership", () => {
  it("succeeds via matching TXT record", async () => {
    const r = await verifyDomainOwnership({
      domain: "app.brand.com",
      workspaceId: WS,
      appHost: HOST,
      resolver: resolver({ txtThrows: false, txt: [[`vaani-verification=${WS}`]] }),
    });
    expect(r).toMatchObject({ ok: true, method: "txt" });
  });

  it("joins multi-chunk TXT records before comparing", async () => {
    const r = await verifyDomainOwnership({
      domain: "app.brand.com",
      workspaceId: WS,
      appHost: HOST,
      resolver: resolver({ txtThrows: false, txt: [["vaani-verification=", WS]] }),
    });
    expect(r.ok).toBe(true);
  });

  it("succeeds via CNAME to the app host (trailing dot tolerated)", async () => {
    const r = await verifyDomainOwnership({
      domain: "app.brand.com",
      workspaceId: WS,
      appHost: HOST,
      resolver: resolver({ cnameThrows: false, cname: ["app.vaani.ai."] }),
    });
    expect(r).toMatchObject({ ok: true, method: "cname" });
  });

  it("fails when CNAME points elsewhere, with an actionable error", async () => {
    const r = await verifyDomainOwnership({
      domain: "app.brand.com",
      workspaceId: WS,
      appHost: HOST,
      resolver: resolver({ cnameThrows: false, cname: ["someone-else.com"] }),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("someone-else.com");
  });

  it("fails when no records exist, naming the TXT to add", async () => {
    const r = await verifyDomainOwnership({
      domain: "app.brand.com",
      workspaceId: WS,
      appHost: HOST,
      resolver: resolver({}),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain(`vaani-verification=${WS}`);
  });

  it("a wrong workspace id never verifies (cross-tenant safety)", async () => {
    const r = await verifyDomainOwnership({
      domain: "app.brand.com",
      workspaceId: "other_ws",
      appHost: HOST,
      resolver: resolver({ txtThrows: false, txt: [[`vaani-verification=${WS}`]] }),
    });
    expect(r.ok).toBe(false);
  });
});
```

**Verify:**
```bash
cd /root/vaani-ai && npx vitest run tests/onboarding.test.ts tests/sample-data.test.ts tests/branding.test.ts tests/domain-verify.test.ts
```
**Expected:** `Test Files  4 passed (4)`, exit 0. (≈30 test cases.)
**If it fails:** the error names the assertion — fix the TEST or the lib to match
the guide text exactly; never weaken an assertion to make it pass. If
`@/lib/onboarding` does not resolve → guide 06's `vitest.config.ts` alias is
missing; confirm `ls vitest.config.ts` — do not recreate it, report.

---

## Step 6: Onboarding server actions (state + sample data + checklist dismiss)

**File `src/server/actions/onboarding.ts`** (full content):

```ts
"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission, requireWorkspace } from "@/lib/auth";
import { audit } from "@/lib/audit";
import {
  canGoLive,
  mergeChecklist,
  nextStep,
  parseChecklist,
  progressPercent,
  type OnboardingChecklist,
  type WizardStepKey,
} from "@/lib/onboarding";
import {
  buildSampleCalls,
  buildSampleContacts,
  sampleCallWhere,
  sampleContactWhere,
  SAMPLE_PREFIX,
} from "@/lib/sample-data";

export type OnboardingResult = { ok: boolean; error?: string };

export type OnboardingSnapshot = {
  currentStep: number;
  checklist: OnboardingChecklist;
  progress: number;
  sampleDataEnabled: boolean;
  completed: boolean;
  canFinish: boolean;
};

async function getOrCreateState(workspaceId: string) {
  return db.onboardingState.upsert({
    where: { workspaceId },
    update: {},
    create: { workspaceId },
  });
}

/** Read-only snapshot used by the wizard, the dashboard widget and the app layout. */
export async function getOnboardingStateAction(): Promise<OnboardingSnapshot | null> {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    return null;
  }
  const state = await getOrCreateState(ctx.workspaceId);
  const checklist = parseChecklist(state.checklist);
  return {
    currentStep: state.currentStep,
    checklist,
    progress: progressPercent(checklist),
    sampleDataEnabled: state.sampleDataEnabled,
    completed: state.completedAt != null,
    canFinish: canGoLive(checklist),
  };
}

/** Mark a checklist item done and advance currentStep to the next incomplete step. */
export async function markStepAction(key: WizardStepKey): Promise<OnboardingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    if (key === "live") return { ok: false, error: "Use completeOnboardingAction to finish." };
    const state = await getOrCreateState(ctx.workspaceId);
    const checklist = mergeChecklist(parseChecklist(state.checklist), { [key]: true });
    await db.onboardingState.update({
      where: { workspaceId: ctx.workspaceId },
      data: { checklist, currentStep: nextStep(checklist) },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: `onboarding.step.${key}`, entity: "OnboardingState", entityId: state.id,
    });
    revalidatePath("/onboarding");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Industry pick — also stored on the Workspace (settings page shows it). */
export async function setWizardIndustryAction(industry: string): Promise<OnboardingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const clean = industry.trim().toLowerCase();
    if (clean.length < 2 || clean.length > 40) return { ok: false, error: "Pick an industry." };
    await db.workspace.update({ where: { id: ctx.workspaceId }, data: { industry: clean } });
    return markStepAction("industry");
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Finish the wizard. Requires industry + template (canGoLive). */
export async function completeOnboardingAction(): Promise<OnboardingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const state = await getOrCreateState(ctx.workspaceId);
    const checklist = parseChecklist(state.checklist);
    if (!canGoLive(checklist)) {
      return { ok: false, error: "Pick an industry and a template agent first." };
    }
    await db.onboardingState.update({
      where: { workspaceId: ctx.workspaceId },
      data: { completedAt: new Date(), currentStep: 5 },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "onboarding.completed", entity: "OnboardingState", entityId: state.id,
      metadata: { checklist },
    });
    revalidatePath("/onboarding");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Dismiss the dashboard checklist widget (persists in checklist.dismissed). */
export async function dismissChecklistAction(): Promise<OnboardingResult> {
  try {
    const ctx = await requireWorkspace();
    const state = await getOrCreateState(ctx.workspaceId);
    await db.onboardingState.update({
      where: { workspaceId: ctx.workspaceId },
      data: { checklist: mergeChecklist(parseChecklist(state.checklist), { dismissed: true }) },
    });
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Sample data mode ON: seed demo contacts + campaign + calls into THIS workspace. */
export async function seedSampleDataAction(): Promise<OnboardingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const wsId = ctx.workspaceId;
    const state = await getOrCreateState(wsId);
    if (state.sampleDataEnabled) return { ok: true }; // idempotent

    const agent = await db.agent.findFirst({
      where: { workspaceId: wsId },
      orderBy: { createdAt: "asc" },
    });
    const number = await db.phoneNumber.findFirst({
      where: { workspaceId: wsId },
      orderBy: { createdAt: "asc" },
    });
    const businessNumber = number?.number ?? "+917777000099";

    const list = await db.contactList.create({
      data: { workspaceId: wsId, name: `${SAMPLE_PREFIX}demo list` },
    });
    await db.contact.createMany({ data: buildSampleContacts(wsId) });

    let campaignId: string | null = null;
    if (agent) {
      const campaign = await db.campaign.create({
        data: {
          workspaceId: wsId,
          name: `${SAMPLE_PREFIX}demo campaign`,
          type: "APPOINTMENT_REMINDER",
          agentId: agent.id,
          listId: list.id,
          status: "COMPLETED",
          finishedAt: new Date(),
        },
      });
      campaignId = campaign.id;
    }

    const calls = buildSampleCalls({
      workspaceId: wsId,
      agentId: agent?.id ?? null,
      campaignId,
      businessNumber,
    });
    for (const c of calls) {
      await db.call.create({ data: c });
    }

    await db.onboardingState.update({
      where: { workspaceId: wsId },
      data: { sampleDataEnabled: true },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "onboarding.sample_data.seed", entity: "OnboardingState", entityId: state.id,
    });
    revalidatePath("/dashboard");
    revalidatePath("/calls");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Sample data mode OFF: delete ONLY rows carrying the sample markers. */
export async function clearSampleDataAction(): Promise<OnboardingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const wsId = ctx.workspaceId;

    // Delete QA scores + events of sample calls first (children), then the calls.
    const sampleCalls = await db.call.findMany({
      where: sampleCallWhere(wsId),
      select: { id: true },
    });
    const callIds = sampleCalls.map((c) => c.id);
    await db.qaScore.deleteMany({ where: { workspaceId: wsId, callId: { in: callIds } } });
    await db.callEvent.deleteMany({ where: { callId: { in: callIds } } });
    await db.transcriptEntry.deleteMany({ where: { callId: { in: callIds } } });
    await db.call.deleteMany({ where: sampleCallWhere(wsId) });

    await db.contact.deleteMany({ where: sampleContactWhere(wsId) });
    await db.campaign.deleteMany({
      where: { workspaceId: wsId, name: { startsWith: SAMPLE_PREFIX } },
    });
    await db.contactList.deleteMany({
      where: { workspaceId: wsId, name: { startsWith: SAMPLE_PREFIX } },
    });

    await db.onboardingState.update({
      where: { workspaceId: wsId },
      data: { sampleDataEnabled: false },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "onboarding.sample_data.clear", entity: "OnboardingState",
    });
    revalidatePath("/dashboard");
    revalidatePath("/calls");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.
**If it fails:** `Cannot find module '@/lib/onboarding'` → Step 4 files not created;
create them first. A Prisma type error about `checklist` → the field is `Json?`;
the code above already passes a plain object, which Prisma accepts — do not
`JSON.stringify` it.

---

## Step 7: The onboarding wizard (`/onboarding`)

Server page + one client component. The wizard REUSES guide 05/06 actions — it does
not re-implement agent creation, publishing, test runs or number registration.

**File `src/app/(app)/onboarding/page.tsx`** (full content):

```tsx
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { AGENT_TEMPLATES } from "@/lib/templates";
import { parseChecklist, progressPercent, canGoLive, nextStep } from "@/lib/onboarding";
import { WizardClient } from "./wizard-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Get started — Vaani AI" };

export default async function OnboardingPage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }

  const [workspace, state, trial, agents, numbers] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } }),
    db.onboardingState.upsert({
      where: { workspaceId: ctx.workspaceId },
      update: {},
      create: { workspaceId: ctx.workspaceId },
    }),
    db.trialState.findUnique({ where: { workspaceId: ctx.workspaceId } }),
    db.agent.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, status: true, dograhWorkflowId: true },
    }),
    db.phoneNumber.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "asc" },
      select: { id: true, number: true, label: true },
    }),
  ]);

  const checklist = parseChecklist(state.checklist);
  const industryTemplates = workspace.industry
    ? AGENT_TEMPLATES.filter(
        (t) => t.industry.toLowerCase().replace(/[^a-z0-9]+/g, "-") === workspace.industry,
      )
    : [];
  const templates = (industryTemplates.length > 0 ? industryTemplates : AGENT_TEMPLATES).map((t) => ({
    code: t.code,
    name: t.name,
    industry: t.industry,
    description: t.description,
  }));

  // Inline server action: assign the operator-provisioned trial sandbox DID.
  async function useSandboxNumberAction(): Promise<{ ok: boolean; error?: string }> {
    "use server";
    const { requirePermission } = await import("@/lib/auth");
    const { registerNumberAction, assignAgentAction } = await import("@/server/actions/numbers");
    const ctx2 = await requirePermission("settings:write");
    const sandbox = process.env.TRIAL_SANDBOX_NUMBER ?? "";
    if (!/^\+[1-9]\d{7,14}$/.test(sandbox)) {
      return { ok: false, error: "Trial sandbox number is not configured yet (operator sets TRIAL_SANDBOX_NUMBER)." };
    }
    const reg = await registerNumberAction({
      number: sandbox,
      label: "Trial sandbox",
      numberType: "LOCAL",
      monthlyRentPaise: 0,
    });
    if (!reg.ok && !reg.error?.includes("already registered")) return reg;
    const row = await db.phoneNumber.findFirst({
      where: { workspaceId: ctx2.workspaceId, number: sandbox },
    });
    if (!row) return { ok: false, error: "Sandbox number registration failed." };
    const agent = await db.agent.findFirst({
      where: { workspaceId: ctx2.workspaceId, status: "PUBLISHED" },
      orderBy: { createdAt: "asc" },
    });
    if (agent) {
      const asg = await assignAgentAction(row.id, agent.id);
      if (!asg.ok) return asg;
    }
    await db.trialState.upsert({
      where: { workspaceId: ctx2.workspaceId },
      update: { sandboxNumberId: row.id },
      create: { workspaceId: ctx2.workspaceId, sandboxNumberId: row.id },
    });
    return { ok: true };
  }

  return (
    <WizardClient
      initialStep={state.completedAt ? 5 : nextStep(checklist)}
      checklist={checklist}
      progress={progressPercent(checklist)}
      canFinish={canGoLive(checklist)}
      completed={state.completedAt != null}
      workspaceName={workspace.name}
      industry={workspace.industry ?? ""}
      templates={templates}
      agents={agents.map((a) => ({
        id: a.id,
        name: a.name,
        published: a.status === "PUBLISHED" && a.dograhWorkflowId != null,
      }))}
      numbers={numbers}
      kycStatus={trial?.kycStatus ?? "NOT_STARTED"}
      trialMinutesLeft={trial ? Math.max(0, trial.trialMinutesLimit - trial.trialMinutesUsed) : 0}
      sandboxConfigured={/^\+[1-9]\d{7,14}$/.test(process.env.TRIAL_SANDBOX_NUMBER ?? "")}
      useSandboxNumber={useSandboxNumberAction}
    />
  );
}
```

**File `src/app/(app)/onboarding/wizard-client.tsx`** (full content):

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  WIZARD_STEPS,
  type OnboardingChecklist,
} from "@/lib/onboarding";
import {
  completeOnboardingAction,
  markStepAction,
  setWizardIndustryAction,
} from "@/server/actions/onboarding";
import {
  createAgentFromTemplateAction,
  publishAgentAction,
  createTestRunAction,
} from "@/server/actions/agents";
import { addFaqDocumentAction } from "@/server/actions/knowledge";
import { registerNumberAction } from "@/server/actions/numbers";

const INDUSTRIES = [
  "healthcare", "real-estate", "education", "bfsi", "e-commerce",
  "logistics", "salon-spa", "hospitality", "recruitment", "d2c", "agency",
];

type Props = {
  initialStep: number;
  checklist: OnboardingChecklist;
  progress: number;
  canFinish: boolean;
  completed: boolean;
  workspaceName: string;
  industry: string;
  templates: { code: string; name: string; industry: string; description: string }[];
  agents: { id: string; name: string; published: boolean }[];
  numbers: { id: string; number: string; label: string | null }[];
  kycStatus: string;
  trialMinutesLeft: number;
  sandboxConfigured: boolean;
  useSandboxNumber: () => Promise<{ ok: boolean; error?: string }>;
};

export function WizardClient(props: Props) {
  const router = useRouter();
  const [step, setStep] = useState(props.initialStep);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [industry, setIndustry] = useState(props.industry);
  const [agentId, setAgentId] = useState<string | null>(props.agents[0]?.id ?? null);
  const [published, setPublished] = useState(props.agents[0]?.published ?? false);
  const [faq, setFaq] = useState("");
  const [numberInput, setNumberInput] = useState("");
  const [done, setDone] = useState(props.completed);

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setBusy(label); setError(null); setNotice(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return setError(res.error ?? "Something went wrong.");
    setNotice(`${label} — done.`);
    after?.();
    router.refresh();
  }

  const agentPicked = Boolean(props.checklist.template) || published;
  const kycBlocked = props.kycStatus !== "VERIFIED";

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="onboarding-wizard">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Set up {props.workspaceName}</h1>
        <p className="text-sm text-muted-foreground">Go live in under 30 minutes — {props.progress}% there.</p>
      </div>

      {/* Progress bar */}
      <div className="h-2 w-full rounded-full bg-muted" data-testid="onboarding-progress" data-progress={props.progress}>
        <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${props.progress}%` }} />
      </div>

      {/* Stepper */}
      <ol className="flex flex-wrap gap-2 text-xs">
        {WIZARD_STEPS.map((s) => (
          <li key={s.key}>
            <button
              type="button"
              data-testid={`onboarding-nav-${s.key}`}
              onClick={() => setStep(s.index)}
              className={`rounded-full border px-3 py-1 ${
                step === s.index
                  ? "border-primary bg-primary/10 text-primary"
                  : props.checklist[s.key as keyof OnboardingChecklist]
                    ? "border-primary/40 text-primary/80"
                    : "border-border text-muted-foreground"
              }`}
            >
              {s.index + 1}. {s.title}
            </button>
          </li>
        ))}
      </ol>

      {error && <p className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400" data-testid="onboarding-error">{error}</p>}
      {notice && <p className="rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-400" data-testid="onboarding-notice">{notice}</p>}

      {/* STEP 0 — industry */}
      {step === 0 && (
        <Card data-testid="onboarding-step-industry">
          <CardHeader><CardTitle>What does {props.workspaceName} do?</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">We pre-filter the template gallery and tune the agent script for your industry.</p>
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              data-testid="onboarding-industry-select"
              className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
            >
              <option value="">— pick your industry —</option>
              {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
            <Button
              disabled={busy !== null || !industry}
              data-testid="onboarding-industry-continue"
              onClick={() =>
                run("Industry saved", async () => {
                  const r = await setWizardIndustryAction(industry);
                  return r;
                }, () => setStep(1))
              }
            >
              {busy ? "Saving…" : "Continue"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* STEP 1 — template agent */}
      {step === 1 && (
        <Card data-testid="onboarding-step-template">
          <CardHeader><CardTitle>Pick a template agent</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Proven scripts from the guide-05 library. We create the agent AND publish it so you can test-call it in step 4.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {props.templates.map((t) => (
                <div key={t.code} className="rounded-lg border border-border p-4" data-testid={`onboarding-template-card-${t.code}`}>
                  <p className="font-semibold">{t.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
                  <Button
                    size="sm" className="mt-3" disabled={busy !== null}
                    data-testid={`onboarding-template-select-${t.code}`}
                    onClick={() =>
                      run(`Created "${t.name}"`, async () => {
                        const created = await createAgentFromTemplateAction(t.code);
                        if (!created.ok || !created.id) return { ok: false, error: created.error ?? "Create failed." };
                        setAgentId(created.id);
                        const pub = await publishAgentAction(created.id, "v1 — from onboarding");
                        if (!pub.ok) return { ok: false, error: `Created but publish failed: ${pub.error}` };
                        setPublished(true);
                        return markStepAction("template");
                      }, () => setStep(2))
                    }
                  >
                    {busy ? "Working…" : "Use this template"}
                  </Button>
                </div>
              ))}
            </div>
            {agentPicked && (
              <Button variant="outline" onClick={() => setStep(2)} data-testid="onboarding-template-next">Continue</Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* STEP 2 — knowledge base */}
      {step === 2 && (
        <Card data-testid="onboarding-step-knowledge">
          <CardHeader><CardTitle>Teach it your facts (optional)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Paste your FAQ — timings, prices, address, policies. The agent answers from this and nothing else.
              You can upload PDFs/DOCX later in Knowledge.
            </p>
            <textarea
              value={faq}
              onChange={(e) => setFaq(e.target.value)}
              rows={6}
              data-testid="onboarding-kb-textarea"
              placeholder={"Q: What are your timings? A: 10am–8pm, Mon–Sat.\nQ: How much is a consultation? A: ₹500."}
              className="w-full rounded-md border border-border bg-card p-3 text-sm"
            />
            <div className="flex gap-2">
              <Button
                disabled={busy !== null || faq.trim().length < 10}
                data-testid="onboarding-kb-save"
                onClick={() =>
                  run("Knowledge saved", async () => {
                    const r = await addFaqDocumentAction({
                      title: "Onboarding FAQ",
                      contentText: faq.trim(),
                      ...(agentId ? { agentId } : {}),
                    });
                    if (!r.ok) return r;
                    return markStepAction("knowledge");
                  }, () => setStep(3))
                }
              >
                {busy ? "Saving…" : "Save FAQ & continue"}
              </Button>
              <Button
                variant="ghost" disabled={busy !== null}
                data-testid="onboarding-kb-skip"
                onClick={() => run("Skipped knowledge", () => markStepAction("knowledge"), () => setStep(3))}
              >
                Skip for now
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 3 — test call */}
      {step === 3 && (
        <Card data-testid="onboarding-step-testcall">
          <CardHeader><CardTitle>Talk to your agent — in the browser</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              A Dograh test call opens in a new tab (uses your trial minutes: {props.trialMinutesLeft} left).
              Say hello, ask one of your FAQ questions, hang up.
            </p>
            <div className="flex gap-2">
              <Button
                disabled={busy !== null || !agentId || !published}
                data-testid="onboarding-test-call-btn"
                title={!agentId ? "Pick a template first" : !published ? "Agent not published yet" : "Open browser test call"}
                onClick={() =>
                  run("Test run created", async () => {
                    const r = await createTestRunAction(agentId!);
                    if (!r.ok) return r;
                    if (r.url) window.open(r.url, "_blank", "noopener");
                    return markStepAction("test_call");
                  }, () => setStep(4))
                }
              >
                {busy ? "Starting…" : "Start test call ↗"}
              </Button>
              <Button
                variant="ghost" disabled={busy !== null}
                data-testid="onboarding-testcall-skip"
                onClick={() => run("Skipped test call", () => markStepAction("test_call"), () => setStep(4))}
              >
                Skip for now
              </Button>
            </div>
            {!agentId && <p className="text-xs text-muted-foreground">Go back to step 2 and pick a template agent first.</p>}
          </CardContent>
        </Card>
      )}

      {/* STEP 4 — number */}
      {step === 4 && (
        <Card data-testid="onboarding-step-number">
          <CardHeader><CardTitle>Get a phone number</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {kycBlocked && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-400" data-testid="onboarding-kyc-banner">
                KYC status: {props.kycStatus}. Regulated Indian 140/1600-series numbers need a VERIFIED KYC —
                upload documents in <Link href="/settings/kyc" className="underline">Settings → KYC</Link>.
                Local/international numbers work instantly without KYC.
              </p>
            )}
            {props.numbers.length > 0 ? (
              <div className="space-y-2 text-sm">
                <p className="font-medium">Your numbers:</p>
                {props.numbers.map((n) => (
                  <p key={n.id} className="rounded-md border border-border p-2">{n.number} <span className="text-muted-foreground">{n.label ?? ""}</span></p>
                ))}
                <Button onClick={() => run("Number confirmed", () => markStepAction("number"), () => setStep(5))} data-testid="onboarding-number-continue">
                  Continue
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Option A — trial sandbox (instant, no KYC):</p>
                  <Button
                    variant="outline" disabled={busy !== null || !props.sandboxConfigured}
                    data-testid="onboarding-sandbox-btn"
                    title={props.sandboxConfigured ? "Attach the shared trial number" : "Operator has not configured TRIAL_SANDBOX_NUMBER yet"}
                    onClick={() =>
                      run("Sandbox attached", async () => {
                        const r = await props.useSandboxNumber();
                        if (!r.ok) return r;
                        return markStepAction("number");
                      }, () => setStep(5))
                    }
                  >
                    {props.sandboxConfigured ? "Use the free trial number" : "Trial number not configured (operator)"}
                  </Button>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Option B — register a DID you already own (from your Vobiz dashboard):</p>
                  <div className="flex gap-2">
                    <Input
                      value={numberInput}
                      onChange={(e) => setNumberInput(e.target.value)}
                      placeholder="+918040001234"
                      data-testid="onboarding-number-input"
                      className="max-w-xs"
                    />
                    <Button
                      disabled={busy !== null || !/^\+[1-9]\d{7,14}$/.test(numberInput)}
                      data-testid="onboarding-number-register"
                      onClick={() =>
                        run("Number registered", async () => {
                          const reg = await registerNumberAction({
                            number: numberInput,
                            label: "Primary",
                            numberType: "LOCAL",
                            monthlyRentPaise: 0,
                          });
                          if (!reg.ok) return reg;
                          return markStepAction("number");
                        }, () => setStep(5))
                      }
                    >
                      Register
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Buying new DIDs happens in the Vobiz dashboard (operator task). After registering, bind it to your
                    agent on the Numbers page.
                  </p>
                </div>
                <Button
                  variant="ghost" disabled={busy !== null}
                  data-testid="onboarding-number-skip"
                  onClick={() => run("Skipped number", () => markStepAction("number"), () => setStep(5))}
                >
                  Skip for now — I&apos;ll add a number later
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* STEP 5 — go live */}
      {step === 5 && !done && (
        <Card data-testid="onboarding-step-live">
          <CardHeader><CardTitle>Ready to go live</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-1 text-sm">
              {WIZARD_STEPS.slice(0, 5).map((s) => (
                <li key={s.key} className="flex items-center gap-2">
                  <span className={props.checklist[s.key as keyof OnboardingChecklist] ? "text-primary" : "text-muted-foreground"}>
                    {props.checklist[s.key as keyof OnboardingChecklist] ? "✓" : "○"}
                  </span>
                  {s.title}
                </li>
              ))}
            </ul>
            {!props.canFinish && (
              <p className="text-sm text-amber-400">Finish at least industry + template (steps 1–2) to go live.</p>
            )}
            <Button
              disabled={busy !== null || !props.canFinish}
              data-testid="onboarding-golive-btn"
              onClick={() =>
                run("You are live", async () => {
                  const r = await completeOnboardingAction();
                  return r;
                }, () => setDone(true))
              }
            >
              {busy ? "Finishing…" : "Go live 🎉"}
            </Button>
          </CardContent>
        </Card>
      )}

      {done && (
        <Card data-testid="onboarding-done">
          <CardHeader><CardTitle>You&apos;re live 🎉</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Your agent is answering. Every call lands on your dashboard with transcript, recording and cost.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild><Link href="/dashboard" data-testid="onboarding-done-dashboard">Open dashboard</Link></Button>
              <Button asChild variant="outline"><Link href="/calls">See calls</Link></Button>
              <Button asChild variant="outline"><Link href="/campaigns">Start an outbound campaign</Link></Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** exit 0 both; route `/onboarding` in the build output.
**If it fails:** `createAgentFromTemplateAction` etc. unresolved → guide 05 files
missing (STOP and report). Type error on the inline `useSandboxNumberAction` prop →
confirm the prop is passed exactly as `useSandboxNumber={useSandboxNumberAction}`.

**Manual check (dev server):** register a fresh account → open `/onboarding` → pick
industry → pick a template (publish may fail if Dograh is down; the error must show
in the red banner, and you may continue with "Skip" paths) → progress bar advances.

---

## Step 8: In-app guidance — Tooltip component, dashboard checklist widget, wizard resume

**File `src/components/ui/tooltip.tsx`** (full content — pure CSS hover tooltip, no new dependency):

```tsx
import type { ReactNode } from "react";

/**
 * Minimal tooltip (readme §13 in-app guidance). Wrap any element; the label shows
 * on hover/focus. `testid` gives Playwright a stable handle on the trigger wrapper.
 */
export function Tooltip({
  label,
  children,
  testid,
}: {
  label: string;
  children: ReactNode;
  testid?: string;
}) {
  return (
    <span className="group relative inline-flex" data-testid={testid}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute -top-2 left-1/2 z-50 w-56 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
```

**File `src/components/onboarding-resume.tsx`** (full content — wizard resume on login):

```tsx
"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Mounted once in the app layout. The layout passes `incomplete=true` ONLY for
 * brand-new workspaces (no checklist items done): any app page (except the wizard
 * itself and settings — KYC/branding live there) then bounces to /onboarding.
 * Workspaces that already started onboarding are nudged by the dashboard
 * checklist widget instead of a hard redirect.
 */
export function OnboardingResume({ incomplete }: { incomplete: boolean }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!incomplete) return;
    if (pathname.startsWith("/onboarding")) return;
    if (pathname.startsWith("/settings")) return;
    router.replace("/onboarding");
  }, [incomplete, pathname, router]);

  return null;
}
```

**File `src/components/onboarding-checklist.tsx`** (full content — dashboard widget + sample-data toggle):

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { CHECKLIST_KEYS, type OnboardingChecklist } from "@/lib/onboarding";
import {
  clearSampleDataAction,
  dismissChecklistAction,
  seedSampleDataAction,
} from "@/server/actions/onboarding";

const ITEM_META: Record<(typeof CHECKLIST_KEYS)[number], { label: string; href: string; tip: string }> = {
  industry: { label: "Pick your industry", href: "/onboarding", tip: "Templates and scripts are tuned per industry." },
  template: { label: "Create your first agent", href: "/onboarding", tip: "One click from a proven template — publish included." },
  knowledge: { label: "Add your FAQ / knowledge", href: "/knowledge", tip: "The agent answers only from your facts." },
  test_call: { label: "Make a browser test call", href: "/onboarding", tip: "Talk to your agent before spending a rupee." },
  number: { label: "Attach a phone number", href: "/numbers", tip: "Your AI starts answering real customers." },
};

type Props = {
  checklist: OnboardingChecklist;
  progress: number;
  completed: boolean;
  sampleDataEnabled: boolean;
};

export function OnboardingChecklistWidget({ checklist, progress, completed, sampleDataEnabled }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dashboard only — the layout mounts this globally, the widget self-locates.
  if (pathname !== "/dashboard") return null;

  async function toggleSampleData() {
    setBusy(true); setError(null);
    const res = sampleDataEnabled ? await clearSampleDataAction() : await seedSampleDataAction();
    setBusy(false);
    if (!res.ok) setError(res.error ?? "Something went wrong.");
    router.refresh();
  }

  async function dismiss() {
    setBusy(true);
    await dismissChecklistAction();
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="mb-6 space-y-4" data-testid="dashboard-guidance">
      {!completed && !checklist.dismissed && (
        <Card data-testid="onboarding-checklist">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Get live in under 30 minutes — {progress}%</CardTitle>
            <Button variant="ghost" size="sm" onClick={dismiss} disabled={busy} data-testid="checklist-dismiss">
              Dismiss
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="h-1.5 w-full rounded-full bg-muted">
              <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
            <ul className="space-y-1 pt-1 text-sm">
              {CHECKLIST_KEYS.map((key) => {
                const doneItem = Boolean(checklist[key]);
                const meta = ITEM_META[key];
                return (
                  <li key={key} data-testid={`checklist-item-${key}`}>
                    <Tooltip label={meta.tip} testid={`tooltip-checklist-${key}`}>
                      <Link
                        href={meta.href}
                        className={`flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted ${doneItem ? "text-muted-foreground line-through" : ""}`}
                      >
                        <span className={doneItem ? "text-primary" : "text-muted-foreground"}>{doneItem ? "✓" : "○"}</span>
                        {meta.label}
                      </Link>
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
            <Button asChild size="sm" className="mt-2">
              <Link href="/onboarding" data-testid="checklist-resume-wizard">Resume setup wizard</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card data-testid="sample-data-card">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="text-sm">
            <p className="font-medium">Sample data mode {sampleDataEnabled ? "is ON" : "is off"}</p>
            <p className="text-xs text-muted-foreground">
              Demo calls, contacts and a campaign so you can explore dashboards before real traffic.
              Clearly marked &quot;Sample —&quot;; one click removes every sample row.
            </p>
            {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
          </div>
          <Button
            variant={sampleDataEnabled ? "destructive" : "outline"}
            size="sm"
            disabled={busy}
            onClick={toggleSampleData}
            data-testid="sample-data-toggle"
          >
            {busy ? "Working…" : sampleDataEnabled ? "Clear sample data" : "Load sample data"}
          </Button>
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
**Expected:** exit 0.

**Tooltip placement list** (for guide 11's E2E assertions and future polish — the
tooltips INSIDE this guide's own pages are already wired; do not edit other
guides' files):

| Page | Element (existing testid) | Suggested tooltip |
|---|---|---|
| `/agents/[id]` | `agent-publish-btn` | "Publish creates a Dograh workflow version — required before test calls." |
| `/agents/[id]` | `agent-test-call-btn` | "Opens a Dograh browser call — uses trial minutes." |
| `/campaigns` | campaign start button | "Dials begin inside your calling window; DNC contacts are skipped." |
| `/billing` | top-up button | "Test mode: no real money. Calls debit per second with markup." |
| `/numbers` | assign-agent control | "Inbound calls to this DID ring the assigned agent." |
| `/analytics` | ASR metric | "Answer-seize ratio: answered ÷ dialed." |
| `/onboarding` | each wizard step | wired in Step 7 (`tooltip-checklist-*` on the dashboard widget). |

---

## Step 9: App layout rewrite — brand color injection, logo, active nav, resume + checklist mount

This REPLACES guide 05's `(app)/layout.tsx` (superset: keeps the same NAV —
including guide 06's `/live`, `/transfers`, `/dialer` items — and the wallet block;
adds white-label branding + guidance). Create the NavLink component
first, then the layout.

**File `src/app/(app)/nav-link.tsx`** (full content):

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";

export function NavLink({ href, label, icon: Icon }: { href: string; label: string; icon: LucideIcon }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      data-testid={`nav-${label.toLowerCase()}`}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}
```

**File `src/app/(app)/layout.tsx`** (full content — overwrite):

```tsx
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { logoutAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { formatINR } from "@/lib/money";
import { hexToHslTriplet } from "@/lib/branding";
import { CHECKLIST_KEYS, parseChecklist, progressPercent } from "@/lib/onboarding";
import { NavLink } from "./nav-link";
import { OnboardingResume } from "@/components/onboarding-resume";
import { OnboardingChecklistWidget } from "@/components/onboarding-checklist";
import {
  LayoutDashboard, Bot, PhoneOutgoing, Users, PhoneCall, Radio, ArrowRightLeft, PhoneForwarded,
  Phone, BarChart3, Wallet, Settings, Store, BookOpen, Sparkles,
} from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/marketplace", label: "Marketplace", icon: Store },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/campaigns", label: "Campaigns", icon: PhoneOutgoing },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/calls", label: "Calls", icon: PhoneCall },
  { href: "/live", label: "Live", icon: Radio },
  { href: "/transfers", label: "Transfers", icon: ArrowRightLeft },
  { href: "/dialer", label: "Dialer", icon: PhoneForwarded },
  { href: "/numbers", label: "Numbers", icon: Phone },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/billing", label: "Billing", icon: Wallet },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }

  const [wallet, workspace, onboarding] = await Promise.all([
    db.wallet.findUnique({ where: { workspaceId: ctx.workspaceId } }),
    db.workspace.findUniqueOrThrow({
      where: { id: ctx.workspaceId },
      select: { name: true, logoUrl: true, primaryColor: true, whiteLabelEnabled: true },
    }),
    db.onboardingState.findUnique({ where: { workspaceId: ctx.workspaceId } }),
  ]);

  // White-label (readme §3.1): brand color overrides the shadcn --primary HSL var
  // for this workspace only, injected inline (no client round-trip, no FOUC).
  const brandTriplet = workspace.primaryColor ? hexToHslTriplet(workspace.primaryColor) : null;
  const brandName = workspace.whiteLabelEnabled ? workspace.name : null;

  const checklist = parseChecklist(onboarding?.checklist);
  const completed = onboarding?.completedAt != null;
  // Force the wizard only while NOTHING is done (brand-new workspaces). A workspace
  // that has started (e.g. the seeded demo: industry+template+knowledge done) gets
  // the dashboard checklist widget instead of a hard redirect — otherwise every
  // existing-guide flow (guide 11 E2E golden path) would be hijacked to /onboarding.
  const nothingDone = !CHECKLIST_KEYS.some((k) => checklist[k]);
  const forceWizard = !completed && nothingDone;

  return (
    <div className="flex min-h-screen">
      {brandTriplet && (
        <style
          data-testid="brand-style"
          dangerouslySetInnerHTML={{ __html: `:root{--primary:${brandTriplet};}` }}
        />
      )}
      <OnboardingResume incomplete={forceWizard} />
      <aside className="flex w-60 flex-col border-r bg-card" data-testid="app-sidebar">
        <div className="flex items-center gap-2 p-5 text-lg font-bold">
          {workspace.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/api/branding/logo" alt={workspace.name} className="h-8 w-8 rounded object-contain" data-testid="app-logo" />
          ) : null}
          {brandName ?? (
            <span>Vaani <span className="text-primary">AI</span></span>
          )}
        </div>
        <nav className="flex-1 space-y-1 px-3">
          <NavLink href="/onboarding" label="Setup" icon={Sparkles} />
          {NAV.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </nav>
        <div className="border-t p-4">
          <p className="text-xs text-muted-foreground">Wallet</p>
          <p className="font-semibold text-primary">{formatINR(wallet?.balancePaise ?? 0)}</p>
          <p className="mt-2 truncate text-xs text-muted-foreground">{ctx.user.email}</p>
          <form action={logoutAction} className="mt-2">
            <Button variant="ghost" size="sm" className="w-full justify-start px-0">
              Sign out
            </Button>
          </form>
        </div>
      </aside>
      <main className="flex-1 p-8">
        <OnboardingChecklistWidget
          checklist={checklist}
          progress={progressPercent(checklist)}
          completed={completed}
          sampleDataEnabled={onboarding?.sampleDataEnabled ?? false}
        />
        {children}
      </main>
    </div>
  );
}
```

**Middleware patch — make the domain-ask route public** (Caddy calls it without
cookies; guide 12 wires it). Edit `src/middleware.ts`: find

```ts
  "/api/v1/",         // public REST API — guarded by requireApiKey, not cookies
```

and directly AFTER that line insert:

```ts
  "/api/domain-ask",  // Caddy on-demand TLS ask endpoint — public by design (guide 10/12)
```

**Verify:**
```bash
npm run typecheck && npm run build
grep -n "api/domain-ask" src/middleware.ts
```
**Expected:** exit 0 both; grep prints the inserted line. Browser: sidebar shows the
new "Setup" nav item, current page highlighted; on `/dashboard` the checklist card
and the sample-data card appear for an incomplete workspace; after finishing the
wizard they collapse to just the sample-data card.
**If it fails:** `@next/next/no-img-element` lint error in build → the eslint
disable comment above the `<img>` is required; restore it exactly.

---

## Step 10: India KYC flow (`/settings/kyc`)

Upload → MinIO → `KycRecord` (PENDING) → `TrialState.kycStatus` updated. The
purchase gate itself is enforced by guide 09 inside `registerNumberAction`; this
page is the UI half + the status banner.

**File `src/server/actions/kyc.ts`** (full content):

```ts
"use server";

import { revalidatePath } from "next/cache";
import { KycDocumentType } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { putObject, ensureBucket } from "@/lib/storage";

export type KycResult = { ok: boolean; error?: string };

const KYC_BUCKET = process.env.S3_BUCKET_KYC ?? "vaani-kyc";
const KYC_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const KYC_MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

/** FormData: file (pdf/png/jpg ≤5MB), documentType (KycDocumentType), documentRef? */
export async function submitKycDocumentAction(formData: FormData): Promise<KycResult> {
  try {
    const ctx = await requirePermission("settings:write");

    const file = formData.get("file");
    const documentType = String(formData.get("documentType") ?? "");
    const documentRef = String(formData.get("documentRef") ?? "").trim() || null;

    if (!(file instanceof File)) return { ok: false, error: "Attach a document file." };
    if (!(Object.values(KycDocumentType) as string[]).includes(documentType)) {
      return { ok: false, error: "Pick a document type." };
    }
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    const mime = KYC_MIME[ext];
    if (!mime) return { ok: false, error: "Document must be PDF, PNG or JPG." };
    if (file.size <= 0) return { ok: false, error: "File is empty." };
    if (file.size > KYC_MAX_BYTES) return { ok: false, error: "Document must be under 5 MB." };

    // A fresh submission supersedes a REJECTED one; PENDING stays PENDING.
    const storageKey = `kyc/${ctx.workspaceId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const buf = Buffer.from(await file.arrayBuffer());
    await ensureBucket(KYC_BUCKET);
    await putObject(KYC_BUCKET, storageKey, buf, mime);

    const record = await db.kycRecord.create({
      data: {
        workspaceId: ctx.workspaceId,
        documentType: documentType as KycDocumentType,
        documentRef,
        storageKey,
        status: "PENDING",
      },
    });

    await db.trialState.upsert({
      where: { workspaceId: ctx.workspaceId },
      update: { kycStatus: "PENDING" },
      create: { workspaceId: ctx.workspaceId, kycStatus: "PENDING" },
    });

    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "kyc.submit", entity: "KycRecord", entityId: record.id,
      metadata: { documentType, documentRef },
    });
    revalidatePath("/settings/kyc");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}
```

**File `src/app/(app)/settings/kyc/page.tsx`** (full content):

```tsx
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { submitKycDocumentAction } from "@/server/actions/kyc";
import { KycForm } from "./kyc-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "KYC — Vaani AI" };

const STATUS_STYLES: Record<string, string> = {
  NOT_STARTED: "border-border text-muted-foreground",
  PENDING: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  VERIFIED: "border-green-500/40 bg-green-500/10 text-green-400",
  REJECTED: "border-red-500/40 bg-red-500/10 text-red-400",
};

export default async function KycPage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }

  const [trial, records] = await Promise.all([
    db.trialState.findUnique({ where: { workspaceId: ctx.workspaceId } }),
    db.kycRecord.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);
  const kycStatus = trial?.kycStatus ?? "NOT_STARTED";

  async function submit(formData: FormData) {
    "use server";
    return submitKycDocumentAction(formData);
  }

  return (
    <div className="max-w-2xl space-y-6" data-testid="kyc-page">
      <h1 className="text-2xl font-bold">India KYC</h1>

      <div className={`rounded-md border p-3 text-sm ${STATUS_STYLES[kycStatus] ?? STATUS_STYLES.NOT_STARTED}`} data-testid="kyc-status-banner">
        KYC status: <span className="font-semibold">{kycStatus}</span>
        {kycStatus === "VERIFIED" && " — you can purchase regulated 140/1600-series numbers."}
        {kycStatus === "PENDING" && " — under review (usually 1 business day). Local and international numbers work without KYC."}
        {kycStatus === "REJECTED" && " — the last submission was rejected; upload clearer documents below."}
        {kycStatus === "NOT_STARTED" && " — required only for regulated 140/1600-series numbers. Local and international numbers are instant, no KYC needed."}
      </div>

      <Card>
        <CardHeader><CardTitle>Upload a KYC document</CardTitle></CardHeader>
        <CardContent>
          <KycForm action={submit} />
          <p className="mt-3 text-xs text-muted-foreground">
            Accepted: GST certificate, PAN, Aadhaar, or certificate of incorporation (PDF/PNG/JPG, max 5 MB).
            Documents are stored in private object storage and reviewed by the operator
            (review flips TrialState.kycStatus → VERIFIED/REJECTED in the database).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Submissions</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {records.map((r) => (
            <p key={r.id} className="flex justify-between border-b pb-1 last:border-0" data-testid={`kyc-record-${r.id}`}>
              <span>{r.documentType}{r.documentRef ? ` · ${r.documentRef}` : ""}</span>
              <span className="text-muted-foreground">
                {r.status} · {r.createdAt.toLocaleDateString("en-IN")}
              </span>
            </p>
          ))}
          {records.length === 0 && <p className="text-muted-foreground">No submissions yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
```

**File `src/app/(app)/settings/kyc/kyc-form.tsx`** (full content):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";

const DOC_TYPES = [
  { value: "GST", label: "GST certificate" },
  { value: "PAN", label: "PAN card" },
  { value: "AADHAAR", label: "Aadhaar" },
  { value: "INCORPORATION", label: "Certificate of incorporation" },
  { value: "OTHER", label: "Other" },
];

export function KycForm({
  action,
}: {
  action: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <form
      className="space-y-3"
      data-testid="kyc-form"
      action={async (formData) => {
        setBusy(true); setError(null); setDone(false);
        const res = await action(formData);
        setBusy(false);
        if (!res.ok) return setError(res.error ?? "Something went wrong.");
        setDone(true);
        router.refresh();
      }}
    >
      <select
        name="documentType"
        required
        defaultValue="GST"
        data-testid="kyc-doctype-select"
        className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
      >
        {DOC_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
      </select>
      <Input name="documentRef" placeholder="GSTIN / PAN / Aadhaar number (optional)" data-testid="kyc-ref-input" />
      <Tooltip label="PDF, PNG or JPG up to 5 MB. Stored privately; reviewed by the operator." testid="tooltip-kyc-file">
        <input
          type="file"
          name="file"
          required
          accept=".pdf,.png,.jpg,.jpeg"
          data-testid="kyc-file-input"
          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-2 file:text-sm"
        />
      </Tooltip>
      <Button type="submit" disabled={busy} data-testid="kyc-submit-btn">
        {busy ? "Uploading…" : "Submit for review"}
      </Button>
      {error && <p className="text-sm text-red-400" data-testid="kyc-error">{error}</p>}
      {done && <p className="text-sm text-green-400" data-testid="kyc-success">Submitted — status is now PENDING.</p>}
    </form>
  );
}
```

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** exit 0 both; `/settings/kyc` route present. Browser (demo login):
open Settings → India KYC → banner shows VERIFIED (seed data); the submissions
list shows the seeded GST record. With a FRESH workspace: banner NOT_STARTED →
upload a small PDF → success message, banner flips to PENDING, a row appears in
Submissions. Confirm the object landed in MinIO:

```bash
docker exec vaani-minio sh -c "mc ls --recursive local/vaani-kyc/ 2>/dev/null || true"
```
(If `mc` is not initialised inside the container this prints nothing — verify via
the DB instead:)
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
  "SELECT \"documentType\", status, \"storageKey\" IS NOT NULL AS has_file FROM \"KycRecord\" ORDER BY \"createdAt\" DESC LIMIT 3;"
```
**Expected:** the new row with `has_file = t`.

---

## Step 11: White-label branding (`/settings/branding`) + logo route + domain-ask route

**File `src/server/actions/branding.ts`** (full content):

```ts
"use server";

import { revalidatePath } from "next/cache";
import dns from "node:dns/promises";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { putObject, ensureBucket } from "@/lib/storage";
import {
  isValidHexColor,
  logoContentType,
  logoStorageKey,
  validateLogoUpload,
} from "@/lib/branding";
import {
  normalizeDomain,
  verifyDomainOwnership,
  type DnsResolver,
} from "@/lib/domain-verify";
import { checkFeatureGate } from "@/lib/feature-gates";

export type BrandingResult = { ok: boolean; error?: string };

const BRANDING_BUCKET = process.env.S3_BUCKET_BRANDING ?? "vaani-branding";

const nodeResolver: DnsResolver = {
  resolveTxt: (h) => dns.resolveTxt(h),
  resolveCname: (h) => dns.resolveCname(h),
};

/** White-label is plan-gated (guide 09). Fail CLOSED when gates are unavailable. */
async function assertWhiteLabelAllowed(workspaceId: string): Promise<string | null> {
  try {
    const gate = await checkFeatureGate(workspaceId, "whiteLabel");
    if (!gate.allowed) {
      return "White-label requires the Enterprise plan (or the white-label add-on) — upgrade in Billing.";
    }
    return null;
  } catch (e) {
    console.error("[branding] feature gate check failed", e);
    return "Plan feature check unavailable — complete guide 09 billing first.";
  }
}

/** Logo upload (FormData: file). Stored in MinIO; Workspace.logoUrl holds the KEY. */
export async function uploadLogoAction(formData: FormData): Promise<BrandingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, error: "Choose a logo file." };
    const check = validateLogoUpload(file.name, file.size);
    if (!check.ok) return check;

    const key = logoStorageKey(ctx.workspaceId, file.name);
    const buf = Buffer.from(await file.arrayBuffer());
    await ensureBucket(BRANDING_BUCKET);
    await putObject(BRANDING_BUCKET, key, buf, logoContentType(file.name));

    await db.workspace.update({ where: { id: ctx.workspaceId }, data: { logoUrl: key } });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "branding.logo", entity: "Workspace", entityId: ctx.workspaceId,
      metadata: { key },
    });
    revalidatePath("/settings/branding");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

export async function removeLogoAction(): Promise<BrandingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    await db.workspace.update({ where: { id: ctx.workspaceId }, data: { logoUrl: null } });
    revalidatePath("/settings/branding");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

const colorSchema = z.object({ primaryColor: z.string().refine(isValidHexColor, "Use #rrggbb.") });

export async function savePrimaryColorAction(input: unknown): Promise<BrandingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const parsed = colorSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Color must be hex like #7c3aed." };
    await db.workspace.update({
      where: { id: ctx.workspaceId },
      data: { primaryColor: parsed.data.primaryColor.toLowerCase() },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "branding.color", entity: "Workspace", entityId: ctx.workspaceId,
      metadata: { primaryColor: parsed.data.primaryColor },
    });
    revalidatePath("/settings/branding");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

export async function saveCustomDomainAction(input: unknown): Promise<BrandingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const gateError = await assertWhiteLabelAllowed(ctx.workspaceId);
    if (gateError) return { ok: false, error: gateError };
    const parsed = z.object({ domain: z.string().min(4).max(253) }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "Enter a domain." };
    const domain = normalizeDomain(parsed.data.domain);
    if (!domain) return { ok: false, error: "That is not a valid hostname (e.g. app.yourbrand.com)." };
    await db.workspace.update({
      where: { id: ctx.workspaceId },
      data: { customDomain: domain, customDomainVerifiedAt: null }, // re-verify on change
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "branding.domain.save", entity: "Workspace", entityId: ctx.workspaceId,
      metadata: { domain },
    });
    revalidatePath("/settings/branding");
    return { ok: true };
  } catch (e) {
    if (String(e).includes("Unique constraint")) {
      return { ok: false, error: "That domain is already claimed by another workspace." };
    }
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** DNS check (TXT vaani-verification=<workspaceId> or CNAME → app host). */
export async function verifyCustomDomainAction(): Promise<BrandingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } });
    if (!workspace.customDomain) return { ok: false, error: "Save a custom domain first." };
    const appHost = (process.env.APP_URL ?? "http://localhost:3000").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const result = await verifyDomainOwnership({
      domain: workspace.customDomain,
      workspaceId: ctx.workspaceId,
      appHost,
      resolver: nodeResolver,
    });
    if (!result.ok) return { ok: false, error: result.error ?? "Verification failed." };
    await db.workspace.update({
      where: { id: ctx.workspaceId },
      data: { customDomainVerifiedAt: new Date() },
    });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "branding.domain.verify", entity: "Workspace", entityId: ctx.workspaceId,
      metadata: { domain: workspace.customDomain, method: result.method },
    });
    revalidatePath("/settings/branding");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

export async function removeCustomDomainAction(): Promise<BrandingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    await db.workspace.update({
      where: { id: ctx.workspaceId },
      data: { customDomain: null, customDomainVerifiedAt: null },
    });
    revalidatePath("/settings/branding");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

/** Master white-label switch — plan-gated; requires a verified custom domain. */
export async function setWhiteLabelEnabledAction(enabled: boolean): Promise<BrandingResult> {
  try {
    const ctx = await requirePermission("settings:write");
    const gateError = await assertWhiteLabelAllowed(ctx.workspaceId);
    if (gateError) return { ok: false, error: gateError };
    if (enabled) {
      const ws = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } });
      if (!ws.customDomainVerifiedAt) {
        return { ok: false, error: "Verify your custom domain first — white-label serves from your domain." };
      }
    }
    await db.workspace.update({ where: { id: ctx.workspaceId }, data: { whiteLabelEnabled: enabled } });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: enabled ? "branding.whitelabel.enable" : "branding.whitelabel.disable",
      entity: "Workspace", entityId: ctx.workspaceId,
    });
    revalidatePath("/settings/branding");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}
```

**Verify:**
```bash
npm run typecheck
```
**Expected:** exit 0.
**If it fails:** `Cannot find module '@/lib/feature-gates'` → guide 09 incomplete;
STOP and report (do NOT stub it — the fail-closed wrapper already handles runtime
absence, but the import must exist).

**File `src/app/api/branding/logo/route.ts`** (full content — serves the current
workspace's logo; session-guarded):

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { s3, ensureBucket } from "@/lib/storage";

const BRANDING_BUCKET = process.env.S3_BUCKET_BRANDING ?? "vaani-branding";

/** GET /api/branding/logo → 302 to a 15-min presigned MinIO URL (or 404). */
export async function GET() {
  try {
    const ctx = await requireWorkspace();
    const ws = await db.workspace.findUnique({
      where: { id: ctx.workspaceId },
      select: { logoUrl: true },
    });
    if (!ws?.logoUrl) return new NextResponse("no logo", { status: 404 });
    await ensureBucket(BRANDING_BUCKET);
    const url = await s3.presignedGetObject(BRANDING_BUCKET, ws.logoUrl, 15 * 60);
    return NextResponse.redirect(url);
  } catch {
    return new NextResponse("unauthorized", { status: 401 });
  }
}
```

**File `src/app/api/domain-ask/route.ts`** (full content — Caddy on-demand TLS ask
endpoint; PUBLIC via the middleware patch in Step 9):

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeDomain } from "@/lib/domain-verify";

/**
 * Caddy on-demand TLS "ask" endpoint (guide 12 Caddyfile). Caddy calls this before
 * issuing a certificate for a workspace custom domain. Approve ONLY domains that
 * are claimed by a workspace AND DNS-verified — anything else must 403 so random
 * hostnames cannot burn our Let's Encrypt rate limit.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("domain");
  if (!raw) return new NextResponse("domain param required", { status: 400 });
  const domain = normalizeDomain(raw);
  if (!domain) return new NextResponse("bad domain", { status: 400 });
  const ws = await db.workspace.findFirst({
    where: { customDomain: domain, customDomainVerifiedAt: { not: null } },
    select: { id: true },
  });
  if (!ws) return new NextResponse("not verified", { status: 403 });
  return new NextResponse("ok", { status: 200 });
}
```

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** exit 0 both; routes `/api/branding/logo` and `/api/domain-ask` present.

---

## Step 12: Branding page UI

**File `src/app/(app)/settings/branding/page.tsx`** (full content):

```tsx
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { expectedTxtValue } from "@/lib/domain-verify";
import { checkFeatureGate } from "@/lib/feature-gates";
import {
  removeCustomDomainAction,
  removeLogoAction,
  saveCustomDomainAction,
  savePrimaryColorAction,
  setWhiteLabelEnabledAction,
  uploadLogoAction,
  verifyCustomDomainAction,
} from "@/server/actions/branding";
import { BrandingForms } from "./branding-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Branding — Vaani AI" };

export default async function BrandingPage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }

  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } });

  // Plan gate (guide 09). On any error, treat as not allowed — fail closed.
  let whiteLabelAllowed = false;
  let gateNote: string | null = null;
  try {
    const gate = await checkFeatureGate(ctx.workspaceId, "whiteLabel");
    whiteLabelAllowed = gate.allowed;
    if (!gate.allowed) gateNote = "White-label requires the Enterprise plan or the white-label add-on.";
  } catch {
    gateNote = "Plan feature check unavailable (guide 09 billing incomplete).";
  }

  const appHost = (process.env.APP_URL ?? "http://localhost:3000").replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  return (
    <div className="max-w-2xl space-y-6" data-testid="branding-page">
      <h1 className="text-2xl font-bold">White-label branding</h1>

      {gateNote && !whiteLabelAllowed && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-400" data-testid="branding-gate-banner">
          {gateNote} Logo and brand color still work on every plan.
        </p>
      )}

      <BrandingForms
        hasLogo={Boolean(workspace.logoUrl)}
        primaryColor={workspace.primaryColor ?? ""}
        customDomain={workspace.customDomain ?? ""}
        domainVerified={workspace.customDomainVerifiedAt != null}
        whiteLabelEnabled={workspace.whiteLabelEnabled}
        whiteLabelAllowed={whiteLabelAllowed}
        verificationTxt={expectedTxtValue(ctx.workspaceId)}
        appHost={appHost}
        actions={{
          uploadLogo: uploadLogoAction,
          removeLogo: removeLogoAction,
          saveColor: savePrimaryColorAction,
          saveDomain: saveCustomDomainAction,
          verifyDomain: verifyCustomDomainAction,
          removeDomain: removeCustomDomainAction,
          setWhiteLabel: setWhiteLabelEnabledAction,
        }}
      />

      <Card>
        <CardHeader><CardTitle>How custom domains work</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. Save your domain (e.g. <code>calls.yourbrand.com</code>).</p>
          <p>2. At your DNS provider add EITHER a TXT record <code>{expectedTxtValue(ctx.workspaceId)}</code> on the domain, OR a CNAME to <code>{appHost}</code>.</p>
          <p>3. Click Verify. Once verified, HTTPS on your domain is issued automatically by the platform (on-demand TLS, guide 12) — no certificate work for you.</p>
          <p>4. Flip the white-label switch: the app shell then shows your workspace name instead of Vaani AI, with your logo and color.</p>
        </CardContent>
      </Card>
    </div>
  );
}
```

**File `src/app/(app)/settings/branding/branding-forms.tsx`** (full content):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";

type Result = { ok: boolean; error?: string };

type Actions = {
  uploadLogo: (formData: FormData) => Promise<Result>;
  removeLogo: () => Promise<Result>;
  saveColor: (input: { primaryColor: string }) => Promise<Result>;
  saveDomain: (input: { domain: string }) => Promise<Result>;
  verifyDomain: () => Promise<Result>;
  removeDomain: () => Promise<Result>;
  setWhiteLabel: (enabled: boolean) => Promise<Result>;
};

export function BrandingForms(props: {
  hasLogo: boolean;
  primaryColor: string;
  customDomain: string;
  domainVerified: boolean;
  whiteLabelEnabled: boolean;
  whiteLabelAllowed: boolean;
  verificationTxt: string;
  appHost: string;
  actions: Actions;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [color, setColor] = useState(props.primaryColor || "#14b8a6");
  const [domain, setDomain] = useState(props.customDomain);

  async function run(label: string, fn: () => Promise<Result>) {
    setBusy(label); setError(null); setNotice(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return setError(res.error ?? "Something went wrong.");
    setNotice(`${label} — done.`);
    router.refresh();
  }

  return (
    <>
      {error && <p className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400" data-testid="branding-error">{error}</p>}
      {notice && <p className="rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-400" data-testid="branding-notice">{notice}</p>}

      <Card>
        <CardHeader><CardTitle>Logo</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {props.hasLogo && (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/api/branding/logo" alt="workspace logo" className="h-12 w-12 rounded border object-contain" data-testid="branding-logo-preview" />
              <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => run("Logo removed", props.actions.removeLogo)} data-testid="branding-logo-remove">
                Remove
              </Button>
            </div>
          )}
          <form
            className="flex flex-wrap items-center gap-2"
            data-testid="branding-logo-form"
            action={(formData) => run("Logo uploaded", () => props.actions.uploadLogo(formData))}
          >
            <Tooltip label="PNG/JPG/WEBP/SVG up to 512 KB. Square logos look best." testid="tooltip-branding-logo">
              <input type="file" name="file" required accept=".png,.jpg,.jpeg,.webp,.svg" data-testid="branding-logo-input"
                className="block text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-2 file:text-sm" />
            </Tooltip>
            <Button type="submit" variant="outline" disabled={busy !== null} data-testid="branding-logo-upload">
              {busy === "Logo uploaded" ? "Uploading…" : "Upload"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Brand color</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              data-testid="branding-color-picker"
              className="h-10 w-14 cursor-pointer rounded border border-border bg-card"
            />
            <Input value={color} onChange={(e) => setColor(e.target.value)} className="max-w-[120px]" data-testid="branding-color-hex" />
            <Button
              variant="outline" disabled={busy !== null}
              onClick={() => run("Color saved", () => props.actions.saveColor({ primaryColor: color }))}
              data-testid="branding-color-save"
            >
              Save color
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Applied instantly across your app shell (buttons, highlights) via the <code>--primary</code> CSS variable.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Custom domain</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {props.customDomain ? (
            <div className="space-y-2 text-sm">
              <p>
                Domain: <span className="font-semibold">{props.customDomain}</span>{" "}
                <span
                  className={props.domainVerified ? "text-green-400" : "text-amber-400"}
                  data-testid="branding-domain-status"
                >
                  {props.domainVerified ? "verified ✓" : "not verified"}
                </span>
              </p>
              {!props.domainVerified && (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground" data-testid="branding-dns-instructions">
                  <p>Add ONE of these DNS records at your DNS provider, then click Verify:</p>
                  <p className="mt-1">• TXT <code>{props.verificationTxt}</code> on <code>{props.customDomain}</code></p>
                  <p>• or CNAME <code>{props.customDomain}</code> → <code>{props.appHost}</code></p>
                  <p className="mt-1">DNS can take a few minutes to propagate.</p>
                </div>
              )}
              <div className="flex gap-2">
                {!props.domainVerified && (
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("Domain verified", props.actions.verifyDomain)} data-testid="branding-domain-verify">
                    {busy === "Domain verified" ? "Checking DNS…" : "Verify DNS"}
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => run("Domain removed", props.actions.removeDomain)} data-testid="branding-domain-remove">
                  Remove domain
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="calls.yourbrand.com"
                className="max-w-xs"
                data-testid="branding-domain-input"
                disabled={!props.whiteLabelAllowed}
              />
              <Button
                variant="outline"
                disabled={busy !== null || !domain || !props.whiteLabelAllowed}
                onClick={() => run("Domain saved", () => props.actions.saveDomain({ domain }))}
                data-testid="branding-domain-save"
              >
                Save domain
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>White-label mode</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {props.whiteLabelEnabled
              ? "ON — your workspace name, logo and color replace Vaani AI branding."
              : "Off — Vaani AI branding shows in the app shell."}
            {!props.whiteLabelAllowed && " (Enterprise plan / add-on required.)"}
          </p>
          <Button
            variant={props.whiteLabelEnabled ? "destructive" : "default"}
            size="sm"
            disabled={busy !== null || !props.whiteLabelAllowed || (!props.whiteLabelEnabled && !props.domainVerified)}
            onClick={() => run("White-label updated", () => props.actions.setWhiteLabel(!props.whiteLabelEnabled))}
            data-testid="branding-whitelabel-toggle"
            title={!props.domainVerified ? "Verify your custom domain first" : undefined}
          >
            {props.whiteLabelEnabled ? "Disable" : "Enable"}
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
```

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** exit 0 both; `/settings/branding` route present. Browser (demo
workspace — seeded on the Starter plan, whiteLabel NOT allowed): gate banner shows;
logo upload + color save work; after saving `#7c3aed` the sidebar accent turns
violet on next load (the seeded demo workspace already has this color — change it
to `#ff8800` and see orange). Custom-domain + toggle are disabled with tooltips.

---

## Step 13: Micro-polish — page titles

Add near the top of each app page that lacks one (the export coexists with
`export const dynamic = "force-dynamic"`):

```tsx
export const metadata = { title: "<Page name> — Vaani AI" };
```

Pages: dashboard ("Dashboard"), agents ("Agents"), marketplace ("Marketplace"),
knowledge ("Knowledge"), campaigns ("Campaigns"), contacts ("Contacts"), calls
("Calls"), numbers ("Numbers"), analytics ("Analytics"), billing ("Billing").
Settings/KYC/branding pages already have theirs from this guide.

**Verify:**
```bash
npm run typecheck && npm run build
```
**Expected:** exit 0 both. Browser: tab titles read e.g. "Calls — Vaani AI";
current page is highlighted in the sidebar.

---

## Step 14: Responsive smoke pass (operator, 15 minutes)

On a real phone or dev-tools device toolbar (iPhone SE width), check each page:

| Page | Expected on mobile |
|---|---|
| `/` (landing) | stacked sections, readable hero, comparison table scrolls INSIDE its section, no page-level horizontal scroll |
| `/login`, `/register` | card fits width, inputs tappable |
| `/onboarding` | wizard cards stack; template cards single-column; progress bar full-width |
| `/dashboard` | stat cards wrap; checklist widget readable |
| `/calls` | table scrolls horizontally inside its card, page doesn't break |
| `/agents`, `/campaigns` | cards stack single-column |
| `/settings/branding`, `/settings/kyc` | forms stack; file input usable |

Note: the fixed 240px sidebar does NOT collapse in v1 (accepted trade-off — app is
desktop-first for business users; landing + auth + onboarding must be perfect on
mobile). Any BROKEN layout on landing/auth/onboarding = fix before continuing.

---

## Step 15: Integration tests — curl (auth + public endpoints)

Start the dev server if not running:
```bash
cd /root/vaani-ai
(npm run dev > /tmp/next-dev.log 2>&1 &) ; sleep 8
```

**T1 — domain-ask is public and rejects unknown domains:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/domain-ask?domain=nobody-claimed-this.example.com"
```
**Expected:** `403` (public route, but the domain is not claimed+verified).

**T2 — domain-ask validates the param:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/domain-ask"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/domain-ask?domain=not%20a%20domain"
```
**Expected:** `400` then `400`.

**T3 — logo route requires a session (negative test):**
```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/branding/logo"
```
**Expected:** `307` (middleware redirects to /login — cookie missing). NOT `200`.

**T4 — demo workspace has no logo yet → 404 with a valid session is covered in the
manual UI pass; here verify the seeded demo KYC + onboarding rows exist:**
```bash
docker exec vaani-db psql -U vaani -d vaani -c \
  "SELECT \"kycStatus\" FROM \"TrialState\" LIMIT 1; SELECT \"currentStep\", \"sampleDataEnabled\" FROM \"OnboardingState\" LIMIT 1;"
```
**Expected:** one row each (`VERIFIED`, `3 | t` from the guide-02 seed).

**T5 — unit suites for this guide:**
```bash
npx vitest run tests/onboarding.test.ts tests/sample-data.test.ts tests/branding.test.ts tests/domain-verify.test.ts
```
**Expected:** `Test Files  4 passed (4)`, exit 0.

Stop the dev server when done: `pkill -f "next dev" || true`.

**If T1 returns 307:** the middleware patch (Step 9) is missing — the route is
being redirected to /login; redo the patch exactly.

---

## Step 16: Git checkpoint

```bash
cd /root/vaani-ai
git add -A
git commit -m "phase 10: landing v2, onboarding wizard, in-app guidance, sample data, KYC UI, white-label branding, settings polish"
```

---

## Acceptance Checklist

- [ ] Landing page: hero, 3 steps, 12 features, comparison table (5 rows), 3 pricing tiers, roadmap teaser, CTA, footer
- [ ] Landing + auth + onboarding flawless at mobile width
- [ ] loading.tsx skeleton, error.tsx retry, branded 404
- [ ] Onboarding wizard: 6 steps walk end-to-end on a fresh workspace; progress bar advances; state persists in OnboardingState (reload = resume); a workspace with NOTHING done is redirected to /onboarding from any app page except /settings; started-but-incomplete workspaces get the dashboard widget instead
- [ ] Dashboard: checklist widget shows/hides by state, dismiss persists; sample-data toggle seeds AND clears demo rows (calls visible then gone)
- [ ] KYC page: banner reflects TrialState.kycStatus; upload → MinIO object + KycRecord PENDING + status flips; submissions list
- [ ] Branding page: logo upload shows in sidebar; color picker changes accent color; domain save/verify/remove with DNS instructions; white-label toggle gated by plan + verified domain
- [ ] `/api/domain-ask`: 403 unknown, 400 bad param, public (no redirect)
- [ ] `/api/branding/logo`: 307 logged out
- [ ] Settings: rename, industry, team, audit log + links to branding/KYC
- [ ] Sidebar highlights current page; every app page has a proper tab title; Setup nav item
- [ ] 4 vitest files pass; `npm run typecheck` + `npm run build` exit 0
- [ ] Git commit `phase 10: ...` exists

## FINAL REPORT format

```
STEP 0..16: PASS/FAIL — <one line of evidence each>
WIZARD: fresh-workspace walkthrough OK=YES/NO, steps completed=<list>
SAMPLE DATA: seed OK=YES/NO, clear OK=YES/NO
KYC: upload OK=YES/NO, banner flips=YES/NO
BRANDING: logo=YES/NO, color=YES/NO, domain verify=<not tested on dev DNS|PASS|FAIL>
MOBILE PASS: landing/auth/onboarding OK=YES/NO, app issues=<list or none>
CURL: T1=<code> T2=<codes> T3=<code> T4=OK/FAIL T5=<n passed>
ACCEPTANCE: n/13 checked
NOTES: <deviations>
```
