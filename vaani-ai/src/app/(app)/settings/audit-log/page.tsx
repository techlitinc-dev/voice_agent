import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: { action?: string; entity?: string };
}) {
  let ctx;
  try {
    ctx = await requirePermission("audit:read");
  } catch {
    return (
      <p data-testid="audit-forbidden" className="text-sm text-red-400">
        You do not have permission to view the audit log.
      </p>
    );
  }

  const actionFilter = (searchParams.action ?? "").trim();
  const entityFilter = (searchParams.entity ?? "").trim();

  const logs = await db.auditLog.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...(actionFilter ? { action: { contains: actionFilter, mode: "insensitive" } } : {}),
      ...(entityFilter ? { entity: { contains: entityFilter, mode: "insensitive" } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const userIds = [...new Set(logs.map((l) => l.userId).filter((x): x is string => !!x))];
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true },
  });
  const emailById = new Map(users.map((u) => [u.id, u.email]));

  return (
    <Card>
      <CardHeader><CardTitle>Audit log (latest 100)</CardTitle></CardHeader>
      <CardContent>
        <form data-testid="audit-filter-form" method="get" className="mb-4 flex flex-wrap items-end gap-2">
          <Input
            data-testid="audit-filter-action"
            name="action"
            placeholder="Filter by action (e.g. auth.login)"
            defaultValue={actionFilter}
            className="w-64"
          />
          <Input
            data-testid="audit-filter-entity"
            name="entity"
            placeholder="Filter by entity (e.g. ApiKey)"
            defaultValue={entityFilter}
            className="w-56"
          />
          <Button data-testid="audit-filter-submit" type="submit" variant="outline" size="sm">
            Apply
          </Button>
        </form>
        <table data-testid="audit-table" className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4">Time (UTC)</th>
              <th className="py-2 pr-4">User</th>
              <th className="py-2 pr-4">Action</th>
              <th className="py-2 pr-4">Entity</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} data-testid="audit-row" className="border-b">
                <td className="py-2 pr-4 text-muted-foreground">
                  {l.createdAt.toISOString().slice(0, 19).replace("T", " ")}
                </td>
                <td className="py-2 pr-4">{l.userId ? emailById.get(l.userId) ?? l.userId : "system"}</td>
                <td className="py-2 pr-4 font-mono text-xs">{l.action}</td>
                <td className="py-2 pr-4 text-muted-foreground">
                  {l.entity}
                  {l.entityId ? ` ${l.entityId.slice(0, 8)}…` : ""}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={4} className="py-4 text-center text-muted-foreground">No entries.</td></tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
