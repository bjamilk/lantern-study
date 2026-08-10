import AsyncStorage from '@react-native-async-storage/async-storage';

const FAVORITE_PRICES_KEY = 'lantern_marketplace_favorite_prices';

/**
 * Price seen when the user favorited a listing, keyed by listing id — the
 * reference point for the "Price drop" badge on the Saved Listings screen.
 * Local-only: the server favorite records membership, not the price at the
 * time, so the comparison baseline has to live on the device.
 */
type PriceSnapshotMap = Record<string, number>;

async function read(): Promise<PriceSnapshotMap> {
  try {
    const raw = await AsyncStorage.getItem(FAVORITE_PRICES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function write(map: PriceSnapshotMap): Promise<void> {
  await AsyncStorage.setItem(FAVORITE_PRICES_KEY, JSON.stringify(map)).catch(() => {});
}

export async function snapshotFavoritePrice(listingId: string, price?: number | null): Promise<void> {
  if (price == null || !Number.isFinite(price)) return;
  const map = await read();
  map[listingId] = price;
  await write(map);
}

export async function forgetFavoritePrice(listingId: string): Promise<void> {
  const map = await read();
  if (listingId in map) {
    delete map[listingId];
    await write(map);
  }
}

export async function getFavoritePriceSnapshots(): Promise<PriceSnapshotMap> {
  return read();
}
