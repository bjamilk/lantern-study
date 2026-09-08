// ===========================================
// Lantern Study Mobile - The courses you already have
// ===========================================
/**
 * "My courses" offline.
 *
 * The archive tree is fetched on every focus, and offline that fetch is the
 * only thing standing between the student and a list they have opened a
 * hundred times. The audit caught the result: a spinner in the "My courses"
 * header that never stopped, and — once expanded — the raw sentence
 * "Could not load your courses: Network request failed", on a screen that was
 * simultaneously drawing an offline icon and serving every cached note below.
 *
 * A course list is not volatile. Keeping the last one we were given costs a
 * few kilobytes and turns an offline dead end into the same screen, dated.
 * The rule this file encodes: never show an empty tree we do not believe in —
 * a cache miss is "we haven't got this yet", not "you have no courses".
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LibraryOverview } from '@lantern/shared/types';

const KEY_PREFIX = 'lantern_library_overview_v1';

/** Per user: two accounts on one phone must never see each other's courses. */
export function libraryOverviewCacheKey(userId: string): string {
  return `${KEY_PREFIX}:${userId}`;
}

export interface CachedLibraryOverview {
  overview: LibraryOverview;
  /** When the server last gave us this, epoch ms. */
  savedAt: number;
}

/**
 * Parse a stored blob back into an overview.
 *
 * Anything we cannot recognise returns null rather than throwing: a cache is
 * a convenience, and a corrupt one must not be able to take the screen down.
 */
export function parseCachedOverview(raw: string | null | undefined): CachedLibraryOverview | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const overview = (parsed as { overview?: unknown }).overview;
    if (!overview || typeof overview !== 'object') return null;
    const savedAtRaw = (parsed as { savedAt?: unknown }).savedAt;
    const savedAt = typeof savedAtRaw === 'number' && Number.isFinite(savedAtRaw) ? savedAtRaw : 0;
    return { overview: overview as LibraryOverview, savedAt };
  } catch {
    return null;
  }
}

export function serializeCachedOverview(
  overview: LibraryOverview,
  savedAt: number = Date.now(),
): string {
  return JSON.stringify({ overview, savedAt });
}

export async function readCachedOverview(userId: string): Promise<CachedLibraryOverview | null> {
  try {
    return parseCachedOverview(await AsyncStorage.getItem(libraryOverviewCacheKey(userId)));
  } catch {
    return null;
  }
}

export async function writeCachedOverview(
  userId: string,
  overview: LibraryOverview,
): Promise<void> {
  try {
    await AsyncStorage.setItem(libraryOverviewCacheKey(userId), serializeCachedOverview(overview));
  } catch {
    // A full disk must not break a load that already succeeded.
  }
}
