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
