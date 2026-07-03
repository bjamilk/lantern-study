import type { SupabaseService } from './supabase';
import { logger } from '../utils/logger';

const INTERVAL_MS = parseInt(process.env.MARKETPLACE_ALERTS_INTERVAL_MS || '900000', 10);

function listingMatchesFilters(
  listing: Record<string, unknown>,
  filters: Record<string, unknown>
): boolean {
  if (filters.category && listing.category !== filters.category) return false;
  if (filters.search) {
    const term = String(filters.search).toLowerCase();
    const title = String(listing.title || '').toLowerCase();
    const description = String(listing.description || '').toLowerCase();
    if (!title.includes(term) && !description.includes(term)) return false;
  }
  if (filters.minPrice != null && Number(listing.price) < Number(filters.minPrice)) return false;
  if (filters.maxPrice != null && Number(listing.price) > Number(filters.maxPrice)) return false;
  if (filters.location) {
    const loc = String(listing.location || '').toLowerCase();
    if (!loc.includes(String(filters.location).toLowerCase())) return false;
  }
  return true;
}

export async function processSavedSearchAlerts(supabaseService: SupabaseService): Promise<number> {
  const db = supabaseService.getClient();
  const { data: searches, error } = await db
    .from('saved_searches')
    .select('*')
    .eq('notify', true);

  if (error) {
    logger.error('Failed to load saved searches for alerts', { error: error.message });
    return 0;
  }

  let sent = 0;
  const now = new Date().toISOString();

  for (const search of searches || []) {
    const since = search.last_checked_at || search.created_at;
    const { data: listings, error: listErr } = await db
      .from('marketplace_listings')
      .select('id, title, price, category, location, description, created_at')
      .eq('status', 'active')
      .gt('created_at', since)
      .order('created_at', { ascending: false })
      .limit(50);

    if (listErr) {
      logger.warn('Saved search listing query failed', { searchId: search.id, listErr });
      continue;
    }

    const filters = (search.filters || {}) as Record<string, unknown>;
    const matches = (listings || []).filter((l) => listingMatchesFilters(l, filters)).slice(0, 5);

    if (matches.length === 0) {
      await db.from('saved_searches').update({ last_checked_at: now }).eq('id', search.id);
      continue;
    }

    const listingIds = matches.map((l) => l.id);
    const { data: existingNotifications } = await db
      .from('notifications')
      .select('data')
      .eq('user_id', search.user_id)
      .eq('type', 'saved_search_match');

    const existingListingIds = new Set<string>();
    for (const n of existingNotifications || []) {
      const data = (n.data ?? null) as Record<string, unknown> | null;
      if (!data) continue;
      if (data.saved_search_id === search.id && typeof data.listing_id === 'string') {
        existingListingIds.add(data.listing_id);
      }
    }

    for (const listing of matches) {
      if (existingListingIds.has(listing.id)) continue;

      const notification = await supabaseService.createNotification(search.user_id, {
        type: 'saved_search_match',
        message: `New match for "${search.name}": ${listing.title}`,
        link: `marketplace:listing:${listing.id}`,
        data: {
          saved_search_id: search.id,
          listing_id: listing.id,
        },
      });

      if (notification) sent += 1;
    }

    await db
      .from('saved_searches')
      .update({ last_checked_at: now })
      .eq('id', search.id);
  }

  if (sent > 0) {
    logger.info('Saved search marketplace alerts sent', { count: sent });
  }
  return sent;
}

export async function processReviewReminders(supabaseService: SupabaseService): Promise<number> {
  const db = supabaseService.getClient();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoff = sevenDaysAgo.toISOString();

  const { data: orders, error } = await db
    .from('marketplace_orders')
    .select('id, buyer_id, listing_id, completed_at, listing:marketplace_listings(title)')
    .eq('status', 'completed')
    .lt('completed_at', cutoff)
    .gte('completed_at', new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString());

  if (error || !orders?.length) return 0;

  let sent = 0;
  for (const order of orders) {
    const listingRaw = order.listing as { title?: string } | { title?: string }[] | null;
    const listing = Array.isArray(listingRaw) ? listingRaw[0] : listingRaw;
    const { data: review } = await db
      .from('marketplace_reviews')
      .select('id')
      .eq('listing_id', order.listing_id)
      .eq('reviewer_id', order.buyer_id)
      .limit(1);

    if (review && review.length > 0) continue;

    const { data: reminded } = await db
      .from('notifications')
      .select('id')
      .eq('user_id', order.buyer_id)
      .eq('type', 'marketplace_review_prompt')
      .contains('data', { orderId: order.id, reminder: true })
      .limit(1);

    if (reminded && reminded.length > 0) continue;

    const notification = await supabaseService.createNotification(order.buyer_id, {
      type: 'marketplace_review_prompt',
      message: `Reminder: review your purchase of "${listing?.title || 'your item'}"`,
      link: `marketplace:listing:${order.listing_id}:review`,
      data: { orderId: order.id, listingId: order.listing_id, reminder: true },
    });
    if (notification) sent += 1;
  }
  return sent;
}

const ABANDONED_ORDER_MINUTES = parseInt(process.env.MARKETPLACE_ABANDONED_ORDER_MINUTES || '45', 10);
const STALE_OFFER_HOURS = parseInt(process.env.MARKETPLACE_STALE_OFFER_HOURS || '24', 10);
const OFFER_EXPIRY_WARNING_HOURS = parseInt(process.env.MARKETPLACE_OFFER_EXPIRY_WARNING_HOURS || '6', 10);

