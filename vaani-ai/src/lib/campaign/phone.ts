/**
 * Phone normalization + validation (readme §6.1 "validation").
 * Contacts: E.164, with Indian 10-digit mobiles auto-prefixed +91.
 * Pool DIDs: India series rules — SERIES_140 numbers start +91140,
 * SERIES_1600 numbers start +911600 (TRAI allocation).
 */

const E164 = /^\+[1-9]\d{7,14}$/;
const IN_MOBILE_10 = /^[6-9]\d{9}$/;
const IN_MOBILE_12 = /^91[6-9]\d{9}$/;

export function isValidE164(phone: string): boolean {
  return E164.test(phone);
}

/** Normalize common Indian formats to E.164: 9876543210 → +919876543210. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (E164.test(digits)) return digits;
  const onlyDigits = digits.replace(/\D/g, "");
  if (IN_MOBILE_10.test(onlyDigits)) return `+91${onlyDigits}`;
  if (IN_MOBILE_12.test(onlyDigits)) return `+${onlyDigits}`;
  return null;
}

/** +91 mobile (contact-reachable Indian wireless number). */
export function isIndianMobile(phone: string): boolean {
  return /^\+91[6-9]\d{9}$/.test(phone);
}

export type IndianDidSeries = "140" | "1600" | "other";

/** Classify an Indian DID we OWN (pool number) by TRAI series. */
export function classifyIndianDid(phone: string): IndianDidSeries {
  if (/^\+91140\d{7}$/.test(phone)) return "140";
  if (/^\+911600\d{6}$/.test(phone)) return "1600";
  return "other";
}

/** Validate a pool DID against its declared NumberType (only 140/1600 are rule-bound). */
export function isValidDidForType(phone: string, numberType: string): boolean {
  if (!isValidE164(phone)) return false;
  if (numberType === "SERIES_140") return classifyIndianDid(phone) === "140";
  if (numberType === "SERIES_1600") return classifyIndianDid(phone) === "1600";
  return true; // LOCAL / TOLLFREE / MOBILE: any valid E.164
}
