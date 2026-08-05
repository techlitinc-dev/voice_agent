/**
 * Calendar availability + booking for the CALENDAR_BOOKING agent tool.
 * Google Calendar: full implementation via googleapis (OAuth tokens live in
 * CalendarConnection — connect flow in Step 20).
 * MICROSOFT / CALENDLY / CALCOM: config-driven stubs — OPERATOR GATE (below).
 */
import { google, calendar_v3 } from "googleapis";
import type { CalendarConnection } from "@prisma/client";

function oauthClient(): InstanceType<typeof google.auth.OAuth2> {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CALENDAR_CLIENT_ID,
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/integrations/calendar/google/callback`,
  );
}

/** URL the "Connect Google Calendar" button redirects to. */
export function googleCalendarAuthUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"],
    state,
  });
}

/** Exchange an OAuth code for tokens (callback route). */
export async function exchangeGoogleCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}> {
  const { tokens } = await oauthClient().getToken(code);
  if (!tokens.access_token) throw new Error("no access_token from Google");
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
  };
}

async function googleCalendar(conn: CalendarConnection): Promise<calendar_v3.Calendar> {
  const auth = oauthClient();
  auth.setCredentials({
    access_token: conn.accessToken,
    refresh_token: conn.refreshToken ?? undefined,
    expiry_date: conn.tokenExpiresAt?.getTime(),
  });
  return google.calendar({ version: "v3", auth });
}

export type Slot = { start: string; end: string }; // ISO

/** Free 30-minute slots within the next `days` days, business hours 09:00–19:00 local. */
export async function getAvailability(
  conn: CalendarConnection,
  opts: { days?: number; slotMinutes?: number } = {},
): Promise<Slot[]> {
  if (conn.provider !== "GOOGLE") return providerStub(conn.provider, "getAvailability");
  const cal = await googleCalendar(conn);
  const days = opts.days ?? 7;
  const slotMinutes = opts.slotMinutes ?? 30;
  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const fb = await cal.freebusy.query({
    requestBody: {
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      items: [{ id: conn.primaryCalendarId ?? "primary" }],
    },
  });
  const busy = (fb.data.calendars?.[conn.primaryCalendarId ?? "primary"]?.busy ?? [])
    .map((b) => ({ start: new Date(b.start ?? ""), end: new Date(b.end ?? "") }))
    .filter((b) => !isNaN(b.start.getTime()));

  const slots: Slot[] = [];
  for (let t = new Date(now); t < end && slots.length < 20; t = new Date(t.getTime() + slotMinutes * 60000)) {
    const h = t.getHours();
    if (h < 9 || h >= 19) continue; // business hours
    const sEnd = new Date(t.getTime() + slotMinutes * 60000);
    const clash = busy.some((b) => t < b.end && sEnd > b.start);
    if (!clash && t > now) slots.push({ start: t.toISOString(), end: sEnd.toISOString() });
  }
  return slots;
}

/** Create a calendar event (the actual booking). Returns the event id + link. */
export async function bookSlot(
  conn: CalendarConnection,
  input: { startIso: string; endIso: string; summary: string; attendeeName?: string; attendeePhone?: string; description?: string },
): Promise<{ eventId: string; htmlLink: string | null }> {
  if (conn.provider !== "GOOGLE") return providerStub(conn.provider, "bookSlot");
  const cal = await googleCalendar(conn);
  const evt = await cal.events.insert({
    calendarId: conn.primaryCalendarId ?? "primary",
    requestBody: {
      summary: input.summary,
      description: [input.description, input.attendeeName ? `Name: ${input.attendeeName}` : null, input.attendeePhone ? `Phone: ${input.attendeePhone}` : null]
        .filter(Boolean)
        .join("\n"),
      start: { dateTime: input.startIso },
      end: { dateTime: input.endIso },
    },
  });
  return { eventId: evt.data.id ?? "", htmlLink: evt.data.htmlLink ?? null };
}

/** OPERATOR GATE — MICROSOFT / CALENDLY / CALCOM.
 *  These providers follow the same CalendarConnection token storage; the OAuth +
 *  API calls are provider-specific. v1 ships config-driven stubs that fail loudly
 *  and clearly. To enable one: implement its calls here (same Slot/bookSlot shapes),
 *  verify against the provider's sandbox, and remove it from this list. */
function providerStub(provider: string, fn: string): never {
  throw new Error(
    `Calendar provider ${provider} is not enabled in v1 (${fn}). OPERATOR GATE: implement ${fn} for ${provider} in src/lib/calendar.ts — the connection row, UI and tool wiring already exist.`,
  );
}
