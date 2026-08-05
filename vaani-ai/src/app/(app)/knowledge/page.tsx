import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { KnowledgeManager } from "./knowledge-manager";

export default async function KnowledgePage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const docs = await db.knowledgeDocument.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
    include: { agent: { select: { name: true } } },
  });
  const agents = await db.agent.findMany({
    where: { workspaceId: ctx.workspaceId, NOT: { status: "ARCHIVED" } },
    select: { id: true, name: true },
  });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Knowledge base</h1>
        <p className="text-sm text-muted-foreground">
          Documents your agents answer from. Documents with an agent are scoped to it;
          the rest are shared by all agents in this workspace.
        </p>
      </div>
      <KnowledgeManager docs={docs} agents={agents} />
    </div>
  );
}
