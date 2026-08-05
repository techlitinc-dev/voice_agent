"use server";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { appendRowsToSheet, sheetsConfigured } from "@/lib/sheets";

/** Push the last 100 calls to the configured Google Sheet. */
export async function exportCallsToSheet() {
  try {
    const ctx = await requirePermission("calls:read");
    if (!sheetsConfigured()) {
      return { ok: false as const, error: "Google Sheets not configured — set GOOGLE_SHEETS_* env vars (see guide 08 Step 25)" };
    }
    const calls = await db.call.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { agent: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const rows = calls.map((c) => [
      c.createdAt.toISOString(), c.direction, c.status, c.fromNumber, c.toNumber,
      c.agent?.name ?? "", String(c.durationSec), c.outcome ?? "", c.sentiment ?? "",
      String(c.billedPaise), c.summary ?? "",
    ]);
    const result = await appendRowsToSheet(rows);
    if (!result.ok) return { ok: false as const, error: result.error ?? "Sheets error" };
    await db.auditLog.create({
      data: { workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "sheets.exported", entity: "Call", metadata: { rows: result.appended } },
    });
    return { ok: true as const, appended: result.appended ?? 0 };
  } catch (e) {
    if (e instanceof Error && e.message === "FORBIDDEN") {
      return { ok: false as const, error: "Forbidden — your role lacks the calls:read permission" };
    }
    console.error("exportCallsToSheet", e);
    return { ok: false as const, error: "Export failed" };
  }
}
