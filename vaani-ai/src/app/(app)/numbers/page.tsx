import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import {
  registerNumberAction, assignAgentAction, deleteNumberAction,
} from "@/server/actions/numbers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/money";

const NUMBER_TYPES = [
  { value: "LOCAL", label: "Local DID" },
  { value: "TOLLFREE", label: "Toll-free 1800" },
  { value: "MOBILE", label: "Mobile series" },
  { value: "SERIES_140", label: "140 (promotional)" },
  { value: "SERIES_1600", label: "1600 (service)" },
];

export default async function NumbersPage() {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const [numbers, agents] = await Promise.all([
    db.phoneNumber.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { agent: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.agent.findMany({
      where: { workspaceId: ctx.workspaceId, status: "PUBLISHED" },
      select: { id: true, name: true },
    }),
  ]);

  async function register(formData: FormData) {
    "use server";
    await registerNumberAction({
      number: formData.get("number"),
      label: formData.get("label") || undefined,
      numberType: formData.get("numberType") || "LOCAL",
      monthlyRentPaise: formData.get("rent") || 0,
    });
  }
  async function assign(formData: FormData) {
    "use server";
    const agentId = String(formData.get("agentId") ?? "");
    await assignAgentAction(String(formData.get("id")), agentId === "" ? null : agentId);
  }
  async function remove(formData: FormData) {
    "use server";
    await deleteNumberAction(String(formData.get("id")));
  }

  return (
    <div className="max-w-3xl space-y-8">
      <h1 className="text-2xl font-bold">Phone Numbers</h1>

      <Card>
        <CardHeader><CardTitle>Register a number</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Enter the DID you rented from Vobiz (E.164 format). The same number must be
            pointed at this server in the Vobiz dashboard (guide 04) and bound to the
            published workflow in Dograh (Step 1).
          </p>
          <form action={register} className="flex flex-wrap gap-2">
            <Input name="number" placeholder="+918040001234" className="w-52" required
              data-testid="number-input" />
            <Input name="label" placeholder="Label (e.g. Main line)" className="w-48" />
            <select name="numberType" defaultValue="LOCAL" data-testid="number-type-select"
              className="h-9 rounded-md border border-border bg-card px-3 text-sm">
              {NUMBER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <Input name="rent" type="number" placeholder="Rent ₹/mo" className="w-32" />
            <Button type="submit" data-testid="number-add-btn">Add number</Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {numbers.length === 0 && (
          <p className="text-muted-foreground">No numbers yet. Register your first DID above.</p>
        )}
        {numbers.map((n) => (
          <Card key={n.id} data-testid="number-row">
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-44">
                <p className="font-mono font-semibold">{n.number}</p>
                <p className="text-xs text-muted-foreground">
                  {n.label ?? "—"} · {NUMBER_TYPES.find((t) => t.value === n.numberType)?.label ?? n.numberType}
                  {" "}· rent {formatINR(n.monthlyRentPaise)}/mo
                </p>
              </div>
              <form action={assign} className="flex items-center gap-2">
                <input type="hidden" name="id" value={n.id} />
                <select name="agentId" defaultValue={n.agentId ?? ""} data-testid="number-agent-select"
                  className="h-9 rounded-md border border-border bg-card px-3 text-sm">
                  <option value="">— no agent (calls rejected) —</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <Button type="submit" size="sm" variant="outline" data-testid="number-assign-btn">Assign</Button>
              </form>
              <p className="text-xs text-muted-foreground">
                {n.agent ? `answering: ${n.agent.name}` : "unassigned"}
              </p>
              <form action={remove} className="ml-auto">
                <input type="hidden" name="id" value={n.id} />
                <Button type="submit" size="sm" variant="ghost" data-testid="number-delete-btn">Delete</Button>
              </form>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
