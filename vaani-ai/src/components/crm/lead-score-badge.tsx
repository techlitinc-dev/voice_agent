import { cn } from "@/lib/utils";

const COLORS: Record<string, string> = { A: "bg-green-500", B: "bg-blue-500", C: "bg-amber-500", D: "bg-gray-400" };
const LABELS: Record<string, string> = { A: "Excellent", B: "Good", C: "Average", D: "Cold" };

/** Compact lead-score badge (guide crm/04 §2.5). */
export function LeadScoreBadge({
  score,
  grade,
  size = "md",
}: {
  score: number;
  grade: string;
  size?: "sm" | "md" | "lg";
}) {
  const box = size === "lg" ? "h-10 w-10 text-base" : size === "sm" ? "h-6 w-6 text-xs" : "h-8 w-8 text-sm";
  return (
    <div className="flex items-center gap-2" data-testid="lead-score-badge">
      <div className={cn("flex items-center justify-center rounded-lg font-bold text-white", COLORS[grade] ?? "bg-gray-400", box)}>
        {grade}
      </div>
      <div>
        <p className="text-sm font-semibold leading-tight">{score}/100</p>
        <p className="text-xs leading-tight text-muted-foreground">{LABELS[grade] ?? grade}</p>
      </div>
    </div>
  );
}

/** Factor breakdown list (guide crm/04 §2.6). factors = { intent, engagement,
 *  recency, pipeline, value, responsiveness } each with score + max. */
export function LeadScoreBreakdown({
  score,
  grade,
  factors,
  reasons,
}: {
  score: number;
  grade: string;
  factors?: Record<string, { score: number; max: number }> | null;
  reasons?: string[];
}) {
  const MAXES: Record<string, number> = { intent: 30, engagement: 25, recency: 15, pipeline: 15, value: 10, responsiveness: 5 };
  const LABELS: Record<string, string> = {
    intent: "Intent", engagement: "Engagement", recency: "Recency", pipeline: "Pipeline", value: "Deal value", responsiveness: "Responsiveness",
  };

  return (
    <div className="space-y-3" data-testid="lead-score-breakdown">
      <div className="flex items-center gap-3">
        <LeadScoreBadge score={score} grade={grade} size="lg" />
      </div>
      {/* Progress bar */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${score}%` }} />
      </div>
      {/* Factors */}
      <div className="space-y-1.5">
        {Object.entries(MAXES).map(([key, max]) => {
          const f = factors?.[key];
          const val = f?.score ?? 0;
          const maxVal = f?.max ?? max;
          return (
            <div key={key} className="flex items-center gap-2 text-sm">
              <span className="w-28 text-muted-foreground">{LABELS[key]}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary/70" style={{ width: `${(val / maxVal) * 100}%` }} />
              </div>
              <span className="w-14 text-right text-xs text-muted-foreground">{val}/{maxVal}</span>
            </div>
          );
        })}
      </div>
      {/* Reasons */}
      {reasons && reasons.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Reasons</p>
          <ul className="list-inside list-disc text-xs text-muted-foreground">
            {reasons.slice(0, 6).map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
