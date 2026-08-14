import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { checkFeatureGate } from "@/lib/feature-gates";
import { CUSTOM_VOICE_MAX, CUSTOM_VOICE_PRICE_PAISE } from "@/lib/voice-cloning";
import { VoiceManager } from "./voice-manager";
import { createVoiceAction, deleteVoiceAction, updateVoiceStatusAction, assignVoiceToAgentAction } from "@/server/actions/voices";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Custom voices — Vaani AI" };

export default async function VoicesPage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }

  const [voices, agents] = await Promise.all([
    db.customVoice.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "desc" },
      include: { agents: { where: { status: { not: "ARCHIVED" } }, select: { id: true, name: true } } },
    }),
    db.agent.findMany({
      where: { workspaceId: ctx.workspaceId, NOT: { status: "ARCHIVED" } },
      select: { id: true, name: true },
    }),
  ]);

  // Plan gate (guide 09). Fail closed on error.
  let premiumVoicesAllowed = false;
  let gateNote: string | null = null;
  try {
    const gate = await checkFeatureGate(ctx.workspaceId, "premiumVoices");
    premiumVoicesAllowed = gate.allowed;
    if (!gate.allowed) gateNote = "Custom voices require the Enterprise plan or the premium-voices add-on.";
  } catch {
    gateNote = "Plan feature check unavailable (guide 09 billing incomplete).";
  }

  return (
    <div className="max-w-4xl space-y-6" data-testid="voices-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Custom voices</h1>
        <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          {voices.length}/{CUSTOM_VOICE_MAX} used · ₹{(CUSTOM_VOICE_PRICE_PAISE / 100).toLocaleString("en-IN")}/voice/mo
        </span>
      </div>

      {gateNote && !premiumVoicesAllowed && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-400" data-testid="voices-gate-banner">
          {gateNote}
        </p>
      )}

      <VoiceManager
        voices={voices}
        agents={agents}
        premiumVoicesAllowed={premiumVoicesAllowed}
        actions={{
          create: createVoiceAction,
          remove: deleteVoiceAction,
          setStatus: updateVoiceStatusAction,
          assign: assignVoiceToAgentAction,
        }}
      />

      <Card>
        <CardHeader><CardTitle>How cloned voices work</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. Upload a clean 30s+ sample of the voice (mp3/wav, up to 25 MB) with no background music.</p>
          <p>2. We clone it on ElevenLabs (or PlayHT) — in dev, cloning is simulated so you can test the flow free.</p>
          <p>3. Assign the cloned voice to any agent in the agent builder — all its calls share the same voice.</p>
          <p className="pt-1">Billed ₹5,000/month per voice (covers provider cloning + hosting). Enterprise plan or premium-voices add-on required.</p>
        </CardContent>
      </Card>
    </div>
  );
}
