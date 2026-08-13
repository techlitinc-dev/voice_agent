"use client";
import Link from "next/link";
import { Draggable } from "@hello-pangea/dnd";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { formatINR } from "@/lib/money";
import { InterestBadge } from "../interest-badge";
import type { PipelineBoardDeal } from "@/lib/crm";

/** Rough "time ago" string for deal cards. */
function timeAgo(date: Date): string {
  const diffMs = Date.now() - new Date(date).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

export function DealCard({
  deal,
  index,
  draggable,
}: {
  deal: PipelineBoardDeal;
  index: number;
  draggable: boolean;
}) {
  const score = deal.contact?.leadScore;
  const scoreColors: Record<string, string> = { A: "bg-green-500", B: "bg-blue-500", C: "bg-amber-500", D: "bg-gray-400" };
  const inner = (
    <>
      <div className="mb-1 flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-medium">{deal.title}</p>
        <InterestBadge attributes={deal.attributes} />
      </div>
      {deal.contact?.name && (
        <p className="mb-2 text-xs text-muted-foreground">{deal.contact.name}</p>
      )}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{formatINR(deal.valuePaise)}</span>
        <div className="flex items-center gap-1.5">
          {score && (
            <span
              title={`Lead score ${score.score}/100 (${score.grade})`}
              className={`flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white ${scoreColors[score.grade] ?? "bg-gray-400"}`}
              data-testid="deal-card-score"
            >
              {score.grade}
            </span>
          )}
          {deal.owner && <Avatar name={deal.owner.fullName} size="sm" />}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{timeAgo(deal.updatedAt)}</span>
        {deal.contact?.phone && <span className="font-mono">{deal.contact.phone}</span>}
      </div>
    </>
  );

  if (!draggable) {
    return (
      <Link href={`/crm/deals/${deal.id}`} className="block">
        <Card className="mb-2 p-3 transition hover:shadow-md">{inner}</Card>
      </Link>
    );
  }

  return (
    <Draggable draggableId={deal.id} index={index}>
      {(provided) => (
        <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
          <Link href={`/crm/deals/${deal.id}`} className="block">
            <Card className="mb-2 cursor-grab p-3 transition hover:shadow-md active:cursor-grabbing">
              {inner}
            </Card>
          </Link>
        </div>
      )}
    </Draggable>
  );
}
