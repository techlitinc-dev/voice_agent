/**
 * Shared password policy for registration.
 * Imported by both the server action (auth.ts) and the register form client so
 * the client-side validation gate and server-side zod rule can never drift.
 */
export const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
export const PASSWORD_HINT =
  "Password must be 8+ characters with at least one uppercase, one lowercase, one number and one special character.";
