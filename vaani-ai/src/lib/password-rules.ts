/**
 * Shared password policy (hardening doc §1.10).
 * Imported by both the server action (auth.ts) and the register form client so
 * the client-side validation gate and server-side zod rule can never drift.
 *
 * Policy: ≥ 12 characters, at least one uppercase, one lowercase, one number
 * and one special character. Server-side additionally runs a breach-list check
 * (HIBP k-anonymity) — see src/lib/passwords.ts.
 */
export const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_HINT =
  "Password must be 12+ characters with at least one uppercase, one lowercase, one number and one special character.";
