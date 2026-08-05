import Link from "next/link";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { AGENT_TEMPLATES } from "@/lib/templates";
import { createAgentFromTemplateAction } from "@/server/actions/agents";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "next/navigation";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-yellow-500/10 text-yellow-400",
  PUBLISHED: "bg-green-500/10 text-green-400",
  ARCHIVED: "bg-muted text-muted-foreground",
};

export default async function AgentsPage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const agents = await db.agent.findMany({
    where: { workspaceId: ctx.workspaceId, NOT: { status: "ARCHIVED" } },
    orderBy: { updatedAt: "desc" },
  });

  async function fromTemplate(formData: FormData) {
    "use server";
    const code = String(formData.get("template"));
    const res = await createAgentFromTemplateAction(code);
    if (res.ok && res.id) redirect(`/agents/${res.id}`);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">AI Agents</h1>
        <Button asChild data-testid="agents-new-btn"><Link href="/agents/new">New blank agent</Link></Button>
      </div>

      {agents.length === 0 ? (
        <p className="text-muted-foreground">
          No agents yet. Start from a template below — you can be live in 30 minutes.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => (
            <Link key={a.id} href={`/agents/${a.id}`} data-testid={`agent-card-${a.id}`}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{a.name}</CardTitle>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[a.status]}`}>
                      {a.status}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1 text-sm text-muted-foreground">
                  <p>Voice: {a.voiceId} · Lang: {a.languageMode}</p>
                  <p className="truncate">{a.llmModel}</p>
                  <p>v{a.version}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Template gallery</h2>
          <Link href="/marketplace" className="text-sm text-primary hover:underline">
            Community marketplace →
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {AGENT_TEMPLATES.map((t) => (
            <Card key={t.code} data-testid={`template-card-${t.code}`}>
              <CardHeader>
                <CardTitle className="text-base">{t.name}</CardTitle>
                <p className="text-xs text-primary">{t.industry}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{t.description}</p>
                <form action={fromTemplate}>
                  <input type="hidden" name="template" value={t.code} />
                  <Button variant="outline" size="sm" className="w-full" data-testid={`template-use-${t.code}`}>
                    Use template
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
