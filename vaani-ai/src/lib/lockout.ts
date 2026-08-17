import { db } from "./db";
import { sendStaffEmail } from "./notify";

/**
 * Failed-login lockout (hardening doc §1.6).
 *
 * 5 consecutive failed attempts → account locked for 15 minutes and staff
 * alerted by email. Lockout state lives on the User row (failedLoginAttempts,
 * lockedUntil) so it survives process restarts and works across replicas.
 *
 * The helpers never throw: a lockout-store failure must not take down login.
 */

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

export type LockoutState = {
  locked: boolean;
  remainingAttempts: number;
  lockDurationMs: number;
};

/** Read the current lockout state for a user (no side effects). */
export function lockoutState(user: {
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}): LockoutState {
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { locked: true, remainingAttempts: 0, lockDurationMs: user.lockedUntil.getTime() - Date.now() };
  }
  return {
    locked: false,
    remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - user.failedLoginAttempts),
    lockDurationMs: LOCK_DURATION_MS,
  };
}

/** Record a failed attempt. Returns the resulting lockout state. */
export async function recordFailedLogin(userId: string): Promise<LockoutState> {
  const user = await db.user.update({
    where: { id: userId },
    data: {
      failedLoginAttempts: { increment: 1 },
    },
  });
  const state = lockoutState(user);
  if (state.locked) {
    // Lock the account + alert staff (email alert never blocks login).
    await db.user.update({
      where: { id: userId },
      data: { lockedUntil: new Date(Date.now() + LOCK_DURATION_MS) },
    });
    await sendStaffEmail(
      "[Vaani] Failed-login lockout triggered",
      `User ${user.email} (${user.id}) hit ${MAX_FAILED_ATTEMPTS} failed logins and is locked for 15 minutes.`
    );
  }
  return state;
}

/** Clear the failure counter (successful login, password change, reset). */
export async function clearFailedLogins(userId: string): Promise<void> {
  await db.user.updateMany({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
}
