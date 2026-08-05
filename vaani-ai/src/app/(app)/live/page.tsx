import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { LiveDashboard } from "@/components/live-dashboard";

export default async function LivePage() {
  try {
    await requireRole("AGENT");
  } catch {
    redirect("/login");
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Live Calls</h1>
        <p className="text-sm text-muted-foreground">
          Active calls refresh every 5 seconds. Supervisor modes (listen / whisper /
          barge / takeover) are recorded and surfaced to the human on handoff.
        </p>
      </div>
      <LiveDashboard />
    </div>
  );
}
