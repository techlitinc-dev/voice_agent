import { db } from "./db";

/** Normalize a user search string: trim, collapse whitespace, cap length. */
export function normalizeSearchQuery(input: string, maxLen = 200): string {
  return input.trim().replace(/\s+/g, " ").slice(0, maxLen);
}

/**
 * Full-text search over Call.transcript (generated tsvector column `transcriptTsv`,
 * GIN-indexed). Returns matching call ids, best rank first. Tenant-scoped ALWAYS.
 *
 * `plainto_tsquery` treats the input as plain text (ANDs the words) — user input can
 * never inject tsquery operators.
 *
 * If the FTS migration has not been applied yet, returns [] and logs — the calls
 * page must keep working on a pre-migration database.
 */
export async function searchCallIdsByTranscript(
  workspaceId: string,
  rawQuery: string,
  limit = 50,
): Promise<string[]> {
  const q = normalizeSearchQuery(rawQuery);
  if (q.length === 0) return [];
  try {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "Call"
      WHERE "workspaceId" = ${workspaceId}
        AND "transcriptTsv" @@ plainto_tsquery('english', ${q})
      ORDER BY ts_rank("transcriptTsv", plainto_tsquery('english', ${q})) DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => r.id);
  } catch (e) {
    console.error("[fts] transcript search failed (migration applied?)", String(e).slice(0, 200));
    return [];
  }
}
