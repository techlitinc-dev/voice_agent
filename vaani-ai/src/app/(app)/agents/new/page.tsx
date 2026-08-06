import { AgentForm } from "../agent-form";
import { requireWorkspace } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function NewAgentPage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  void ctx; // auth guard: workspace-scoped session verified above
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">New agent</h1>
      <AgentForm mode="create" />
    </div>
  );
}
