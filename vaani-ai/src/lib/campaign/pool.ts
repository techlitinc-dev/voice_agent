/**
 * Number pool rotation (readme §6.1): round-robin across pool DIDs, skipping
 * numbers that hit their daily/lifetime cap (spam-flag protection).
 * The scheduler keeps the last-used number id per pool in memory; this module is pure.
 */

export type PoolNumber = {
  id: string;
  number: string;
  numberType: string; // NumberType enum value
  dailyCallCap: number | null;
  lifetimeCallCap: number | null;
  dailyCallsUsed: number;
  lifetimeCallsUsed: number;
};

export function isDailyCapped(n: PoolNumber): boolean {
  return n.dailyCallCap !== null && n.dailyCallsUsed >= n.dailyCallCap;
}

export function isLifetimeCapped(n: PoolNumber): boolean {
  return n.lifetimeCallCap !== null && n.lifetimeCallsUsed >= n.lifetimeCallCap;
}

export function isCapped(n: PoolNumber): boolean {
  return isDailyCapped(n) || isLifetimeCapped(n);
}

/**
 * Pick the next uncapped number strictly AFTER `lastUsedId` in list order
 * (wraps around). null when every number is capped or the pool is empty.
 */
export function pickNumberRoundRobin(numbers: PoolNumber[], lastUsedId: string | null): PoolNumber | null {
  if (numbers.length === 0) return null;
  const lastIdx = lastUsedId === null ? -1 : numbers.findIndex((n) => n.id === lastUsedId);
  for (let i = 1; i <= numbers.length; i++) {
    const candidate = numbers[(lastIdx + i) % numbers.length];
    if (!isCapped(candidate)) return candidate;
  }
  return null;
}
