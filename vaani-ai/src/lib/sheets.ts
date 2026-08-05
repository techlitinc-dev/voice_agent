/**
 * Google Sheets export (spec §9). Appends CDR rows to a sheet tab via a service
 * account (googleapis). NOT configured => { ok:false, error:"not_configured" }.
 */
import { google } from "googleapis";

export function sheetsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SHEETS_CLIENT_EMAIL &&
    process.env.GOOGLE_SHEETS_PRIVATE_KEY &&
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
  );
}

/** Append rows to the first tab of the configured spreadsheet. Returns rows appended. */
export async function appendRowsToSheet(rows: string[][]): Promise<{ ok: boolean; appended?: number; error?: string }> {
  if (!sheetsConfigured()) return { ok: false, error: "not_configured" };
  try {
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      key: (process.env.GOOGLE_SHEETS_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID!,
      range: "A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows },
    });
    return { ok: true, appended: rows.length };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 300) };
  }
}
