import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { WidgetChat } from "./widget-chat";

export const dynamic = "force-dynamic";

/** Public web-chat widget (docs/new-features/04 §3.3). No session auth. */
export default async function WidgetPage({ params }: { params: { slug: string } }) {
  const workspace = await db.workspace.findUnique({
    where: { slug: params.slug.toLowerCase() },
    select: { id: true, name: true },
  });
  if (!workspace) notFound();

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <WidgetChat workspaceSlug={params.slug.toLowerCase()} workspaceName={workspace.name} />
    </div>
  );
}
