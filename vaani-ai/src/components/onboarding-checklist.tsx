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
