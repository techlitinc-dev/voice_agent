import { AgentForm } from "../agent-form";

export default function NewAgentPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">New agent</h1>
      <AgentForm mode="create" />
    </div>
  );
}
