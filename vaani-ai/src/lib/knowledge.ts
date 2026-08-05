import mime from "mime-types";

export const KB_ACCEPT = [".pdf", ".docx"];
export const KB_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/** MinIO key for an uploaded KB file. */
export function kbStorageKey(workspaceId: string, docId: string, filename: string): string {
  const safe = filename.toLowerCase().replace(/[^a-z0-9.]+/g, "-").slice(-60);
  return `${workspaceId}/${docId}/${safe}`;
}

export function kbContentType(filename: string): string {
  return mime.lookup(filename) || "application/octet-stream";
}

export function validateKbUpload(filename: string, sizeBytes: number): { ok: true } | { ok: false; error: string } {
  const lower = filename.toLowerCase();
  if (!KB_ACCEPT.some((ext) => lower.endsWith(ext))) {
    return { ok: false, error: `Only ${KB_ACCEPT.join(" and ")} files are supported (FAQ text and URLs use their own forms).` };
  }
  if (sizeBytes > KB_MAX_BYTES) return { ok: false, error: "File too large (max 10 MB)." };
  if (sizeBytes === 0) return { ok: false, error: "Empty file." };
  return { ok: true };
}

/** Naive HTML → text for URL documents (good enough for FAQ/pricing pages). */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50000);
}

/** Fetch + extract text from a URL document. Throws on network errors. */
export async function fetchUrlText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`URL fetch failed: HTTP ${res.status}`);
  const text = htmlToText(await res.text());
  if (text.length < 20) throw new Error("Page had no usable text content.");
  return text;
}

/**
 * OPERATOR GATE — see Step 10 note. When Dograh ships a KB API, implement the push
 * here and flip status to INDEXED on success; the re-index worker (Step 11) already
 * calls this.
 */
export async function pushToDograhKnowledgeBase(_doc: {
  id: string;
  title: string;
  type: string;
  contentText: string | null;
  storageKey: string | null;
}): Promise<{ pushed: false; reason: string }> {
  return { pushed: false, reason: "Dograh KB API not available — manual sync via Dograh UI (OPERATOR GATE, guide 05 Step 10)." };
}
