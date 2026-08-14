import Link from "next/link";

const LINKS = [
  { href: "/settings/members", label: "Members" },
  { href: "/settings/security", label: "Security (2FA)" },
  { href: "/settings/api-keys", label: "API keys" },
  { href: "/settings/sessions", label: "Sessions" },
  { href: "/settings/audit-log", label: "Audit log" },
  { href: "/settings/voices", label: "Custom voices" },
  { href: "/settings/crm", label: "CRM approvals" },
  { href: "/settings/webhooks/deliveries", label: "Webhook deliveries" },
];

export function SettingsNav() {
  return (
    <nav data-testid="settings-nav" className="mb-6 flex flex-wrap gap-2">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
