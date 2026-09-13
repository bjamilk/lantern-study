import { getSupabaseUrl } from "../config";

export const PRIVATE_STORAGE_BUCKETS = [
  "flashcard-images",
  "marketplace-images",
  "question-images",
  "note-files",
  "profile-avatars",
  "group-avatars",
  "job-resumes",
  // Deck / note cover images. Created by the service role on first upload, so
  // no dashboard step; listed here or every signed-URL request is denied by
  // the deny-by-default bucket gate.
  "cover-images",
] as const;

export type PrivateStorageBucket = (typeof PRIVATE_STORAGE_BUCKETS)[number];

export function isPrivateStorageBucket(
  bucket: string,
): bucket is PrivateStorageBucket {
  return (PRIVATE_STORAGE_BUCKETS as readonly string[]).includes(bucket);
}

/** Rewrite legacy localhost:54321 storage URLs to the configured Supabase URL. */
export function normalizeStorageUrl(url: string, supabaseUrl?: string): string {
  if (!url || url.startsWith("data:")) return url;
  // Avoid calling getConfig() for normal cloud URLs (Expo OTA may not inline env vars).
  if (!/https?:\/\/(localhost|127\.0\.0\.1):54321/i.test(url)) return url;
  const base = (supabaseUrl || getSupabaseUrl()).replace(/\/$/, "");
  return url.replace(/https?:\/\/(localhost|127\.0\.0\.1):54321/gi, base);
}

export function normalizeStorageUrls(
  urls?: string[] | null,
  supabaseUrl?: string,
): string[] {
  if (!urls?.length) return [];
  return urls.map((url) => normalizeStorageUrl(url, supabaseUrl));
}

/** Parse a Supabase storage object URL (public, signed, or legacy) into bucket + path. */
export function parseStorageObjectUrl(
  url: string,
): { bucket: string; path: string } | null {
  if (!url || url.startsWith("data:")) return null;
  try {
    const parsed = new URL(url);
    const marker = "/storage/v1/object/";
    const idx = parsed.pathname.indexOf(marker);
    if (idx === -1) return null;
    let after = parsed.pathname.slice(idx + marker.length);
    if (after.startsWith("sign/")) after = after.slice("sign/".length);
    if (after.startsWith("public/")) after = after.slice("public/".length);
    const parts = after.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const bucket = parts[0]!;
    const path = decodeURIComponent(parts.slice(1).join("/"));
    return { bucket, path };
  } catch {
    return null;
  }
}

/** The bucket every deck / note / study-set cover object lives in. */
export const COVER_IMAGE_BUCKET = "cover-images";

/** The three scopes `uploadCoverImage` writes under, i.e. path segment 2. */
const COVER_SCOPES = new Set(["decks", "notes", "study-sets"]);

/**
 * Bucket-qualify a legacy cover reference.
 *
 * Covers uploaded before this fix were persisted as the bare object path
 * `{ownerId}/{decks|notes|study-sets}/{id}/{ts}-name.webp` — no bucket segment
 * — so `parseStoredStorageRef` returned null, the caller fell through to
 * `normalizeStorageUrl`, and the RAW PATH reached an `<img>`/`<Image>`, which
 * draws an empty box. That is the blank deck/note/set tile.
 *
 * Applied on READ (in the API's projections) so rows already on production
 * render without a backfill. Anything already qualified, a full storage URL,
 * or not cover-shaped is returned unchanged.
 */
export function normalizeCoverRef<T extends string | null | undefined>(
  value: T,
): T {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  // Already a URL, a data/blob ref, or already bucket-qualified.
  if (/^(https?:)?\/\//i.test(trimmed)) return value;
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return value;
  if (trimmed.startsWith(`${COVER_IMAGE_BUCKET}/`)) return value;
  if (
    trimmed.includes("..") ||
    trimmed.startsWith("/") ||
    trimmed.includes("\\")
  ) {
    return value;
  }
  const parts = trimmed.split("/").filter(Boolean);
  // {owner}/{scope}/{id}/{file} — anything else is not a cover object, and a
  // ref already naming some OTHER bucket must not be rewritten.
  if (parts.length < 4) return value;
  if (isPrivateStorageBucket(parts[0]!)) return value;
  if (!COVER_SCOPES.has(parts[1]!)) return value;
  return `${COVER_IMAGE_BUCKET}/${trimmed}` as T;
}

/**
 * Parse a stored private-object reference for display or persist.
 * Accepts signed/unsigned storage URLs, `bucket/path`, bare marketplace
 * object paths (`{userId}/temp|shop|listings/...`) written by older clients,
 * and bare cover paths (`{userId}/decks|notes|study-sets/...`).
 */
export function parseStoredStorageRef(
  value: string,
): { bucket: string; path: string } | null {
  if (!value || value.startsWith("data:") || value.startsWith("blob:")) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("//")) {
    return parseStorageObjectUrl(trimmed);
  }

  const slash = trimmed.indexOf("/");
  if (slash <= 0) return null;
  const first = trimmed.slice(0, slash);
  const rest = trimmed.slice(slash + 1);
  if (!rest || rest.includes("..") || rest.startsWith("/")) return null;

  if (isPrivateStorageBucket(first)) {
    return { bucket: first, path: rest };
  }

  const kind = rest.split("/")[0];
  if (kind === "listings" || kind === "temp" || kind === "shop") {
    return { bucket: "marketplace-images", path: trimmed };
  }

  // Legacy bucket-less cover path, still stored in rows written before covers
  // were persisted bucket-qualified.
  const qualified = normalizeCoverRef(trimmed);
  if (qualified !== trimmed) {
    return {
      bucket: COVER_IMAGE_BUCKET,
      path: qualified.slice(COVER_IMAGE_BUCKET.length + 1),
    };
  }

  return null;
}

/** Stable unsigned marketplace object URL to persist (never a signed URL or bare path). */
export function toPersistedMarketplaceImageUrl(
  raw: string,
  opts: { ownerId: string; supabaseUrl: string },
): string | null {
  const parsed = parseStoredStorageRef(raw);
  if (!parsed || parsed.bucket !== "marketplace-images") return null;
  const owner = opts.ownerId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!owner || !parsed.path.startsWith(`${owner}/`)) return null;
  if (
    parsed.path.includes("..") ||
    parsed.path.startsWith("/") ||
    parsed.path.includes("\\")
  ) {
    return null;
  }
  const base = opts.supabaseUrl.replace(/\/$/, "");
  if (!base) return null;
  return `${base}/storage/v1/object/${parsed.bucket}/${parsed.path}`;
}

export function buildStorageObjectPath(bucket: string, path: string): string {
  return `${bucket}/${path}`;
}

/**
 * Deterministic grid/list thumbnail path for a stored image object.
 * Sibling file: `<path>.thumb.webp` (matches marketplace upload convention).
 */
export function storageThumbPath(path: string): string {
  if (!path) return path;
  if (path.endsWith(".thumb.webp")) return path;
  return `${path}.thumb.webp`;
}

/** True when the storage object path is itself a generated thumbnail. */
export function isStorageThumbPath(path: string): boolean {
  return Boolean(path && path.endsWith(".thumb.webp"));
}
