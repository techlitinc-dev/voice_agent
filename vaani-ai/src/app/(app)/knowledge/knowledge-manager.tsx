"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Agent, KnowledgeDocument } from "@prisma/client";
import {
  uploadKbDocumentAction,
  addFaqDocumentAction,
  addUrlDocumentAction,
  reindexDocumentAction,
  markDocIndexedAction,
  deleteKbDocumentAction,
} from "@/server/actions/knowledge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dropzone } from "@/components/ui/dropzone";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-yellow-500/10 text-yellow-400",
  INDEXING: "bg-blue-500/10 text-blue-400",
  INDEXED: "bg-green-500/10 text-green-400",
  FAILED: "bg-red-500/10 text-red-400",
};

type DocRow = KnowledgeDocument & { agent: { name: string } | null };

export function KnowledgeManager({
  docs,
  agents,
  fixedAgentId,
}: {
  docs: DocRow[];
  agents: Pick<Agent, "id" | "name">[];
  fixedAgentId?: string; // when rendered on an agent page, scope uploads to it
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(label); setError(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) setError(res.error ?? "Failed.");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Upload PDF / DOCX</CardTitle></CardHeader>
          <CardContent>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!file) return;
                const f = new FormData();
                f.set("file", file);
                f.set("title", (new FormData(e.currentTarget).get("title") as string) || file.name);
                if (fixedAgentId) f.set("agentId", fixedAgentId);
                await run("upload", () => uploadKbDocumentAction(f));
                (e.target as HTMLFormElement).reset();
                setFile(null);
              }}
              className="space-y-3"
            >
              <Input name="title" placeholder="Title (e.g. Price list 2025)" required />
              <Dropzone
                onUpload={setFile}
                accept={{ "application/pdf": [".pdf"], "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"] }}
                hint={file ? file.name : "PDF, DOCX up to 10 MB"}
              />
              {!fixedAgentId && (
                <select name="agentId" className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
                  <option value="">Shared (all agents)</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
              <Button type="submit" size="sm" disabled={busy !== null || !file} data-testid="kb-upload-btn">
                {busy === "upload" ? "Uploading…" : "Upload"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Paste FAQ text</CardTitle></CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run("faq", () => addFaqDocumentAction({
                  title: f.get("title"),
                  contentText: f.get("contentText"),
                  agentId: fixedAgentId ?? (f.get("agentId") || undefined),
                  reindexIntervalHours: f.get("hours") || undefined,
                }));
                (e.target as HTMLFormElement).reset();
              }}
              className="space-y-3"
            >
              <Input name="title" placeholder="Title (e.g. Clinic FAQ)" required />
              <textarea name="contentText" required rows={4} placeholder="Q: …&#10;A: …"
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm" />
              <Input name="hours" type="number" placeholder="Re-index every N hours (optional)" min={1} max={720} />
              {!fixedAgentId && (
                <select name="agentId" className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
                  <option value="">Shared (all agents)</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
              <Button type="submit" size="sm" disabled={busy !== null} data-testid="kb-faq-btn">Add FAQ</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Add a URL</CardTitle></CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run("url", () => addUrlDocumentAction({
                  title: f.get("title"),
                  sourceUrl: f.get("sourceUrl"),
                  agentId: fixedAgentId ?? (f.get("agentId") || undefined),
                  reindexIntervalHours: f.get("hours") || undefined,
                }));
                (e.target as HTMLFormElement).reset();
              }}
              className="space-y-3"
            >
              <Input name="title" placeholder="Title (e.g. Pricing page)" required />
              <Input name="sourceUrl" type="url" placeholder="https://…" required />
              <Input name="hours" type="number" placeholder="Re-index every N hours (default 24)" min={1} max={720} />
              {!fixedAgentId && (
                <select name="agentId" className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm">
                  <option value="">Shared (all agents)</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
              <Button type="submit" size="sm" disabled={busy !== null} data-testid="kb-url-btn">Fetch & add</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Card>
        <CardHeader><CardTitle className="text-base">Documents ({docs.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {docs.length === 0 && <p className="text-sm text-muted-foreground">No documents yet.</p>}
          {docs.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              data-testid={`kb-doc-${d.id}`}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{d.title}</p>
                <p className="text-xs text-muted-foreground">
                  {d.type} · {d.agent ? `agent: ${d.agent.name}` : "shared"} ·{" "}
                  {d.reindexIntervalHours ? `re-index every ${d.reindexIntervalHours}h` : "no schedule"}
                  {d.error ? ` · error: ${d.error.slice(0, 80)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[d.status]}`} data-testid={`kb-status-${d.id}`}>
                  {d.status}
                </span>
                {d.type === "URL" && (
                  <Button variant="ghost" size="sm" disabled={busy !== null}
                    data-testid={`kb-reindex-${d.id}`}
                    onClick={() => run("reindex", () => reindexDocumentAction(d.id))}>
                    Re-index
                  </Button>
                )}
                {d.status !== "INDEXED" && (
                  <Button variant="ghost" size="sm" disabled={busy !== null}
                    data-testid={`kb-mark-indexed-${d.id}`}
                    onClick={() => run("mark", () => markDocIndexedAction(d.id))}>
                    Mark indexed
                  </Button>
                )}
                <Button variant="destructive" size="sm" disabled={busy !== null}
                  onClick={() => run("delete", () => deleteKbDocumentAction(d.id))}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        PDF/DOCX: after uploading here, sync the same file into the agent&apos;s Knowledge
        Base in the Dograh UI (advanced flow editor link on the agent page), then click
        &quot;Mark indexed&quot; — OPERATOR GATE (guide 05 Step 10). FAQ/URL text is fetched and
        stored automatically.
      </p>
    </div>
  );
}
