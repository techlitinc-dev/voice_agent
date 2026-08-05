import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Link href="/settings/integrations" data-testid="settings-integrations-link">
        <Card className="transition-colors hover:border-primary/50">
          <CardHeader><CardTitle className="text-base">Integrations</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            CRM (HubSpot, Zoho, …) and calendar (Google, …) connections.
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
