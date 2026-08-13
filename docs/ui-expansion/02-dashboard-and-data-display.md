# 02 — Dashboard & Data Display Patterns

> **Goal:** Patterns for building dashboards, data tables, and data-dense
> displays using the expanded component library.

---

## 1. StatCard (custom component)

The most-used dashboard component:

```tsx
// src/components/ui/stat-card.tsx
import { Card } from "@/components/ui/card";
import { ArrowUpRight, ArrowDownRight, type LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: LucideIcon;
  trend?: { value: number; positive: boolean; label?: string };
  accent?: "default" | "success" | "warning" | "destructive";
  sparkline?: number[];
}

export function StatCard({ label, value, sub, icon: Icon, trend, accent = "default", sparkline }: StatCardProps) {
  const accentClasses = {
    default: "text-foreground",
    success: "text-green-600",
    warning: "text-amber-600",
    destructive: "text-red-600",
  };

  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className={`text-2xl font-bold mt-1 ${accentClasses[accent]}`}>{value}</p>
        </div>
        {Icon && (
          <div className="p-2 rounded-lg bg-muted">
            <Icon className="w-4 h-4 text-muted-foreground" />
          </div>
        )}
      </div>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      {trend && (
        <div className={`flex items-center gap-1 text-xs mt-1 ${trend.positive ? "text-green-600" : "text-red-600"}`}>
          {trend.positive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          <span>{Math.abs(trend.value)}% {trend.label || "vs previous"}</span>
        </div>
      )}
      {sparkline && <Sparkline data={sparkline} className="mt-2" />}
    </Card>
  );
}
```

Usage:

```tsx
<StatCard label="Calls Today" value={142} icon={Phone} trend={{ value: 12, positive: true }} accent="success" />
<StatCard label="Revenue" value={formatINR(84000)} icon={IndianRupee} trend={{ value: 18, positive: true }} />
<StatCard label="Overdue Tasks" value={3} icon={AlertCircle} accent="destructive" sub="Requires attention" />
```

---

## 2. DataTable (custom component)

A reusable data table built on TanStack Table + shadcn Table:

```bash
npm install @tanstack/react-table
```

```tsx
// src/components/ui/data-table.tsx
"use client";
import { useState } from "react";
import { ColumnDef, flexRender, getCoreRowModel, getSortedRowModel, getFilteredRowModel, getPaginationRowModel, useReactTable, SortingState } from "@tanstack/react-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchKey?: string;
  searchPlaceholder?: string;
  pageSize?: number;
  emptyState?: React.ReactNode;
}

export function DataTable<TData, TValue>({ columns, data, searchKey, searchPlaceholder, pageSize = 10, emptyState }: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    state: { sorting, globalFilter },
    initialState: { pagination: { pageSize } },
  });

  return (
    <div className="space-y-4">
      {searchKey && (
        <Input placeholder={searchPlaceholder || "Search..."} value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)} className="max-w-sm" />
      )}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                  {row.getVisibleCells().map((cell) => <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  {emptyState || "No results."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination table={table} />
    </div>
  );
}
```

### Column definition with sorting

```tsx
// src/app/(app)/calls/columns.tsx
import { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const callColumns: ColumnDef<Call>[] = [
  {
    id: "from",
    accessorKey: "fromNumber",
    header: ({ column }) => <SortButton column={column} label="From" />,
    cell: ({ row }) => <span className="font-mono text-sm">{row.original.fromNumber}</span>,
  },
  {
    id: "direction",
    accessorKey: "direction",
    header: "Direction",
    cell: ({ row }) => <Badge variant={row.original.direction === "INBOUND" ? "secondary" : "outline"}>{row.original.direction}</Badge>,
  },
  {
    id: "duration",
    accessorKey: "durationSec",
    header: ({ column }) => <SortButton column={column} label="Duration" />,
    cell: ({ row }) => formatDuration(row.original.durationSec),
  },
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <CallStatusBadge status={row.original.status} />,
  },
  {
    id: "actions",
    cell: ({ row }) => <CallRowActions call={row.original} />,
  },
];
```

