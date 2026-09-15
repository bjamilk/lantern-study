/**
 * Device-local recent Shop search queries, rendered as one-tap chips under the
 * search box.
 *
 * Exports: addRecentMarketplaceSearch, getRecentMarketplaceSearches,
 * clearRecentMarketplaceSearches.
 * Touches: AsyncStorage key `lantern_marketplace_recent_searches`; newest
 * first, case-insensitively deduped, capped at MAX_RECENT (8).
 *
 * Gotchas: queries shorter than two characters are dropped silently, and all
 * failures are swallowed. The key carries no user id, so history survives an
 * account switch on the same device.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const RECENT_SEARCHES_KEY = 'lantern_marketplace_recent_searches';
const MAX_RECENT = 8;

/**
 * Local-only recent search queries, shown as one-tap chips under the search
 * box. Same shape as marketplaceRecentlyViewed: newest first, deduped,
 * capped, and never worth failing over.
 */
export async function addRecentMarketplaceSearch(query: string): Promise<void> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return;
  try {
    const raw = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
    const queries: string[] = raw ? JSON.parse(raw) : [];
    const next = [
      trimmed,
      ...queries.filter(q => q.toLowerCase() !== trimmed.toLowerCase()),
    ].slice(0, MAX_RECENT);
    await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    // non-critical
  }
}

export async function getRecentMarketplaceSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function clearRecentMarketplaceSearches(): Promise<void> {
  await AsyncStorage.removeItem(RECENT_SEARCHES_KEY).catch(() => {});
}
