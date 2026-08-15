"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  publishAgentAction,
  unpublishAgentAction,
  createTestRunAction,
  advancedEditorUrlAction,
  cloneAgentAction,
  archiveAgentAction,
} from "@/server/actions/agents";
import { Button } from "@/components/ui/button";

export function EditorActions({
  agentId,
  status,
  published,
}: {
  agentId: string;
  status: string;
  published: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string; url?: string }>, openUrl = false, goToVersions = false) {
    setBusy(label); setError(null); setNotice(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return setError(res.error ?? "Failed.");
    setNotice(`${label} done.`);
    if (goToVersions) router.push(`/agents/${agentId}?tab=versions`);
    else if (openUrl && res.url) window.open(res.url, "_blank", "noopener");
    else router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy !== null}
          data-testid="agent-publish-btn"
          onClick={() => run("Publish", () => publishAgentAction(agentId), false, true)}
        >
          {busy === "Publish" ? "Publishing…" : status === "PUBLISHED" ? "Publish new version" : "Publish"}
        </Button>
        {status === "PUBLISHED" && (
          <Button
            size="sm" variant="outline" disabled={busy !== null}
            data-testid="agent-unpublish-btn"
            onClick={() => {
              if (!window.confirm("Unpublish this agent? Its live version goes back to draft and calls stop routing to it.")) return;
              run("Unpublish", () => unpublishAgentAction(agentId));
            }}
          >
            Unpublish
          </Button>
        )}
        <Button
          size="sm" variant="outline" disabled={busy !== null || !published}
          data-testid="agent-test-call-btn"
          title={published ? "Create a Dograh test run and open the browser call" : "Publish first"}
          onClick={() => run("Test run", () => createTestRunAction(agentId), true)}
        >
          Test call (browser)
        </Button>
        <Button
          size="sm" variant="outline" disabled={busy !== null || !published}
          data-testid="agent-advanced-editor-btn"
          title={published ? "Open Dograh's visual flow editor for this workflow" : "Publish first"}
          onClick={() => run("Open editor", () => advancedEditorUrlAction(agentId), true)}
        >
          Advanced flow editor ↗
        </Button>
        <Button
          size="sm" variant="ghost" disabled={busy !== null}
          onClick={() => run("Clone", () => cloneAgentAction(agentId))}
        >
          Clone
        </Button>
        <Button
          size="sm" variant="destructive" disabled={busy !== null}
          data-testid="agent-archive-btn"
          onClick={() => run("Archive", async () => {
            const r = await archiveAgentAction(agentId);
            if (r.ok) router.push("/agents");
            return r;
          })}
        >
          Archive
        </Button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-green-400">{notice}</p>}
    </div>
  );
}
