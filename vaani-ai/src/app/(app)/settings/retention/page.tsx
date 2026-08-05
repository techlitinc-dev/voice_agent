import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { saveRetentionPolicy } from "@/server/actions/retention";

export const dynamic = "force-dynamic";

async function savePolicy(formData: FormData) {
  "use server";
  await saveRetentionPolicy(formData);
}

export default async function RetentionSettingsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const policy = await db.retentionPolicy.findUnique({ where: { workspaceId: ctx.workspaceId } });

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Data retention</h1>
      <p className="text-sm text-muted-foreground">
        Auto-delete call recordings and transcripts older than N days (GDPR/DPDP-style
        data-minimization, spec §11). The nightly job runs at 03:30 server time and
        logs every deletion to the audit log. Server env <code>RETENTION_DRY_RUN</code>{" "}
        must be <code>false</code> in production for deletions to actually happen.
      </p>

      <Card>
        <CardHeader><CardTitle>Retention policy</CardTitle></CardHeader>
        <CardContent>
          <form action={savePolicy} className="space-y-4" data-testid="retention-form">
            <label className="block text-sm">
              Delete recordings after (days)
              <input name="recordingsDays" type="number" min={1} max={3650} required
                defaultValue={policy?.recordingsDays ?? 90}
                data-testid="retention-recordings-days"
                className="mt-1 block h-9 w-40 rounded-md border border-border bg-transparent px-3 text-sm" />
            </label>
            <label className="block text-sm">
              Erase transcripts + summaries after (days)
              <input name="transcriptsDays" type="number" min={1} max={3650} required
                defaultValue={policy?.transcriptsDays ?? 365}
                data-testid="retention-transcripts-days"
                className="mt-1 block h-9 w-40 rounded-md border border-border bg-transparent px-3 text-sm" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="autoDelete" defaultChecked={policy?.autoDelete ?? true}
                data-testid="retention-auto-delete" />
              Auto-delete enabled
            </label>
            <button data-testid="retention-save-button"
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
              Save policy
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
