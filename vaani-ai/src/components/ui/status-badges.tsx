import { Badge } from "@/components/ui/badge";
import { Flame, Snowflake, Zap } from "lucide-react";

/** Consistent status badges across the app (see docs/ui-expansion/02 §5). */

export type CallStatus = "RINGING" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "NO_ANSWER" | "BUSY" | "VOICEMAIL";

const CALL_STATUS_MAP: Record<CallStatus, { variant: "secondary" | "success" | "danger" | "info" | "warning"; className?: string }> = {
  RINGING: { variant: "info", className: "animate-pulse" },
  IN_PROGRESS: { variant: "secondary", className: "animate-pulse" },
  COMPLETED: { variant: "success" },
  FAILED: { variant: "danger" },
  NO_ANSWER: { variant: "secondary" },
  BUSY: { variant: "warning" },
  VOICEMAIL: { variant: "info" },
};

export function CallStatusBadge({ status }: { status: string }) {
  const meta = CALL_STATUS_MAP[status as CallStatus] ?? { variant: "secondary" as const };
  return (
    <Badge variant={meta.variant} className={meta.className}>
      {status.replace("_", " ").toLowerCase()}
    </Badge>
  );
}

export type InterestScore = "HOT" | "WARM" | "COLD";

const INTEREST_MAP: Record<InterestScore, { icon: typeof Flame; className: string }> = {
  HOT: { icon: Flame, className: "bg-red-500/15 text-red-400 border-transparent" },
  WARM: { icon: Zap, className: "bg-amber-500/15 text-amber-400 border-transparent" },
  COLD: { icon: Snowflake, className: "bg-blue-500/15 text-blue-400 border-transparent" },
};

export function InterestScoreBadge({ score }: { score: InterestScore }) {
  const { icon: Icon, className } = INTEREST_MAP[score];
  return (
    <Badge className={className}>
      <Icon className="h-3 w-3" />
      {score}
    </Badge>
  );
}

export type DealStatus = "OPEN" | "WON" | "LOST";

const DEAL_STATUS_MAP: Record<DealStatus, { variant: "info" | "success" | "danger"; className?: string }> = {
  OPEN: { variant: "info" },
  WON: { variant: "success" },
  LOST: { variant: "danger" },
};

export function DealStatusBadge({ status }: { status: string }) {
  const meta = DEAL_STATUS_MAP[status as DealStatus] ?? { variant: "info" as const };
  return <Badge variant={meta.variant} className={meta.className}>{status}</Badge>;
}
