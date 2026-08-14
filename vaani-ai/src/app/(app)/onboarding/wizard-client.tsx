"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PhoneInput } from "@/components/ui/phone-input";
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
                    <PhoneInput
                      value={numberInput}
                      onChange={setNumberInput}
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
