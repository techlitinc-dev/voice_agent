/**
 * Static Indian public-holiday calendar (YYYY-MM-DD), merged with the optional
 * EXTRA_HOLIDAYS env var (comma-separated YYYY-MM-DD). Operator edits this file to
 * add workspace-relevant holidays; env var is the no-redeploy override.
 */
export const HOLIDAYS: string[] = [
  // 2025
  "2025-01-26", // Republic Day
  "2025-03-14", // Holi
  "2025-08-15", // Independence Day
  "2025-10-02", // Gandhi Jayanti
  "2025-10-20", // Diwali (approx — operator confirms per year)
  "2025-12-25", // Christmas
  // 2026
  "2026-01-26",
  "2026-08-15",
  "2026-10-02",
  "2026-12-25",
];

export function getHolidays(): string[] {
  const extra = (process.env.EXTRA_HOLIDAYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  return [...HOLIDAYS, ...extra];
}
