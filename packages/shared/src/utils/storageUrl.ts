import { getSupabaseUrl } from '../config';

export const PRIVATE_STORAGE_BUCKETS = [
  'flashcard-images',
  'marketplace-images',
  'question-images',
  'note-files',
  'profile-avatars',
] as const;

export type PrivateStorageBucket = (typeof PRIVATE_STORAGE_BUCKETS)[number];

export function isPrivateStorageBucket(bucket: string): bucket is PrivateStorageBucket {
  return (PRIVATE_STORAGE_BUCKETS as readonly string[]).includes(bucket);
}

/** Rewrite legacy localhost:54321 storage URLs to the configured Supabase URL. */
export function normalizeStorageUrl(url: string, supabaseUrl?: string): string {
  if (!url || url.startsWith('data:')) return url;
  // Avoid calling getConfig() for normal cloud URLs (Expo OTA may not inline env vars).
  if (!/https?:\/\/(localhost|127\.0\.0\.1):54321/i.test(url)) return url;
  const base = (supabaseUrl || getSupabaseUrl()).replace(/\/$/, '');
  return url.replace(/https?:\/\/(localhost|127\.0\.0\.1):54321/gi, base);
}

export function normalizeStorageUrls(urls?: string[] | null, supabaseUrl?: string): string[] {
  if (!urls?.length) return [];
  return urls.map((url) => normalizeStorageUrl(url, supabaseUrl));
}

/** Parse a Supabase storage object URL (public, signed, or legacy) into bucket + path. */
export function parseStorageObjectUrl(url: string): { bucket: string; path: string } | null {
  if (!url || url.startsWith('data:')) return null;
  try {
    const parsed = new URL(url);
    const marker = '/storage/v1/object/';
    const idx = parsed.pathname.indexOf(marker);
    if (idx === -1) return null;
    let after = parsed.pathname.slice(idx + marker.length);
    if (after.startsWith('sign/')) after = after.slice('sign/'.length);
    if (after.startsWith('public/')) after = after.slice('public/'.length);
    const parts = after.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const bucket = parts[0]!;
    const path = decodeURIComponent(parts.slice(1).join('/'));
    return { bucket, path };
  } catch {
    return null;
  }
}

export function buildStorageObjectPath(bucket: string, path: string): string {
  return `${bucket}/${path}`;
}
