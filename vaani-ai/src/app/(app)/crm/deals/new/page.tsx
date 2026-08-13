import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { listPipelines } from "@/lib/crm";
import { DealForm } from "../deal-form";
import { CreatePipelineForm } from "../../create-pipeline-form";

export const metadata = { title: "New Deal — Vaani AI" };

export default async function NewDealPage({
  searchParams,
}: {
  searchParams: { createPipeline?: string };
}) {
  const ctx = await requirePermission("deals:write");
  const canCreatePipeline = hasPermission(ctx.membership, "pipelines:write");

  const [pipelines, contacts, users] = await Promise.all([
    listPipelines(ctx.workspaceId),
    db.contact.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: { id: true, name: true, phone: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.membership.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: { user: { select: { id: true, fullName: true } } },
    }),
  ]);

  if (pipelines.length === 0 && canCreatePipeline) {
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <h2 className="text-lg font-semibold">Create your first pipeline</h2>
        <CreatePipelineForm />
      </div>
    );
  }
  if (pipelines.length === 0) {
    redirect("/crm/pipeline");
  }

  return (
    <div className="mx-auto max-w-xl">
      <h2 className="mb-4 text-lg font-semibold">New deal</h2>
      <DealForm
        mode="create"
        pipelines={pipelines.map((p) => ({ id: p.id, name: p.name, stages: p.stages }))}
        contacts={contacts}
        users={users.map((m) => m.user)}
        createPipeline={searchParams.createPipeline === "1"}
      />
    </div>
  );
}
