import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { createPoolAction, addNumberToPoolAction, removeNumberFromPoolAction } from "@/server/actions/pools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const NUMBER_TYPES = ["LOCAL", "TOLLFREE", "MOBILE", "SERIES_140", "SERIES_1600"];

export default async function PoolsPage() {
  let ctx;
  try { ctx = await requireWorkspace(); } catch { redirect("/login"); }
  const pools = await db.numberPool.findMany({
    where: { workspaceId: ctx.workspaceId },
    include: { numbers: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });

  async function createPool(formData: FormData) {
    "use server";
    await createPoolAction(String(formData.get("name") ?? ""));
  }
  async function addNumber(formData: FormData) {
    "use server";
    await addNumberToPoolAction({
      poolId: formData.get("poolId"),
      number: formData.get("number"),
      label: formData.get("label") || null,
      numberType: formData.get("numberType"),
      dailyCallCap: formData.get("dailyCallCap") ? Number(formData.get("dailyCallCap")) : null,
      lifetimeCallCap: formData.get("lifetimeCallCap") ? Number(formData.get("lifetimeCallCap")) : null,
    });
  }
  async function removeNumber(formData: FormData) {
    "use server";
    await removeNumberFromPoolAction(String(formData.get("id")));
  }

  return (
    <div className="space-y-6" data-testid="pool-editor">
      <h1 className="text-2xl font-bold">Number pools</h1>
      <p className="text-sm text-muted-foreground">
        Pools rotate caller IDs across DIDs with per-number daily/lifetime caps
        (spam-flag protection, readme §6.1). TRAI rule: SERIES_140 = promotional
        (+91140XXXXXXX), SERIES_1600 = service/transactional (+911600XXXXXX) — the
        campaign type decides which series its pool may contain.
      </p>

      <Card>
        <CardHeader><CardTitle>Create pool</CardTitle></CardHeader>
        <CardContent>
          <form action={createPool} className="flex gap-2" data-testid="pool-create-form">
            <Input name="name" placeholder="Pool name (e.g. Promo 140 pool)" required className="w-72" />
            <Button type="submit">Create</Button>
          </form>
        </CardContent>
      </Card>

      {pools.map((pool) => (
        <Card key={pool.id} data-testid="pool-card">
          <CardHeader><CardTitle>{pool.name} ({pool.numbers.length} numbers)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <table className="w-full text-sm" data-testid="pool-numbers-table">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-2">Number</th><th className="p-2">Type</th>
                  <th className="p-2">Daily used/cap</th><th className="p-2">Lifetime used/cap</th><th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {pool.numbers.map((n) => (
                  <tr key={n.id} className="border-b last:border-0">
                    <td className="p-2 font-mono">{n.number}{n.label ? ` (${n.label})` : ""}</td>
                    <td className="p-2">{n.numberType}</td>
                    <td className="p-2">{n.dailyCallsUsed}/{n.dailyCallCap ?? "∞"}</td>
                    <td className="p-2">{n.lifetimeCallsUsed}/{n.lifetimeCallCap ?? "∞"}</td>
                    <td className="p-2">
                      <form action={removeNumber}>
                        <input type="hidden" name="id" value={n.id} />
                        <Button size="sm" variant="ghost">Remove</Button>
                      </form>
                    </td>
                  </tr>
                ))}
                {pool.numbers.length === 0 && (
                  <tr><td colSpan={5} className="p-2 text-muted-foreground">No numbers yet.</td></tr>
                )}
              </tbody>
            </table>
            <form action={addNumber} className="flex flex-wrap items-center gap-2" data-testid="pool-add-number-form">
              <input type="hidden" name="poolId" value={pool.id} />
              <Input name="number" placeholder="+911401234567" required className="w-48 font-mono" data-testid="pool-number-input" />
              <Input name="label" placeholder="Label (optional)" className="w-36" />
              <select name="numberType" className="h-9 rounded-md border border-border bg-card px-3 text-sm" data-testid="pool-number-type-select">
                {NUMBER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <Input name="dailyCallCap" type="number" placeholder="Daily cap" className="w-28" min={1} />
              <Input name="lifetimeCallCap" type="number" placeholder="Lifetime cap" className="w-32" min={1} />
              <Button type="submit" size="sm">Add number</Button>
            </form>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
