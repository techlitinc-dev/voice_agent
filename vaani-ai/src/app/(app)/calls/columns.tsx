"use client";

import type { Column, ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CallStatusBadge } from "@/components/ui/status-badges";
import { formatINR } from "@/lib/money";

/** Call row shape as loaded by the calls page (matches prisma include). */
export type CallRow = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  status: string;
  fromNumber: string;
  toNumber: string;
  agent?: { name: string } | null;
  createdAt: Date;
  durationSec: number;
  outcome: string | null;
  billedPaise: number;
  scriptAdherenceScore: number | null;
  summary: string | null;
};

function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function SortButton<TData, TValue>({ column, label }: { column: Column<TData, TValue>; label: string }) {
  return (
    <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={column.getToggleSortingHandler()}>
      {label}
      <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
    </Button>
  );
}

export const callColumns: ColumnDef<CallRow>[] = [
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: ({ column }) => <SortButton column={column} label="When" />,
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-muted-foreground">
        {row.original.createdAt.toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
      </span>
    ),
  },
  {
    id: "direction",
    accessorKey: "direction",
    header: "Dir",
    cell: ({ row }) => <span>{row.original.direction === "INBOUND" ? "↙" : "↗"}</span>,
  },
  {
    id: "numbers",
    accessorKey: "fromNumber",
    header: "From → To",
    cell: ({ row }) => (
      <Link href={`/calls/${row.original.id}`} className="font-mono text-xs hover:text-primary hover:underline">
        {row.original.fromNumber} → {row.original.toNumber}
      </Link>
    ),
  },
  {
    id: "agent",
    accessorKey: "agent",
    header: "Agent",
    cell: ({ row }) => <span>{row.original.agent?.name ?? "—"}</span>,
  },
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <CallStatusBadge status={row.original.status} />,
  },
  {
    id: "durationSec",
    accessorKey: "durationSec",
    header: ({ column }) => <SortButton column={column} label="Duration" />,
    cell: ({ row }) => <span>{fmtDur(row.original.durationSec)}</span>,
  },
  {
    id: "outcome",
    accessorKey: "outcome",
    header: "Outcome",
    cell: ({ row }) => <span>{row.original.outcome ?? "—"}</span>,
  },
  {
    id: "billedPaise",
    accessorKey: "billedPaise",
    header: ({ column }) => <SortButton column={column} label="Billed" />,
    cell: ({ row }) => <span>{row.original.billedPaise > 0 ? formatINR(row.original.billedPaise) : "—"}</span>,
  },
  {
    id: "qa",
    accessorKey: "scriptAdherenceScore",
    header: "QA",
    cell: ({ row }) => {
      const score = row.original.scriptAdherenceScore;
      if (score === null) return <span>—</span>;
      return (
        <span
          data-testid={`call-qa-score-${row.original.id}`}
          className={`rounded-full border px-2 py-0.5 text-xs ${score >= 70 ? "text-green-400" : "text-orange-400"}`}
        >
          {score}
        </span>
      );
    },
  },
  {
    id: "summary",
    accessorKey: "summary",
    header: "Summary",
    cell: ({ row }) => (
      <span className="max-w-64 truncate text-muted-foreground">{row.original.summary ?? "—"}</span>
    ),
  },
];
