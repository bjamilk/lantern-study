import type { DataLayer } from './data';
import { bestEffortWrite } from './data/writeResult';
import { logger } from '../utils/logger';

export async function notifySellerFavoriteMilestone(
  layer: DataLayer,
  listingId: string
): Promise<void> {
  const db = layer.getClient();

  const { data: listing, error: listingErr } = await db
    .from('marketplace_listings')
    .select('id, user_id, title, status')
    .eq('id', listingId)
    .single();

  if (listingErr || !listing || listing.status !== 'active') return;

  const { count, error: countErr } = await db
    .from('marketplace_favorites')
    .select('id', { count: 'exact', head: true })
    .eq('listing_id', listingId);

  if (countErr || !count) return;

  const { data: prefs } = await db
    .from('marketplace_seller_preferences')
    .select('favorite_alert_threshold')
    .eq('seller_id', listing.user_id)
    .maybeSingle();

  const threshold = prefs?.favorite_alert_threshold ?? 3;
  const milestones = [threshold, threshold * 2, threshold * 5].filter((m) => count >= m);

  for (const milestone of milestones) {
    const { data: existing } = await db
      .from('marketplace_favorite_milestones')
      .select('listing_id')
      .eq('listing_id', listingId)
      .eq('milestone', milestone)
      .maybeSingle();

    if (existing) continue;

    // BEST EFFORT (#108): the dedupe row for a seller nudge. Losing it can
    // repeat one nudge on a later run; it cannot lose one.
    bestEffortWrite(
      await db.from('marketplace_favorite_milestones').insert({
        listing_id: listingId,
        milestone,
      }),
      { table: 'marketplace_favorite_milestones', op: 'insert', listingId, milestone },
    );

    await layer.notifications.createNotification(listing.user_id, {
      type: 'marketplace_favorite_milestone',
      message: `${milestone} students saved "${listing.title}" — consider a promo to convert interest.`,
      link: `marketplace:listing:${listingId}`,
      data: { listingId, milestone, favoritesCount: count },
    });

    logger.info('Seller favorite milestone notified', { listingId, milestone, count });
  }
}
