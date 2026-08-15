import { AgentForm } from "../agent-form";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { checkFeatureGate } from "@/lib/feature-gates";
import { redirect } from "next/navigation";

export default async function NewAgentPage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const [customVoices, voicesGate] = await Promise.all([
    db.customVoice.findMany({
      where: { workspaceId: ctx.workspaceId, status: "READY" },
      select: { id: true, name: true, status: true },
    }),
    checkFeatureGate(ctx.workspaceId, "premiumVoices").catch(() => ({ allowed: false } as { allowed: boolean })),
  ]);
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">New agent</h1>
      <AgentForm mode="create" customVoices={customVoices} premiumVoicesAllowed={voicesGate.allowed} />
    </div>
  );
}
