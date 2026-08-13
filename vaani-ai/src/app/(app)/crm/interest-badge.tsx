import { Badge } from "@/components/ui/badge";

/** Interest score badge from a deal's attributes JSON (cached at deal creation). */
export function interestScoreOf(attributes: unknown): string | null {
  if (!attributes || typeof attributes !== "object") return null;
  const score = (attributes as Record<string, unknown>).interestScore;
  return typeof score === "string" && ["HOT", "WARM", "COLD"].includes(score) ? score : null;
}

export function InterestBadge({ attributes }: { attributes: unknown }) {
  const score = interestScoreOf(attributes);
  if (!score) return null;
  const variant = score === "HOT" ? "danger" : score === "WARM" ? "warning" : "secondary";
  return <Badge variant={variant}>{score}</Badge>;
}
