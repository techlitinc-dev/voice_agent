import { redirect } from "next/navigation";
import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { listPipelines, fetchPipelineBoard } from "@/lib/crm";
import { PipelineBoard } from "./pipeline-board";
import { Forecast } from "./forecast";
import { CreatePipelineForm } from "../create-pipeline-form";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Plus, Workflow } from "lucide-react";

export const metadata = { title: "Pipeline — Vaani AI" };

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: {
    pipeline?: string;
    owner?: string;
    priority?: string;
    interest?: string;
    q?: string;
  };
}) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const canWrite = hasPermission(ctx.membership, "deals:write");
  const canCreatePipeline = hasPermission(ctx.membership, "pipelines:write");

  const pipelines = await listPipelines(ctx.workspaceId);
  if (pipelines.length === 0) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <EmptyState
          icon={Workflow}
          title="No pipeline yet"
          description="Create one to start tracking deals through stages."
        />
        {canCreatePipeline && <CreatePipelineForm />}
      </div>
    );
  }

  const activePipelineId = searchParams.pipeline ?? pipelines.find((p) => p.isDefault)?.id ?? pipelines[0]!.id;
  const priority = searchParams.priority?.split(",").filter(Boolean) ?? [];
  const interest = searchParams.interest?.split(",").filter(Boolean) ?? [];

  const { stages, deals } = await fetchPipelineBoard(ctx.workspaceId, activePipelineId, {
    owner: searchParams.owner,
    ownerUserId: ctx.user.id,
    priority,
    interest,
    q: searchParams.q,
  });

  const byStage: Record<string, typeof deals> = {};
  for (const s of stages) byStage[s.id] = [];
  for (const d of deals) (byStage[d.stageId] ??= []).push(d);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <form className="flex flex-wrap items-center gap-3">
          <Select name="pipeline" defaultValue={activePipelineId} className="w-44" data-testid="pipeline-select">
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.isDefault ? " (default)" : ""}</option>
            ))}
          </Select>
          <Select name="owner" defaultValue={searchParams.owner ?? ""} className="w-36">
            <option value="">Owner: Anyone</option>
            <option value="me">Owner: Me</option>
          </Select>
          <Select name="priority" defaultValue={searchParams.priority ?? ""} className="w-36">
            <option value="">Priority: Any</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="urgent">urgent</option>
          </Select>
          <Select name="interest" defaultValue={searchParams.interest ?? ""} className="w-36">
            <option value="">Interest: Any</option>
            <option value="HOT">HOT</option>
            <option value="WARM">WARM</option>
            <option value="COLD">COLD</option>
          </Select>
          <Input name="q" defaultValue={searchParams.q ?? ""} placeholder="Search…" className="w-40" />
          <Button type="submit" variant="outline" size="sm">Apply</Button>
        </form>
        <div className="ml-auto flex gap-2">
          <Link href="/crm/deals/new"><Button size="sm" data-testid="new-deal-button"><Plus className="h-4 w-4" /> Deal</Button></Link>
        </div>
      </div>

      {stages.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="This pipeline has no stages"
          description="Add stages like New, Qualified, Proposal, and Won to start moving deals forward."
        />
      ) : (
        <PipelineBoard stages={stages} deals={deals} canWrite={canWrite} />
      )}

      <Forecast stages={stages} dealsByStage={byStage} />
    </div>
  );
}
