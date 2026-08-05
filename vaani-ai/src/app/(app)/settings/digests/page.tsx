import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createDigest, deleteDigest } from "@/server/actions/digests";

export const dynamic = "force-dynamic";

async function createDigestAction(formData: FormData) {
  "use server";
  await createDigest(formData);
}

async function deleteDigestAction(formData: FormData) {
  "use server";
  await deleteDigest(String(formData.get("id")));
}

export default async function DigestSettingsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }

  const digests = await db.scheduledDigest.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Email digests</h1>
      <p className="text-sm text-muted-foreground">
        Summary stats (calls, ASR, cost, margin, outcomes, hallucination flags) emailed
        on a schedule. Requires SMTP_* env vars; without them the worker logs instead of sending.
      </p>

      <Card>
        <CardHeader><CardTitle>New digest</CardTitle></CardHeader>
        <CardContent>
          <form action={createDigestAction} className="flex flex-wrap items-end gap-3" data-testid="digest-create-form">
            <label className="text-sm">
              Frequency
              <select name="frequency" data-testid="digest-frequency-select"
                className="ml-2 h-9 rounded-md border border-border bg-card px-3 text-sm">
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            </label>
            <input name="recipients" required placeholder="owner@clinic.in, manager@clinic.in"
              data-testid="digest-recipients-input"
              className="h-9 w-80 rounded-md border border-border bg-transparent px-3 text-sm" />
            <button data-testid="digest-create-button"
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Add digest</button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Active digests ({digests.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm" data-testid="digest-table">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3">Frequency</th><th className="p-3">Recipients</th>
                <th className="p-3">Last sent</th><th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {digests.map((d) => (
                <tr key={d.id} className="border-b last:border-0">
                  <td className="p-3">{d.frequency}</td>
                  <td className="p-3 text-xs">{d.recipients.join(", ")}</td>
                  <td className="p-3 text-muted-foreground">
                    {d.lastSentAt ? d.lastSentAt.toLocaleString("en-IN") : "never"}
                  </td>
                  <td className="p-3">
                    <form action={deleteDigestAction}>
                      <input type="hidden" name="id" value={d.id} />
                      <button data-testid={`digest-delete-${d.id}`}
                        className="rounded-md border border-red-500/40 px-3 py-1 text-xs text-red-400 hover:bg-red-500/10">
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {digests.length === 0 && (
                <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">No digests configured.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
