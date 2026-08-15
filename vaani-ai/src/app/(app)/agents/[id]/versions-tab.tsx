"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentVersion } from "@prisma/client";
import { rollbackAgentAction, createAbVariantAction, removeAbVariantAction, pinVersionAction, unpinVersionAction } from "@/server/actions/agents";
import { publishTemplateAction } from "@/server/actions/marketplace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-yellow-500/10 text-yellow-400",
  PUBLISHED: "bg-green-500/10 text-green-400",
  ARCHIVED: "bg-muted text-muted-foreground",
};

export function VersionsTab({
  agentId,
  agentName,
  versions,
  abComparison = null,
  pinnedVersionId = null,
}: {
  agentId: string;
  agentName: string;
  versions: AgentVersion[];
  abComparison?: import("@/lib/ab-test-stats").AbComparison | null;
  pinnedVersionId?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(label); setError(null); setNotice(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return setError(res.error ?? "Failed.");
    setNotice(`${label} done.`);
    router.refresh();
  }

  const published = versions.filter((v) => v.status === "PUBLISHED" && !v.isAbVariant);
  const abVariant = versions.find((v) => v.isAbVariant && v.status === "PUBLISHED");
  const mainLive = published[0];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Version history</CardTitle></CardHeader>
        <CardContent>
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No versions yet — hit &quot;Publish&quot; to freeze v1 and push it to the voice engine.
            </p>
          ) : (
            <table className="w-full text-sm" data-testid="version-history-table">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1">Version</th>
                  <th>Status</th>
                  <th>Traffic</th>
                  <th>Published</th>
                  <th>Dograh wf</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id} className="border-t border-border" data-testid={`version-row-${v.version}`}>
                    <td>
                      v{v.version}
                      {v.isAbVariant ? " (A/B)" : ""}
                      {v.id === pinnedVersionId && (
                        <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary" data-testid="version-pinned-badge">
                          pinned
                        </span>
                      )}
                      {v.label ? <span className="block text-xs text-muted-foreground">{v.label}</span> : null}
                    </td>
                    <td><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[v.status]}`}>{v.status}</span></td>
                    <td>{v.isAbVariant ? `${v.abTrafficPercent ?? 0}%` : v.status === "PUBLISHED" && !abVariant ? "100%" : "—"}</td>
                    <td className="text-xs text-muted-foreground">
                      {v.publishedAt ? new Date(v.publishedAt).toLocaleString("en-IN") : "—"}
                    </td>
                    <td className="text-xs text-muted-foreground">{v.dograhWorkflowId ?? "—"}</td>
                    <td className="text-right">
                      {!v.isAbVariant && v.status !== "PUBLISHED" && (
                        <Button size="sm" variant="outline" disabled={busy !== null}
                          data-testid={`version-rollback-${v.version}`}
                          onClick={() => run(`Rollback to v${v.version}`, () => rollbackAgentAction(agentId, v.id))}>
                          Roll back to this
                        </Button>
                      )}
                      {v.isAbVariant && v.status === "PUBLISHED" && (
                        <Button size="sm" variant="destructive" disabled={busy !== null}
                          data-testid="ab-remove-btn"
                          onClick={() => run("End A/B test", () => removeAbVariantAction(agentId, v.id))}>
                          End A/B test
                        </Button>
                      )}
                      {v.status === "PUBLISHED" && v.id !== pinnedVersionId && (
                        <Button size="sm" variant="outline" disabled={busy !== null}
                          data-testid={`version-pin-${v.version}`}
                          title="Pin: this version serves 100% of calls (overrides A/B split)"
                          onClick={() => run(`Pin v${v.version}`, () => pinVersionAction(agentId, v.id))}>
                          Pin
                        </Button>
                      )}
                      {v.id === pinnedVersionId && (
                        <Button size="sm" variant="outline" disabled={busy !== null}
                          data-testid="version-unpin-btn"
                          onClick={() => run("Unpin", () => unpinVersionAction(agentId))}>
                          Unpin
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
          {notice && <p className="mt-2 text-sm text-green-400">{notice}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">A/B test (two published variants)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {abVariant ? (
            <p className="text-sm text-muted-foreground">
              A/B running: v{abVariant.version} serves {abVariant.abTrafficPercent}% of calls
              (deterministic per caller). Routing happens at call-start — guides 06/07 use
              `resolveAgentForCall()` from `src/lib/ab-test.ts`.
            </p>
          ) : mainLive ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run("Create A/B variant", () => createAbVariantAction(agentId, {
                  fromVersionId: mainLive.id,
                  abTrafficPercent: f.get("pct"),
                  label: f.get("label") || undefined,
                  systemPrompt: f.get("systemPrompt") || undefined,
                  greeting: f.get("greeting") || undefined,
                }));
              }}
              className="space-y-3"
            >
              <p className="text-sm text-muted-foreground">
                Clone the live version (v{mainLive.version}) as a variant with a different
                prompt/greeting. Callers are bucketed deterministically by phone number.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-sm text-muted-foreground">Variant traffic %</span>
                  <Input name="pct" type="number" min={1} max={99} defaultValue={20} required data-testid="ab-traffic-input" />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm text-muted-foreground">Label</span>
                  <Input name="label" placeholder="e.g. shorter greeting" />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">Variant greeting (optional override)</span>
                <textarea name="greeting" rows={2} className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm" />
              </label>
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">Variant system prompt (optional override)</span>
                <textarea name="systemPrompt" rows={5} className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm font-mono" />
              </label>
              <Button size="sm" disabled={busy !== null} data-testid="ab-create-btn">Create A/B variant</Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">Publish a version first — A/B needs a live version to clone.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">A/B results</CardTitle></CardHeader>
        <CardContent>
          {!abComparison || abComparison.versions.filter((v) => v.isAbVariant).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No A/B test running. Create a variant above — once both versions have
              attributed calls you&apos;ll see conversion comparison here.
            </p>
          ) : (
            <div className="space-y-3">
              {abComparison.versions.map((v) => (
                <div
                  key={v.versionId}
                  className={`rounded-md border p-3 ${
                    abComparison.winnerVersionId === v.versionId ? "border-green-500/60 bg-green-500/5" : ""
                  }`}
                  data-testid={`ab-result-${v.versionId}`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">
                      {v.isAbVariant ? `Variant v${v.version}` : `Main v${v.version}`}
                      {v.label ? <span className="ml-2 text-xs text-muted-foreground">{v.label}</span> : null}
                      {v.isAbVariant && <span className="ml-2 text-xs text-muted-foreground">({v.abTrafficPercent}% traffic)</span>}
                    </p>
                    {abComparison.winnerVersionId === v.versionId && (
                      <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400" data-testid="ab-winner-badge">
                        🏆 Winner
                      </span>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div>
                      <p className="font-medium text-foreground">{v.calls}</p>
                      <p>calls</p>
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{Math.round(v.conversionRate * 100)}%</p>
                      <p>conversion</p>
                    </div>
                    <div>
                      <p className="font-medium text-foreground">
                        {v.avgSentiment !== null ? v.avgSentiment.toFixed(2) : "—"}
                      </p>
                      <p>avg sentiment</p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {v.converted}/{v.completed} completed calls with a positive outcome (booked / qualified / payment).
                  </p>
                </div>
              ))}
              {!abComparison.hasWinner && (
                <p className="text-xs text-muted-foreground">
                  Need at least {abComparison.minCalls} attributed calls per version to call a winner.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Publish as marketplace template</CardTitle></CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run("Publish template", () => publishTemplateAction(agentId, {
                name: f.get("tplName"), industry: f.get("tplIndustry"), description: f.get("tplDescription"),
              }));
              (e.target as HTMLFormElement).reset();
            }}
            className="space-y-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Input name="tplName" defaultValue={agentName} required data-testid="marketplace-publish-name" />
              <Input name="tplIndustry" placeholder="Industry (e.g. Healthcare)" required />
            </div>
            <textarea name="tplDescription" rows={2} required placeholder="What does this agent do?"
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm" />
            <Button size="sm" variant="outline" disabled={busy !== null} data-testid="marketplace-publish-btn">
              Publish to marketplace
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