---

## 3. EmptyState (custom component)

```tsx
// src/components/ui/empty-state.tsx
import { type LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; href?: string; onClick?: () => void };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-muted-foreground" />
      </div>
      <h3 className="font-semibold text-lg">{title}</h3>
      {description && <p className="text-sm text-muted-foreground mt-1 max-w-sm">{description}</p>}
      {action && <Button className="mt-4" onClick={action.onClick}>{action.label}</Button>}
    </div>
  );
}
```

Usage:

```tsx
{calls.length === 0 ? (
  <EmptyState icon={PhoneOff} title="No calls yet" description="Make your first call to see it here." action={{ label: "Create Agent", href: "/agents/new" }} />
) : (
  <DataTable columns={columns} data={calls} />
)}
```

---

## 4. Skeleton Loading

Match the shape of the actual content:

```tsx
// During loading
<div className="grid grid-cols-4 gap-4">
  {Array.from({ length: 4 }).map((_, i) => (
    <Card key={i} className="p-4">
      <Skeleton className="h-4 w-24 mb-2" />
      <Skeleton className="h-8 w-32 mb-1" />
      <Skeleton className="h-3 w-20" />
    </Card>
  ))}
</div>
```

For server components, use `loading.tsx`:

```tsx
// src/app/(app)/dashboard/loading.tsx
export default function Loading() {
  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="p-4 space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-3 w-20" />
          </Card>
        ))}
      </div>
      <Card className="p-6"><Skeleton className="h-64 w-full" /></Card>
    </div>
  );
}
```

---

## 5. Badge Patterns

Consistent status badges across the app:

```tsx
// src/components/ui/status-badges.tsx
export function CallStatusBadge({ status }: { status: CallStatus }) {
  const map: Record<CallStatus, { variant: string; className?: string }> = {
    RINGING:      { variant: "secondary", className: "bg-blue-100 text-blue-800" },
    IN_PROGRESS:  { variant: "secondary", className: "bg-purple-100 text-purple-800 animate-pulse" },
    COMPLETED:    { variant: "secondary", className: "bg-green-100 text-green-800" },
    FAILED:       { variant: "destructive" },
    NO_ANSWER:    { variant: "secondary", className: "bg-gray-100 text-gray-600" },
    BUSY:         { variant: "secondary", className: "bg-amber-100 text-amber-800" },
    VOICEMAIL:    { variant: "secondary", className: "bg-cyan-100 text-cyan-800" },
  };
  return <Badge className={map[status].className}>{status.replace("_", " ").toLowerCase()}</Badge>;
}

export function InterestBadge({ score }: { score: InterestScore }) {
  const map = {
    HOT:  { icon: Flame, className: "bg-red-100 text-red-700" },
    WARM: { icon: Zap, className: "bg-amber-100 text-amber-700" },
    COLD: { icon: Snowflake, className: "bg-blue-100 text-blue-700" },
  };
  const { icon: Icon, className } = map[score];
  return <Badge className={className}><Icon className="w-3 h-3 mr-1" />{score}</Badge>;
}

export function DealStatusBadge({ status }: { status: DealStatus }) {
  const map = {
    OPEN:   "bg-blue-100 text-blue-800",
    WON:    "bg-green-100 text-green-800",
    LOST:   "bg-red-100 text-red-800",
  };
  return <Badge className={map[status]}>{status}</Badge>;
}
```

---

## 6. Sparkline

Mini chart for stat cards:

```tsx
// src/components/ui/sparkline.tsx
export function Sparkline({ data, className }: { data: number[]; className?: string }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 100 - ((v - min) / range) * 100;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={`h-8 w-full ${className}`}>
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={points} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
```

---

## Next

→ [03 — Forms & Input Patterns](03-forms-and-inputs.md)