import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { fetchDeals } from "@/lib/crm";
import { formatINR } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";

export const metadata = { title: "Deals — Vaani AI" };

const STATUS_VARIANT = { OPEN: "info", WON: "success", LOST: "danger" } as const;
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

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm" data-testid="deals-table">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="p-3">Title</th>
              <th className="p-3">Contact</th>
              <th className="p-3 text-right">Value</th>
              <th className="p-3">Stage</th>
              <th className="p-3">Status</th>
              <th className="p-3">Priority</th>
              <th className="p-3">Owner</th>
              <th className="p-3">Expected close</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {deals.map((d) => (
              <tr key={d.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="p-3 font-medium">
                  <Link href={`/crm/deals/${d.id}`} className="hover:text-primary">{d.title}</Link>
                </td>
                <td className="p-3">
                  {d.contact ? (
                    <Link href={`/contacts?q=${encodeURIComponent(d.contact.phone ?? "")}`} className="hover:text-primary">
                      {d.contact.name ?? d.contact.phone}
                    </Link>
                  ) : "—"}
                </td>
                <td className="p-3 text-right font-semibold">{formatINR(d.valuePaise)}</td>
                <td className="p-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: d.stage.color ?? "#94a3b8" }} />
                    {d.stage.name}
                  </span>
                </td>
                <td className="p-3"><Badge variant={STATUS_VARIANT[d.status]}>{d.status}</Badge></td>
                <td className="p-3"><Badge variant={PRIORITY_VARIANT[d.priority as keyof typeof PRIORITY_VARIANT] ?? "secondary"}>{d.priority}</Badge></td>
                <td className="p-3">{d.owner?.fullName ?? "—"}</td>
                <td className="p-3 text-muted-foreground">{d.expectedClose ? d.expectedClose.toLocaleDateString("en-IN") : "—"}</td>
                <td className="p-3">
                  <Link href={`/crm/deals/${d.id}`} className="text-primary hover:underline">View</Link>
                </td>
              </tr>
            ))}
            {deals.length === 0 && (
              <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No deals match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

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
