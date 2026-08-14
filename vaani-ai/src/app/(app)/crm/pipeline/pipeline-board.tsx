"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DragDropContext, Droppable, DropResult } from "@hello-pangea/dnd";
import { Badge } from "@/components/ui/badge";
import { formatINR } from "@/lib/money";
import { DealCard } from "./deal-card";
import { updateDealStageAction } from "@/server/actions/crm";
import type { PipelineBoardDeal } from "@/lib/crm";

type Stage = { id: string; name: string; color: string | null; order: number };

export function PipelineBoard({
  stages,
  deals,
  canWrite,
}: {
  stages: Stage[];
  deals: PipelineBoardDeal[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [byStage, setByStage] = useState<Record<string, PipelineBoardDeal[]>>(() => {
    const map: Record<string, PipelineBoardDeal[]> = {};
    for (const s of stages) map[s.id] = [];
    for (const d of deals) {
      const list = map[d.stageId] ?? [];
      list.push(d);
      map[d.stageId] = list;
    }
    return map;
  });

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onDragEnd(result: DropResult) {
    const { source, destination, draggableId } = result;
    if (!destination || source.droppableId === destination.droppableId) return;
    if (!canWrite) return;

    const fromStage = source.droppableId;
    const toStage = destination.droppableId;

    // Optimistic move.
    const src = [...(byStage[fromStage] ?? [])];
    const deal = src.find((d) => d.id === draggableId);
    if (!deal) return;
    const nextSrc = src.filter((d) => d.id !== draggableId);
    const nextDst = [...(byStage[toStage] ?? [])];
    nextDst.splice(destination.index, 0, { ...deal, stageId: toStage });
    setByStage({ ...byStage, [fromStage]: nextSrc, [toStage]: nextDst });

    const res = await updateDealStageAction(draggableId, toStage);
    if (!res.ok) {
      // Revert.
      setByStage({
        ...byStage,
        [fromStage]: [...src, ...nextSrc.filter((d) => d.id !== draggableId)],
        [toStage]: nextDst.filter((d) => d.id !== draggableId),
      });
      setError(res.error ?? "Move failed.");
      setNotice(null);
    } else if (res.pendingApproval) {
      // Approval Workflows: the move needs manager sign-off — put the card back
      // in its original stage and tell the user it's pending.
      setByStage({
        ...byStage,
        [fromStage]: [...src, ...nextSrc.filter((d) => d.id !== draggableId)],
        [toStage]: nextDst.filter((d) => d.id !== draggableId),
      });
      setError(null);
      setNotice("Approval requested — a manager must approve the move before it completes.");
      router.refresh();
    } else {
      setError(null);
      setNotice(null);
      router.refresh();
    }
  }

  return (
    <div>
      {error && <p className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {notice && <p className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800">{notice}</p>}
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4" data-testid="pipeline-board">
          {stages.map((stage) => {
            const stageDeals = byStage[stage.id] ?? [];
            const total = stageDeals.reduce((s, d) => s + d.valuePaise, 0);
            return (
              <Droppable droppableId={stage.id} key={stage.id}>
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    data-testid={`stage-${stage.name.toLowerCase()}`}
                    className="w-72 flex-shrink-0 rounded-lg bg-muted/40 p-3"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="flex items-center gap-2 text-sm font-medium">
                        <span className="h-2 w-2 rounded-full" style={{ background: stage.color ?? "#94a3b8" }} />
                        {stage.name}
                      </h3>
                      <Badge variant="secondary">{stageDeals.length}</Badge>
                    </div>
                    <div className="mb-3 text-xs text-muted-foreground">{formatINR(total)}</div>
                    <div className="min-h-[80px]">
                      {stageDeals.map((deal, i) => (
                        <DealCard key={deal.id} deal={deal} index={i} draggable={canWrite} />
                      ))}
                      {provided.placeholder}
                    </div>
                  </div>
                )}
              </Droppable>
            );
          })}
        </div>
      </DragDropContext>
    </div>
  );
}
