import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { installTemplateAction, unpublishTemplateAction } from "@/server/actions/marketplace";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function MarketplacePage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const templates = await db.marketplaceTemplate.findMany({
    where: { published: true },
    orderBy: [{ installs: "desc" }, { createdAt: "desc" }],
    include: { authorWorkspace: { select: { name: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Template marketplace</h1>
        <p className="text-sm text-muted-foreground">
          Community agent templates from all Vaani workspaces. Install → edit → publish.
        </p>
      </div>
      {templates.length === 0 ? (
        <p className="text-muted-foreground">No published templates yet — publish one of your agents from its editor page.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => {
            const mine = t.authorWorkspaceId === ctx.workspaceId;
            return (
              <Card key={t.id} data-testid={`marketplace-card-${t.id}`}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{t.name}</CardTitle>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                      {t.installs} installs
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t.industry} · by {mine ? "your workspace" : t.authorWorkspace.name}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">{t.description}</p>
                  {mine ? (
                    <form
                      action={async () => {
                        "use server";
                        await unpublishTemplateAction(t.id);
                      }}
                    >
                      <Button variant="outline" size="sm" className="w-full" data-testid={`marketplace-unpublish-${t.id}`}>
                        Unpublish (yours)
                      </Button>
                    </form>
                  ) : (
                    <form
                      action={async () => {
                        "use server";
                        const res = await installTemplateAction(t.id);
                        if (res.ok && res.id) redirect(`/agents/${res.id}`);
                      }}
                    >
                      <Button size="sm" className="w-full" data-testid={`marketplace-install-${t.id}`}>
                        Install template
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
