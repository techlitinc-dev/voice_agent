import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole, requireWorkspace } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const metadata = { title: "Settings — Vaani AI" };

export default async function SettingsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const [workspace, members, auditLogs] = await Promise.all([
    db.workspace.findUnique({ where: { id: ctx.workspaceId } }),
    db.membership.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { user: { select: { email: true, fullName: true } } },
    }),
    db.auditLog.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  async function renameWorkspace(formData: FormData) {
    "use server";
    const ctx = await requireRole("ADMIN");
    const name = String(formData.get("name") ?? "").trim();
    if (name.length < 2) return;
    await db.workspace.update({ where: { id: ctx.workspaceId }, data: { name } });
    await audit({
      workspaceId: ctx.workspaceId, userId: ctx.user.id,
      action: "workspace.rename", entity: "Workspace", entityId: ctx.workspaceId,
      metadata: { name },
    });
    revalidatePath("/settings");
  }

  async function setIndustry(formData: FormData) {
    "use server";
    const ctx = await requireRole("ADMIN");
    const industry = String(formData.get("industry") ?? "").trim() || null;
    await db.workspace.update({ where: { id: ctx.workspaceId }, data: { industry } });
    revalidatePath("/settings");
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader><CardTitle>Workspace</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <form action={renameWorkspace} className="flex gap-2">
            <Input name="name" defaultValue={workspace?.name} className="max-w-xs" data-testid="settings-name-input" />
            <Button type="submit" variant="outline" data-testid="settings-rename-btn">Rename</Button>
          </form>
          <form action={setIndustry} className="flex gap-2">
            <select name="industry" defaultValue={workspace?.industry ?? ""}
              data-testid="settings-industry-select"
              className="h-9 rounded-md border border-border bg-card px-3 text-sm">
              <option value="">— industry —</option>
              {["healthcare", "real-estate", "education", "bfsi", "e-commerce", "logistics", "salon-spa", "hospitality", "recruitment", "d2c", "agency"].map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
            <Button type="submit" variant="outline" data-testid="settings-industry-save">Save</Button>
          </form>
          <p className="text-xs text-muted-foreground">Workspace slug: {workspace?.slug}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Workspace setup</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <Link href="/settings/branding" className="text-primary hover:underline" data-testid="settings-branding-link">
              White-label branding →
            </Link>{" "}
            <span className="text-muted-foreground">logo, brand color, custom domain (yourbrand.com).</span>
          </p>
          <p>
            <Link href="/settings/kyc" className="text-primary hover:underline" data-testid="settings-kyc-link">
              India KYC →
            </Link>{" "}
            <span className="text-muted-foreground">required before buying regulated 140/1600-series numbers.</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Team</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {members.map((m) => (
            <div key={m.id} className="flex items-center justify-between border-b pb-2 text-sm last:border-0">
              <span>{m.user.fullName} <span className="text-muted-foreground">({m.user.email})</span></span>
              <span className="rounded-full border px-2 py-0.5 text-xs">{m.role}</span>
            </div>
          ))}
          <p className="pt-2 text-xs text-muted-foreground">
            Inviting teammates ships in v2 — today the workspace owner manages everything.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Audit log (latest 30)</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs">
          {auditLogs.map((a) => (
            <p key={a.id} className="flex justify-between gap-4 border-b pb-1 last:border-0">
              <span><span className="text-primary">{a.action}</span> · {a.entity}</span>
              <span className="text-muted-foreground whitespace-nowrap">
                {a.createdAt.toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
              </span>
            </p>
          ))}
          {auditLogs.length === 0 && <p className="text-muted-foreground">No activity yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
