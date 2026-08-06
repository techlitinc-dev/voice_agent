import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const metadata = { title: "Status — Vaani AI" };

type Health = {
  status: "ok" | "degraded" | "down";
  checks: Record<string, boolean>;
  latencyMs: Record<string, number>;
  uptimeSec: number;
  version: string;
  time: string;
};

async function getHealth(): Promise<Health | null> {
  try {
    // Server-side self-call: loopback inside the same container/host.
    const res = await fetch("http://127.0.0.1:3000/api/health", { cache: "no-store" });
    return (await res.json()) as Health;
  } catch {
    return null;
  }
}

async function getIncidents(): Promise<string> {
  try {
    return await fs.readFile(path.join(process.cwd(), "src/content/incidents.md"), "utf8");
  } catch {
    return "No incident log found.";
  }
}

const CHECK_LABELS: Record<string, string> = {
  db: "PostgreSQL",
  redis: "Redis (queues)",
  minio: "Object storage (recordings)",
  dograh: "Voice engine (Dograh)",
};

export default async function StatusPage() {
  const [health, incidents] = await Promise.all([getHealth(), getIncidents()]);
  const externalStatus = process.env.STATUS_UPTIME_URL ?? "";

  const banner =
    health === null || health.status === "down"
      ? { text: "Major outage — we are investigating", cls: "border-red-500/40 bg-red-500/10 text-red-400" }
      : health.status === "degraded"
        ? { text: "Partial degradation — some components are unreachable", cls: "border-amber-500/40 bg-amber-500/10 text-amber-400" }
        : { text: "All systems operational", cls: "border-green-500/40 bg-green-500/10 text-green-400" };

  return (
    <main className="mx-auto max-w-2xl px-4 py-16" data-testid="status-page">
      <h1 className="text-3xl font-bold">Vaani AI status</h1>

      <p className={`mt-6 rounded-md border p-4 text-sm font-medium ${banner.cls}`} data-testid="status-banner">
        {banner.text}
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Live component checks</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {Object.entries(CHECK_LABELS).map(([key, label]) => {
            const ok = health?.checks?.[key] ?? false;
            const ms = health?.latencyMs?.[key];
            return (
              <li key={key} className="flex items-center justify-between rounded-md border border-border p-3" data-testid={`status-check-${key}`}>
                <span>{label}</span>
                <span className={ok ? "text-green-400" : "text-red-400"}>
                  {ok ? "operational" : "unreachable"}
                  {typeof ms === "number" && <span className="ml-2 text-muted-foreground">{ms} ms</span>}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Checked live at {health?.time ?? "unknown"} · version {health?.version ?? "unknown"}
        </p>
      </section>

      <section className="mt-8" data-testid="status-uptime">
        <h2 className="text-lg font-semibold">30-day uptime</h2>
        {externalStatus ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Independently monitored 30-day uptime and incident history:{" "}
            <a href={externalStatus} className="text-primary hover:underline" data-testid="status-uptime-link">
              {externalStatus}
            </a>
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            External uptime monitoring is being configured. (Operator: see guide 12 Step 11 —
            Better Uptime/UptimeRobot public page, then set STATUS_UPTIME_URL.)
          </p>
        )}
      </section>

      <section className="mt-8" data-testid="status-incidents">
        <h2 className="text-lg font-semibold">Incident log</h2>
        <pre className="mt-3 whitespace-pre-wrap rounded-md border border-border bg-card p-4 text-xs text-muted-foreground">
          {incidents}
        </pre>
      </section>
    </main>
  );
}
