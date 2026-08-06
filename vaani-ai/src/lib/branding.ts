/**
 * White-label branding helpers (readme §3.1). Pure — unit-tested.
 * The app shell (guide 10 layout) injects the workspace brand color as the
 * shadcn `--primary` HSL triplet (guide 01 globals.css: `--primary: 174 72% 46%`).
 */

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_RE.test(value);
}

/** Convert "#rrggbb" → "H S% L%" triplet for the CSS var. Returns null on bad input. */
export function hexToHslTriplet(hex: string): string | null {
  if (!isValidHexColor(hex)) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return `0 0% ${Math.round(l * 100)}%`;
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  } else if (max === g) {
    h = ((b - r) / d + 2) * 60;
  } else {
    h = ((r - g) / d + 4) * 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** MinIO object key for a workspace logo (extension preserved, lowercased). */
export function logoStorageKey(workspaceId: string, filename: string): string {
  const ext = (filename.split(".").pop() ?? "png").toLowerCase();
  return `branding/${workspaceId}/logo.${ext}`;
}

const LOGO_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export const LOGO_MAX_BYTES = 512 * 1024; // 512 KB

export function validateLogoUpload(
  filename: string,
  sizeBytes: number,
): { ok: true } | { ok: false; error: string } {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  if (!LOGO_TYPES[ext]) {
    return { ok: false, error: "Logo must be a PNG, JPG, WEBP or SVG file." };
  }
  if (sizeBytes <= 0) return { ok: false, error: "File is empty." };
  if (sizeBytes > LOGO_MAX_BYTES) {
    return { ok: false, error: "Logo must be under 512 KB." };
  }
  return { ok: true };
}

export function logoContentType(filename: string): string {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  return LOGO_TYPES[ext] ?? "application/octet-stream";
}
