import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getPipeline, fetchPipelineBoard } from "@/lib/crm";
import { PipelineBoard } from "../pipeline-board";
import { Forecast } from "../forecast";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export const metadata = { title: "Pipeline — Vaani AI" };

export default async function PipelineDetailPage({
  params,
  searchParams,
}: {
  params: { pipelineId: string };
  searchParams: { owner?: string; q?: string };
}) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const canWrite = hasPermission(ctx.membership, "deals:write");

  const pipeline = await getPipeline(ctx.workspaceId, params.pipelineId);
  if (!pipeline) notFound();
  if (params.pipelineId !== pipeline.id) redirect(`/crm/pipeline/${pipeline.id}`);

  const { stages, deals } = await fetchPipelineBoard(ctx.workspaceId, pipeline.id, {
    owner: searchParams.owner,
    ownerUserId: ctx.user.id,
    q: searchParams.q,
  });

  const byStage: Record<string, typeof deals> = {};
  for (const s of stages) byStage[s.id] = [];
  for (const d of deals) (byStage[d.stageId] ??= []).push(d);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">{pipeline.name}</h2>
        <div className="ml-auto flex gap-2">
          <Link href="/crm/pipeline" className="text-sm text-muted-foreground hover:text-foreground">← All pipelines</Link>
          <Link href="/crm/deals/new"><Button size="sm"><Plus className="h-4 w-4" /> Deal</Button></Link>
        </div>
      </div>
      <PipelineBoard stages={stages} deals={deals} canWrite={canWrite} />
      <Forecast stages={stages} dealsByStage={byStage} />
    </div>
  );
}
