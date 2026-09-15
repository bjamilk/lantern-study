/**
 * Device-local list of listing ids the user recently opened, used to build the
 * "Recently viewed" rail on Shop home.
 *
 * Exports: addRecentlyViewedListing, getRecentlyViewedListingIds,
 * clearRecentlyViewedListings.
 * Touches: AsyncStorage key `lantern_marketplace_recently_viewed`; newest
 * first, deduped, capped at MAX_RECENT (10).
 *
 * Gotchas: stores ids only, so the caller must refetch each listing and cope
 * with ones that were deleted or sold. The key carries no user id, so the list
 * survives an account switch on the same device.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const RECENTLY_VIEWED_KEY = 'lantern_marketplace_recently_viewed';
const MAX_RECENT = 10;

export async function addRecentlyViewedListing(listingId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(RECENTLY_VIEWED_KEY);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    const next = [listingId, ...ids.filter(id => id !== listingId)].slice(0, MAX_RECENT);
    await AsyncStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(next));
  } catch {
    // non-critical
  }
}

export async function getRecentlyViewedListingIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENTLY_VIEWED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function clearRecentlyViewedListings(): Promise<void> {
  await AsyncStorage.removeItem(RECENTLY_VIEWED_KEY).catch(() => {});
}
