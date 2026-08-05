/** Retention cutoff math (spec §11) — pure, fake-clock testable. */

/** Records created BEFORE this date are eligible for deletion. */
export function cutoffDate(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 3600 * 1000);
}

/** Validate a retention-days value from user input (1..3650). */
export function isValidRetentionDays(days: number): boolean {
  return Number.isInteger(days) && days >= 1 && days <= 3650;
}
