/**
 * Per-workspace business hours, keyed by workspace slug.
 * "default" applies to every workspace without an explicit entry.
 * days: 0 = Sunday ... 6 = Saturday. open/close: "HH:mm" 24h, in `timezone`.
 */
export type BusinessHoursEntry = {
  timezone: string; // IANA, e.g. "Asia/Kolkata"
  days: number[];
  open: string; // "HH:mm"
  close: string; // "HH:mm"
  afterHoursMessage?: string; // overrides the default after-hours greeting
  holidayMessage?: string; // overrides the default holiday greeting
};

export const BUSINESS_HOURS: Record<string, BusinessHoursEntry> = {
  default: {
    timezone: "Asia/Kolkata",
    days: [1, 2, 3, 4, 5, 6],
    open: "09:00",
    close: "19:00",
  },
  "demo-clinic": {
    timezone: "Asia/Kolkata",
    days: [1, 2, 3, 4, 5, 6],
    open: "10:00",
    close: "20:00",
    afterHoursMessage:
      "Thank you for calling Demo Dental Clinic. We are closed right now; our hours are 10 AM to 8 PM, Monday to Saturday. I can still help you book an appointment or take a message.",
    holidayMessage:
      "Thank you for calling Demo Dental Clinic. We are closed today for a public holiday. I can still help you book an appointment or take a message.",
  },
};

export function getBusinessHours(workspaceSlug: string): BusinessHoursEntry {
  return BUSINESS_HOURS[workspaceSlug] ?? BUSINESS_HOURS.default;
}
