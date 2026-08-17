/**
 * PII redaction for transcripts (spec §11).
 * Redact-in-place: the original text is overwritten and NOT retained. Each redacted
 * span becomes a "[REDACTED:<TYPE>]" token so QA/search still work.
 */

/** Luhn checksum for digit strings (payment card validation). */
export function luhnCheck(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export type RedactionResult = { redacted: string; findings: string[] };

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 13–19 digits with optional single space/dash separators; ends on a digit so a
// trailing space after the number is NOT consumed.
const CARD_CANDIDATE_RE = /\b(?:\d[ -]?){12,18}\d\b/g;
const AADHAAR_RE = /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g;
const OTP_RE = /\b(otp|one[- ]time password|verification code|pin)\b\D{0,12}?(\d{4,8})\b/gi;
// PAN — 5 letters + 4 digits + 1 letter (Indian tax id).
const PAN_RE = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
// Indian phone — optional +91/91/0 prefix + 10 digits (5-5 or run), with
// grouping. Lookbehind + trailing \b prevent matching inside longer digit
// runs (order ids, card numbers). The whole match (prefix included) is redacted.
const PHONE_RE = /(?<![\d+])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}\b/g;
// CVV — 3–4 digits that immediately follow the word "cvv" (context-aware).
const CVV_RE = /\bcvv\b[:\s-]*(\d{3,4})\b/gi;

/** Redact PII from one text blob. Idempotent (re-running on redacted text is a no-op). */
export function redactPii(text: string): RedactionResult {
  const findings: string[] = [];
  let out = text;

  // 1) Payment cards — digit sequences that PASS Luhn (so order ids survive).
  out = out.replace(CARD_CANDIDATE_RE, (match) => {
    const digits = match.replace(/[ -]/g, "");
    if (luhnCheck(digits)) {
      findings.push("card");
      return "[REDACTED:CARD]";
    }
    return match;
  });

  // 2) Aadhaar — 12 digits in 4-4-4 groups (any 12-digit run; Aadhaar has no checksum in v1).
  out = out.replace(AADHAAR_RE, (_match) => {
    findings.push("aadhaar");
    return "[REDACTED:AADHAAR]";
  });

  // 3) Emails.
  out = out.replace(EMAIL_RE, () => {
    findings.push("email");
    return "[REDACTED:EMAIL]";
  });

  // 4) OTPs / verification codes — keep the label, redact the digits.
  out = out.replace(OTP_RE, (_match, label: string) => {
    findings.push("otp");
    return `${label} [REDACTED:OTP]`;
  });

  // 5) PAN (Indian tax id).
  out = out.replace(PAN_RE, () => {
    findings.push("pan");
    return "[REDACTED:PAN]";
  });

  // 6) Indian phone numbers (10-digit runs with optional 91/0/+91 prefix).
  out = out.replace(PHONE_RE, () => {
    findings.push("phone");
    return "[REDACTED:PHONE]";
  });

  // 7) CVV — only when preceded by the word "cvv" (context-aware).
  out = out.replace(CVV_RE, (_match, cvv: string) => {
    findings.push("cvv");
    return _match.replace(cvv, "[REDACTED:CVV]");
  });

  return { redacted: out, findings };
}
