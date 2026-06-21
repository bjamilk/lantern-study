import { getSupabaseUrl } from '../config';

/** Rewrite legacy localhost:54321 storage URLs to the configured Supabase URL. */
export function normalizeStorageUrl(url: string, supabaseUrl?: string): string {
  if (!url || url.startsWith('data:')) return url;
  const base = (supabaseUrl || getSupabaseUrl()).replace(/\/$/, '');
  return url.replace(/https?:\/\/(localhost|127\.0\.0\.1):54321/gi, base);
}

export function normalizeStorageUrls(urls?: string[] | null, supabaseUrl?: string): string[] {
  if (!urls?.length) return [];
  return urls.map((url) => normalizeStorageUrl(url, supabaseUrl));
}