export async function processAbandonedCheckoutReminders(
  supabaseService: SupabaseService
): Promise<number> {
  const db = supabaseService.getClient();
  const cutoff = new Date(Date.now() - ABANDONED_ORDER_MINUTES * 60 * 1000).toISOString();

  const { data: orders, error } = await db
    .from('marketplace_orders')
    .select('id, buyer_id, listing_id, created_at, listing:marketplace_listings(title)')
    .eq('status', 'pending_payment')
    .lt('created_at', cutoff);

  if (error || !orders?.length) return 0;

  let sent = 0;
  for (const order of orders) {
    const listingRaw = order.listing as { title?: string } | { title?: string }[] | null;
    const listing = Array.isArray(listingRaw) ? listingRaw[0] : listingRaw;

    const { data: reminded } = await db
      .from('notifications')
      .select('id')
      .eq('user_id', order.buyer_id)
      .eq('type', 'marketplace_abandoned_reminder')
      .contains('data', { orderId: order.id })
      .limit(1);

    if (reminded && reminded.length > 0) continue;

    const notification = await supabaseService.createNotification(order.buyer_id, {
      type: 'marketplace_abandoned_reminder',
      message: `Still interested in "${listing?.title || 'this item'}"? Complete your order.`,
      link: `marketplace:order:${order.id}`,
      data: { orderId: order.id, listingId: order.listing_id, abandoned: true },
    });
    if (notification) sent += 1;
  }

  if (sent > 0) {
    logger.info('Abandoned checkout reminders sent', { count: sent });
  }
  return sent;
}

export async function processStaleOfferReminders(supabaseService: SupabaseService): Promise<number> {
  const db = supabaseService.getClient();
  const staleCutoff = new Date(Date.now() - STALE_OFFER_HOURS * 60 * 60 * 1000).toISOString();
  const expirySoon = new Date(Date.now() + OFFER_EXPIRY_WARNING_HOURS * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  let sent = 0;

  const { data: staleForSeller, error: sellerErr } = await db
    .from('marketplace_offers')
    .select('id, seller_id, buyer_id, amount, listing_id, listing:marketplace_listings(title)')
    .eq('status', 'pending')
    .lt('created_at', staleCutoff);

  if (!sellerErr && staleForSeller?.length) {
    for (const offer of staleForSeller) {
      const listingRaw = offer.listing as { title?: string } | { title?: string }[] | null;
      const listing = Array.isArray(listingRaw) ? listingRaw[0] : listingRaw;

      const { data: reminded } = await db
        .from('notifications')
        .select('id')
        .eq('user_id', offer.seller_id)
        .eq('type', 'marketplace_offer_reminder')
        .contains('data', { offerId: offer.id, audience: 'seller' })
        .limit(1);

      if (reminded && reminded.length > 0) continue;

      const notification = await supabaseService.createNotification(offer.seller_id, {
        type: 'marketplace_offer_reminder',
        message: `Pending offer of ₦${Number(offer.amount).toLocaleString()} on "${listing?.title || 'your listing'}" — respond to close the deal.`,
        link: `marketplace:offer:${offer.id}`,
        data: { offerId: offer.id, listingId: offer.listing_id, audience: 'seller' },
      });
      if (notification) sent += 1;
    }
  }

  const { data: expiringForBuyer, error: buyerErr } = await db
    .from('marketplace_offers')
    .select('id, buyer_id, amount, listing_id, expires_at, listing:marketplace_listings(title)')
    .eq('status', 'pending')
    .gt('expires_at', now)
    .lt('expires_at', expirySoon);

  if (!buyerErr && expiringForBuyer?.length) {
    for (const offer of expiringForBuyer) {
      const listingRaw = offer.listing as { title?: string } | { title?: string }[] | null;
      const listing = Array.isArray(listingRaw) ? listingRaw[0] : listingRaw;

      const { data: reminded } = await db
        .from('notifications')
        .select('id')
        .eq('user_id', offer.buyer_id)
        .eq('type', 'marketplace_offer_reminder')
        .contains('data', { offerId: offer.id, audience: 'buyer' })
        .limit(1);

      if (reminded && reminded.length > 0) continue;

      const notification = await supabaseService.createNotification(offer.buyer_id, {
        type: 'marketplace_offer_reminder',
        message: `Your offer on "${listing?.title || 'a listing'}" expires soon — follow up with the seller.`,
        link: `marketplace:offer:${offer.id}`,
        data: { offerId: offer.id, listingId: offer.listing_id, audience: 'buyer', expiring: true },
      });
      if (notification) sent += 1;
    }
  }

  if (sent > 0) {
    logger.info('Stale offer reminders sent', { count: sent });
  }
  return sent;
}

export function startMarketplaceAlertJobs(supabaseService: SupabaseService): void {
  if (process.env.ENABLE_MARKETPLACE_JOBS !== 'true') {
    logger.info('Marketplace alert jobs disabled (set ENABLE_MARKETPLACE_JOBS=true to enable)');
    return;
  }

  const run = async () => {
    try {
      await processSavedSearchAlerts(supabaseService);
      await processAbandonedCheckoutReminders(supabaseService);
      await processStaleOfferReminders(supabaseService);
      await processReviewReminders(supabaseService);
    } catch (err) {
      logger.error('Marketplace alert job failed', err);
    }
  };

  void run();
  setInterval(() => void run(), INTERVAL_MS);
  logger.info('Marketplace alert jobs scheduled', { intervalMs: INTERVAL_MS });
}
