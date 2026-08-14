import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { AgentForm } from "../agent-form";
import { VersionsTab } from "./versions-tab";
import { ToolsTab } from "./tools-tab";
import { EditorActions } from "./editor-actions";
import { KnowledgeManager } from "../../knowledge/knowledge-manager";

const TABS = ["general", "voice", "llm", "knowledge", "tools", "versions"] as const;
type Tab = (typeof TABS)[number];

export default async function EditAgentPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string };
}) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const tab: Tab = (TABS as readonly string[]).includes(searchParams.tab ?? "")
    ? (searchParams.tab as Tab)
    : "general";

  const agent = await db.agent.findFirst({
    where: { id: params.id, workspaceId: ctx.workspaceId },
    include: { toolConfigs: true },
  });
  if (!agent) notFound();

  const [versions, docs, agents, customVoices] = await Promise.all([
    tab === "versions"
      ? db.agentVersion.findMany({
          where: { agentId: agent.id, workspaceId: ctx.workspaceId },
          orderBy: { version: "desc" },
        })
      : Promise.resolve([]),
    tab === "knowledge"
      ? db.knowledgeDocument.findMany({
          where: { workspaceId: ctx.workspaceId, OR: [{ agentId: agent.id }, { agentId: null }] },
          orderBy: { createdAt: "desc" },
          include: { agent: { select: { name: true } } },
        })
      : Promise.resolve([]),
    tab === "knowledge"
      ? db.agent.findMany({
          where: { workspaceId: ctx.workspaceId, NOT: { status: "ARCHIVED" } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    db.customVoice.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: { id: true, name: true, status: true },
    }),
  ]);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{agent.name}</h1>
          <p className="text-sm text-muted-foreground">
            status: {agent.status} · v{agent.version}
            {agent.dograhWorkflowId ? ` · Dograh workflow ${agent.dograhWorkflowId}` : ""}
          </p>
        </div>
        <EditorActions
          agentId={agent.id}
          status={agent.status}
          published={Boolean(agent.dograhWorkflowId)}
        />
      </div>

      <nav className="flex flex-wrap gap-2 border-b border-border pb-2">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/agents/${agent.id}?tab=${t}`}
            data-testid={`agent-tab-${t}`}
            className={`rounded-md px-3 py-1.5 text-sm capitalize ${
              tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {t}
          </Link>
        ))}
      </nav>

      {tab === "general" || tab === "voice" || tab === "llm" ? (
        <AgentForm mode="edit" agent={agent} section={tab} customVoices={customVoices} />
      ) : tab === "knowledge" ? (
        <KnowledgeManager docs={docs} agents={agents} fixedAgentId={agent.id} />
      ) : tab === "tools" ? (
        <ToolsTab agentId={agent.id} toolConfigs={agent.toolConfigs} />
      ) : (
        <VersionsTab agentId={agent.id} agentName={agent.name} versions={versions} />
      )}
    </div>
  );
}
