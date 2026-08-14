import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { CsvUploader } from "./csv-uploader";
import { CrmImportButton } from "./crm-import-button";
import { toggleDncAction } from "@/server/actions/contacts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PhoneOff } from "lucide-react";

export const metadata = { title: "Contacts — Vaani AI" };
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: { list?: string };
}) {
  let ctx;
  try {
    ctx = await requireWorkspace();
  } catch {
    redirect("/login");
  }
  const [lists, contacts, crmConnections] = await Promise.all([
    db.contactList.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { _count: { select: { contacts: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.contact.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...(searchParams.list ? { listId: searchParams.list } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.crmConnection.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: { id: true, provider: true },
    }),
  ]);

  async function toggleDnc(formData: FormData) {
    "use server";
    await toggleDncAction(String(formData.get("id")), formData.get("dnc") === "true");
  }

  return (
    <div className="space-y-8" data-testid="contacts-page">
      <h1 className="text-2xl font-bold">Contacts</h1>

      <CsvUploader />
      {crmConnections.length > 0 && <CrmImportButton connections={crmConnections} />}

      <section>
        <h2 className="mb-3 text-lg font-semibold">Lists</h2>
        <div className="flex flex-wrap gap-2">
          {lists.map((l) => (
            <a key={l.id} href={`/contacts?list=${l.id}`}
              className="rounded-full border px-3 py-1 text-sm hover:border-primary">
              {l.name} ({l._count.contacts})
            </a>
          ))}
          {lists.length === 0 && <p className="text-sm text-muted-foreground">No lists yet — upload a CSV.</p>}
        </div>
      </section>

      <Card>
        <CardHeader><CardTitle>{contacts.length} contacts (latest 200)</CardTitle></CardHeader>
        {contacts.length === 0 ? (
          <CardContent>
            <EmptyState
              icon={PhoneOff}
              title="No contacts yet"
              description="Upload a CSV or import from a connected CRM to build your contact list."
            />
          </CardContent>
        ) : (
          <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="contacts-table">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-2">Phone</th><th className="p-2">Name</th>
                <th className="p-2">Timezone</th><th className="p-2">Consent</th>
                <th className="p-2">Attributes</th><th className="p-2">DNC</th><th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="p-2 font-mono">
                    <a href={`/contacts/${encodeURIComponent(c.phone)}`} className="hover:text-primary" data-testid="contact-link">
                      {c.phone}
                    </a>
                  </td>
                  <td className="p-2">{c.name ?? "—"}</td>
                  <td className="p-2">{c.timezone ?? "—"}</td>
                  <td className="p-2" data-testid="consent-cell">
                    {c.optOutAt ? <span className="text-red-400">opted out</span>
                      : c.consentAt ? <span className="text-green-400">{c.consentSource ?? "yes"}</span>
                      : "—"}
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {c.attributes ? Object.entries(c.attributes as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join(", ") : "—"}
                  </td>
                  <td className="p-2">{c.dnc ? <span className="text-red-400" data-testid="dnc-badge">DNC</span> : "—"}</td>
                  <td className="p-2">
                    <form action={toggleDnc}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="dnc" value={String(!c.dnc)} />
                      <Button size="sm" variant="ghost" data-testid="dnc-toggle">{c.dnc ? "Allow calls" : "Mark DNC"}</Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
