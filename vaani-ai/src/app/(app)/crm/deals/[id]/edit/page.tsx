import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { listPipelines } from "@/lib/crm";
import { DealForm } from "../../deal-form";

export const metadata = { title: "Edit Deal — Vaani AI" };

export default async function EditDealPage({ params }: { params: { id: string } }) {
  const ctx = await requirePermission("deals:write");
  const [deal, pipelines, contacts, users] = await Promise.all([
    db.deal.findFirst({ where: { id: params.id, workspaceId: ctx.workspaceId } }),
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
  if (!deal) notFound();

  return (
    <div className="mx-auto max-w-xl">
      <h2 className="mb-4 text-lg font-semibold">Edit deal</h2>
      <DealForm
        mode="edit"
        dealId={deal.id}
        initial={{
          title: deal.title,
          valuePaise: deal.valuePaise,
          pipelineId: deal.pipelineId,
          stageId: deal.stageId,
          contactId: deal.contactId ?? undefined,
          priority: deal.priority as DealFormPriority,
          expectedClose: deal.expectedClose?.toISOString(),
          ownerUserId: deal.ownerUserId ?? undefined,
        }}
        pipelines={pipelines.map((p) => ({ id: p.id, name: p.name, stages: p.stages }))}
        contacts={contacts}
        users={users.map((m) => m.user)}
      />
    </div>
  );
}

type DealFormPriority = "low" | "medium" | "high" | "urgent";
