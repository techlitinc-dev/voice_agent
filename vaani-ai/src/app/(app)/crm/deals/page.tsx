import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { fetchDeals } from "@/lib/crm";
import { formatINR } from "@/lib/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { DealStatusBadge } from "@/components/ui/status-badges";
import { DealRowActions } from "./deal-row-actions";
import { Plus, Target } from "lucide-react";

export const metadata = { title: "Deals — Vaani AI" };

const PRIORITY_VARIANT = { low: "secondary", medium: "info", high: "warning", urgent: "danger" } as const;

export default async function DealsPage({
  searchParams,
}: {
  searchParams: {
    pipeline?: string;
    stage?: string;
    status?: string;
    owner?: string;
    q?: string;
    page?: string;
  };
}) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const canDelete = hasPermission(ctx.membership, "deals:delete");

  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  const take = 50;
  const { deals, total } = await fetchDeals(ctx.workspaceId, {
    pipelineId: searchParams.pipeline,
    stageId: searchParams.stage,
    status: searchParams.status,
    owner: searchParams.owner,
    ownerUserId: ctx.user.id,
    q: searchParams.q,
    take,
    skip: (page - 1) * take,
  });

  const [pipelines, stages] = await Promise.all([
    db.pipeline.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { stages: { orderBy: { order: "asc" }, select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    }),
    db.stage.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { order: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / take));

  return (
    <div className="space-y-6" data-testid="deals-page">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{total} deals</h2>
        <Link href="/crm/deals/new"><Button size="sm" data-testid="new-deal-button"><Plus className="h-4 w-4" /> New deal</Button></Link>
      </div>

      <form className="flex flex-wrap items-center gap-3">
        <Select name="pipeline" defaultValue={searchParams.pipeline ?? ""} className="w-44">
          <option value="">Pipeline: All</option>
          {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select name="stage" defaultValue={searchParams.stage ?? ""} className="w-40">
          <option value="">Stage: All</option>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Select name="status" defaultValue={searchParams.status ?? ""} className="w-36">
          <option value="">Status: All</option>
          <option value="OPEN">Open</option>
          <option value="WON">Won</option>
          <option value="LOST">Lost</option>
        </Select>
        <Select name="owner" defaultValue={searchParams.owner ?? ""} className="w-36">
          <option value="">Owner: Anyone</option>
          <option value="me">Owner: Me</option>
        </Select>
        <Input name="q" defaultValue={searchParams.q ?? ""} placeholder="Search…" className="w-40" />
        <Button type="submit" variant="outline" size="sm">Apply</Button>
      </form>

      {deals.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No deals match the current filters"
          description="Adjust the filters above, or create a new deal to start tracking revenue in your pipeline."
          action={{ label: "New deal", href: "/crm/deals/new" }}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table data-testid="deals-table">
            <TableHeader>
              <TableRow className="text-left text-muted-foreground">
                <TableHead>Title</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Expected close</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deals.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">
                    <Link href={`/crm/deals/${d.id}`} className="hover:text-primary">{d.title}</Link>
                  </TableCell>
                  <TableCell>
                    {d.contact ? (
                      <Link href={`/contacts?q=${encodeURIComponent(d.contact.phone ?? "")}`} className="hover:text-primary">
                        {d.contact.name ?? d.contact.phone}
                      </Link>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-semibold">{formatINR(d.valuePaise)}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: d.stage.color ?? "#94a3b8" }} />
                      {d.stage.name}
                    </span>
                  </TableCell>
                  <TableCell><DealStatusBadge status={d.status} /></TableCell>
                  <TableCell><Badge variant={PRIORITY_VARIANT[d.priority as keyof typeof PRIORITY_VARIANT] ?? "secondary"}>{d.priority}</Badge></TableCell>
                  <TableCell>{d.owner?.fullName ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{d.expectedClose ? d.expectedClose.toLocaleDateString("en-IN") : "—"}</TableCell>
                  <TableCell className="text-right">
                    <DealRowActions deal={{ id: d.id, title: d.title }} canDelete={canDelete} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <Link
            href={`/crm/deals?${new URLSearchParams({ ...(searchParams as Record<string, string>), page: String(Math.max(1, page - 1)) }).toString()}`}
            className={`text-sm ${page <= 1 ? "pointer-events-none opacity-40" : "hover:text-primary"}`}
          >
            ← Prev
          </Link>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Link
            href={`/crm/deals?${new URLSearchParams({ ...(searchParams as Record<string, string>), page: String(Math.min(totalPages, page + 1)) }).toString()}`}
            className={`text-sm ${page >= totalPages ? "pointer-events-none opacity-40" : "hover:text-primary"}`}
          >
            Next →
          </Link>
        </div>
      )}
    </div>
  );
}
