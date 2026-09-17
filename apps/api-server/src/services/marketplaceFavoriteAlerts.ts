/**
 * FLIPPED (monolith lane M3, Phase B): takes `MarketplaceServiceHost` — the
 * shared, narrow host of the money cluster — instead of the whole
 * `SupabaseService`. See `services/marketplaceServiceHost.ts` for why the six
 * money services share one type and how the last facade-side callers adapt.
 */
import type { MarketplaceServiceHost } from './marketplaceServiceHost';
import { resolveEffectivePrice } from './marketplaceOrders';
import { logger } from '../utils/logger';

async function notifyFavoriters(
  host: MarketplaceServiceHost,
  listingId: string,
  sellerId: string,
  payload: {
    type: string;
    message: string;
    dataKey: string;
    dataExtra?: Record<string, unknown>;
  }
): Promise<number> {
  const db = host.getClient();
  const { data: favorites, error } = await db
    .from('marketplace_favorites')
    .select('user_id')
    .eq('listing_id', listingId);

  if (error || !favorites?.length) return 0;

  let sent = 0;
  for (const fav of favorites) {
    if (fav.user_id === sellerId) continue;

    const { data: existing } = await db
      .from('notifications')
      .select('id')
      .eq('user_id', fav.user_id)
      .eq('type', payload.type)
      .contains('data', { listing_id: listingId, [payload.dataKey]: true })
      .limit(1);

    if (existing && existing.length > 0) continue;

    const notification = await host.notifications.createNotification(fav.user_id, {
      type: payload.type,
      message: payload.message,
      link: `marketplace:listing:${listingId}`,
      data: {
        listing_id: listingId,
        [payload.dataKey]: true,
        ...payload.dataExtra,
      },
    });
    if (notification) sent += 1;
  }
  return sent;
}

export async function notifyListingBackAvailable(
  host: MarketplaceServiceHost,
  listing: { id: string; user_id: string; title: string },
  previousStatus: string
): Promise<void> {
  if (!['sold', 'inactive'].includes(previousStatus)) return;

  try {
    const sent = await notifyFavoriters(host, listing.id, listing.user_id, {
      type: 'marketplace_favorite_alert',
      message: `Back available: "${listing.title}" is listed again`,
      dataKey: 'back_available',
    });
    if (sent > 0) {
      logger.info('Back-available favorite alerts sent', { listingId: listing.id, sent });
    }
  } catch (err) {
    logger.warn('Failed to send back-available alerts', err);
  }
}

export async function notifyFavoritePriceDrop(
  host: MarketplaceServiceHost,
  listing: {
    id: string;
    user_id: string;
    title: string;
    price?: number | null;
    sale_price?: number | null;
    sale_ends_at?: string | null;
  },
  previousListing: {
    price?: number | null;
    sale_price?: number | null;
    sale_ends_at?: string | null;
  }
): Promise<void> {
  const prevEffective = resolveEffectivePrice(previousListing);
  const nextEffective = resolveEffectivePrice(listing);
  if (nextEffective >= prevEffective || prevEffective <= 0) return;

  try {
    const sent = await notifyFavoriters(host, listing.id, listing.user_id, {
      type: 'marketplace_favorite_alert',
      message: `Price drop on "${listing.title}": now ₦${nextEffective.toLocaleString()} (was ₦${prevEffective.toLocaleString()})`,
      dataKey: 'price_drop',
      dataExtra: {
        previous_price: prevEffective,
        new_price: nextEffective,
      },
    });
    if (sent > 0) {
      logger.info('Favorite price-drop alerts sent', { listingId: listing.id, sent });
    }
  } catch (err) {
    logger.warn('Failed to send price-drop alerts', err);
  }
}
