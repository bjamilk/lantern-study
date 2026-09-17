/**
 * FLIPPED (monolith lane M3, Phase B): takes `MarketplaceServiceHost` — the
 * shared, narrow host of the money cluster — instead of the whole
 * `SupabaseService`. See `services/marketplaceServiceHost.ts` for why the six
 * money services share one type and how the last facade-side callers adapt.
 */
import {
  isPrivateStorageBucket,
  parseStoredStorageRef,
  toPersistedMarketplaceImageUrl,
} from '@lantern/shared/utils/storageUrl';
import { bestEffortWrite } from './data/writeResult';
import type { MarketplaceServiceHost } from './marketplaceServiceHost';
import { PublicError } from '../utils/safeError';
import { logger } from '../utils/logger';

const MAX_CAMPAIGN_RECIPIENTS = 25;
const DAILY_CAMPAIGN_CAP = 50;

export type MarketplaceBundleItem = {
  listing_id?: string;
  title: string;
  price?: number;
};

export type SellerPreferencesRow = {
  seller_id: string;
  hall_dropoff_enabled: boolean;
  hall_dropoff_min_amount?: number | null;
  shipping_enabled?: boolean;
  shipping_fee_naira?: number | null;
  shipping_free_over_naira?: number | null;
  ships_from_campus_id?: string | null;
  ships_from_city?: string | null;
  onboarding_completed_at?: string | null;
  boost_credits: number;
  require_payment_confirmation: boolean;
  favorite_alert_threshold: number;
  shop_name?: string | null;
  shop_bio?: string | null;
  cover_image_url?: string | null;
  shop_updated_at?: string | null;
  updated_at: string;
};

export type SellerShopPublic = {
  shopName: string;
  bio: string | null;
  coverImageUrl: string | null;
};

export type MarketplaceShopCard = {
  sellerId: string;
  shopName: string;
  bio: string | null;
  coverImageUrl: string | null;
  avatarUrl: string | null;
  activeListingCount: number;
  avgRating: number;
  totalReviews: number;
  campusId: string | null;
  campusLabel: string | null;
  lastListingAt: string | null;
};

export type PickupNudge = {
  enabled: boolean;
  minAmount: number;
  buyerSpentWithSeller: number;
  remainingAmount: number;
  message: string | null;
};

export class MarketplaceSellerToolsService {
  constructor(private readonly host: MarketplaceServiceHost) {}

  private get db() {
    return this.host.getClient();
  }

  private defaultPreferences(sellerId: string): SellerPreferencesRow {
    return {
      seller_id: sellerId,
      hall_dropoff_enabled: false,
      hall_dropoff_min_amount: null,
      shipping_enabled: false,
      shipping_fee_naira: null,
      shipping_free_over_naira: null,
      ships_from_campus_id: null,
      ships_from_city: null,
      onboarding_completed_at: null,
      boost_credits: 1,
      require_payment_confirmation: false,
      favorite_alert_threshold: 3,
      shop_name: null,
      shop_bio: null,
      cover_image_url: null,
      shop_updated_at: null,
      updated_at: new Date().toISOString(),
    };
  }

  publicFulfillment(prefs: SellerPreferencesRow, sellerId: string) {
    const fee = Number(prefs.shipping_fee_naira);
    const freeOver = Number(prefs.shipping_free_over_naira);
    return {
      sellerId,
      campusMeetup: true as const,
      hallDropoffEnabled: Boolean(prefs.hall_dropoff_enabled),
      hallDropoffMinAmount: prefs.hall_dropoff_min_amount ?? null,
      shippingEnabled: Boolean(prefs.shipping_enabled),
      shippingFeeNaira: Number.isFinite(fee) && fee > 0 ? fee : 0,
      shippingFreeOverNaira: Number.isFinite(freeOver) && freeOver > 0 ? freeOver : null,
      shipsFromCampusId: prefs.ships_from_campus_id ?? null,
      shipsFromCity: prefs.ships_from_city ?? null,
    };
  }

  async getPublicFulfillment(sellerId: string) {
    return this.publicFulfillment(await this.getPreferences(sellerId), sellerId);
  }

  async getPreferences(sellerId: string): Promise<SellerPreferencesRow> {
    const { data } = await this.db
      .from('marketplace_seller_preferences')
      .select('*')
      .eq('seller_id', sellerId)
      .maybeSingle();

    return (data as SellerPreferencesRow) || this.defaultPreferences(sellerId);
  }

  private prefsUpsertPayload(current: SellerPreferencesRow, overrides: Partial<SellerPreferencesRow> = {}) {
    return {
      seller_id: current.seller_id,
      hall_dropoff_enabled: overrides.hall_dropoff_enabled ?? current.hall_dropoff_enabled,
      hall_dropoff_min_amount:
        overrides.hall_dropoff_min_amount !== undefined
          ? overrides.hall_dropoff_min_amount
          : current.hall_dropoff_min_amount,
      shipping_enabled: overrides.shipping_enabled ?? current.shipping_enabled ?? false,
      shipping_fee_naira:
        overrides.shipping_fee_naira !== undefined ? overrides.shipping_fee_naira : current.shipping_fee_naira,
      shipping_free_over_naira:
        overrides.shipping_free_over_naira !== undefined
          ? overrides.shipping_free_over_naira
          : current.shipping_free_over_naira,
      ships_from_campus_id:
        overrides.ships_from_campus_id !== undefined
          ? overrides.ships_from_campus_id
          : current.ships_from_campus_id,
      ships_from_city:
        overrides.ships_from_city !== undefined ? overrides.ships_from_city : current.ships_from_city,
      onboarding_completed_at:
        overrides.onboarding_completed_at !== undefined
          ? overrides.onboarding_completed_at
          : current.onboarding_completed_at,
      boost_credits: overrides.boost_credits ?? current.boost_credits,
      require_payment_confirmation:
        overrides.require_payment_confirmation ?? current.require_payment_confirmation,
      favorite_alert_threshold:
        overrides.favorite_alert_threshold ?? current.favorite_alert_threshold,
      shop_name: overrides.shop_name !== undefined ? overrides.shop_name : current.shop_name,
      shop_bio: overrides.shop_bio !== undefined ? overrides.shop_bio : current.shop_bio,
      cover_image_url:
        overrides.cover_image_url !== undefined
          ? overrides.cover_image_url
          : current.cover_image_url,
      shop_updated_at:
        overrides.shop_updated_at !== undefined
          ? overrides.shop_updated_at
          : current.shop_updated_at,
      updated_at: new Date().toISOString(),
    };
  }

  async updatePreferences(
    sellerId: string,
    patch: {
      hallDropoffEnabled?: boolean;
      hallDropoffMinAmount?: number | null;
      shippingEnabled?: boolean;
      shippingFeeNaira?: number | null;
      shippingFreeOverNaira?: number | null;
      shipsFromCampusId?: string | null;
      shipsFromCity?: string | null;
      requirePaymentConfirmation?: boolean;
      favoriteAlertThreshold?: number;
    }
  ): Promise<SellerPreferencesRow> {
    const current = await this.getPreferences(sellerId);
    const next = this.prefsUpsertPayload(current, {
      hall_dropoff_enabled: patch.hallDropoffEnabled ?? current.hall_dropoff_enabled,
      hall_dropoff_min_amount:
        patch.hallDropoffMinAmount !== undefined
          ? patch.hallDropoffMinAmount
          : current.hall_dropoff_min_amount,
      shipping_enabled: patch.shippingEnabled ?? current.shipping_enabled,
      shipping_fee_naira:
        patch.shippingFeeNaira !== undefined ? patch.shippingFeeNaira : current.shipping_fee_naira,
      shipping_free_over_naira:
        patch.shippingFreeOverNaira !== undefined
          ? patch.shippingFreeOverNaira
          : current.shipping_free_over_naira,
      ships_from_campus_id:
        patch.shipsFromCampusId !== undefined ? patch.shipsFromCampusId : current.ships_from_campus_id,
      ships_from_city: patch.shipsFromCity !== undefined ? patch.shipsFromCity : current.ships_from_city,
      require_payment_confirmation:
        patch.requirePaymentConfirmation ?? current.require_payment_confirmation,
      favorite_alert_threshold:
        patch.favoriteAlertThreshold ?? current.favorite_alert_threshold,
    });

    const { data, error } = await this.db
      .from('marketplace_seller_preferences')
      .upsert(next)
      .select('*')
      .single();

    if (error) throw error;
    return data as SellerPreferencesRow;
  }

  async resolveProfileName(sellerId: string): Promise<string> {
    const { data } = await this.db
      .from('profiles')
      .select('name')
      .eq('id', sellerId)
      .maybeSingle();
    const name = typeof data?.name === 'string' ? data.name.trim() : '';
    return name || 'Shop';
  }

  toShopPublic(prefs: SellerPreferencesRow, fallbackName: string): SellerShopPublic {
    const shopName = (prefs.shop_name || '').trim() || fallbackName || 'Shop';
    return {
      shopName,
      bio: prefs.shop_bio?.trim() ? prefs.shop_bio.trim() : null,
      coverImageUrl: prefs.cover_image_url?.trim() ? prefs.cover_image_url.trim() : null,
    };
  }

  async signShopPublic(shop: SellerShopPublic): Promise<SellerShopPublic> {
    if (!shop.coverImageUrl) return shop;
    return {
      ...shop,
      coverImageUrl: await this.host.storageAcl.signStorageDisplayUrl(
        shop.coverImageUrl,
        60 * 60 * 24,
        'original',
      ),
    };
  }

  async signSellerProfileMedia<T extends { shop?: SellerShopPublic | null; recentListings?: any[] }>(
    data: T,
  ): Promise<T> {
    const shop = data.shop ? await this.signShopPublic(data.shop) : data.shop;
    const listings = await Promise.all(
      (data.recentListings || []).map(async (listing) => {
        const images = Array.isArray(listing?.images) ? listing.images : [];
        return {
          ...listing,
          images: await Promise.all(
            images.map((image: string) =>
              this.host.storageAcl.signStorageDisplayUrl(image, 60 * 60 * 24, 'thumb'),
            ),
          ),
        };
      }),
    );
    return { ...data, shop, recentListings: listings };
  }

  /** Ensure a prefs row exists with shop_name defaulted from profile name. */
  async ensureSellerShop(sellerId: string): Promise<SellerPreferencesRow> {
    const current = await this.getPreferences(sellerId);
    if ((current.shop_name || '').trim()) {
      // Row may be virtual default — still upsert if missing in DB
      const { data: existing } = await this.db
        .from('marketplace_seller_preferences')
        .select('seller_id')
        .eq('seller_id', sellerId)
        .maybeSingle();
      if (existing) return current;
    }

    const profileName = await this.resolveProfileName(sellerId);
    const shopName = (current.shop_name || '').trim() || profileName;
    const next = this.prefsUpsertPayload(current, {
      shop_name: shopName,
      shop_updated_at: current.shop_updated_at || new Date().toISOString(),
    });

    const { data, error } = await this.db
      .from('marketplace_seller_preferences')
      .upsert(next)
      .select('*')
      .single();

    if (error) throw error;
    return data as SellerPreferencesRow;
  }

  async updateShop(
    sellerId: string,
    patch: { shopName?: string; bio?: string | null; coverImageUrl?: string | null }
  ): Promise<SellerShopPublic> {
    const current = await this.ensureSellerShop(sellerId);
    const profileName = await this.resolveProfileName(sellerId);

    let shopName = current.shop_name;
    if (patch.shopName !== undefined) {
      const trimmed = patch.shopName.trim();
      if (!trimmed) throw new PublicError('Shop name is required');
      if (trimmed.length > 80) throw new PublicError('Shop name must be 80 characters or fewer');
      shopName = trimmed;
    }

    let shopBio = current.shop_bio;
    if (patch.bio !== undefined) {
      if (patch.bio === null || patch.bio === '') {
        shopBio = null;
      } else {
        const trimmed = patch.bio.trim();
        if (trimmed.length > 500) throw new PublicError('Shop bio must be 500 characters or fewer');
        shopBio = trimmed;
      }
    }

    let cover = current.cover_image_url;
    if (patch.coverImageUrl !== undefined) {
      const raw = patch.coverImageUrl?.trim() || '';
      if (!raw) {
        cover = null;
      } else {
        const persisted = toPersistedMarketplaceImageUrl(raw, {
          ownerId: sellerId,
          supabaseUrl: process.env.SUPABASE_URL || '',
        });
        if (!persisted) {
          throw new PublicError('Cover image is not a valid marketplace photo');
        }
        cover = persisted;
      }
    }

    const next = this.prefsUpsertPayload(current, {
      shop_name: shopName,
      shop_bio: shopBio,
      cover_image_url: cover,
      shop_updated_at: new Date().toISOString(),
    });

    const { data, error } = await this.db
      .from('marketplace_seller_preferences')
      .upsert(next)
      .select('*')
      .single();

    if (error) throw error;
    return this.signShopPublic(this.toShopPublic(data as SellerPreferencesRow, profileName));
  }

  async listShops(input: {
    campusId?: string | null;
    q?: string | null;
    page?: number;
    limit?: number;
  }): Promise<{ shops: MarketplaceShopCard[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, Number(input.page) || 1);
    const limit = Math.min(48, Math.max(1, Number(input.limit) || 24));
    const from = (page - 1) * limit;
    const q = (input.q || '').trim().toLowerCase();
    const campusId = input.campusId || null;

    // Include reserved (sale in progress) so shops stay discoverable while a deal is open.
    let listingsQuery = this.db
      .from('marketplace_listings')
      .select('id, user_id, campus_id, location, created_at, status')
      .in('status', ['active', 'reserved'])
      .order('created_at', { ascending: false })
      .limit(2000);

    if (campusId) {
      listingsQuery = listingsQuery.eq('campus_id', campusId);
    }

    const { data: listings, error: listingsErr } = await listingsQuery;
    if (listingsErr) throw listingsErr;

    const bySeller = new Map<
      string,
      { count: number; lastListingAt: string; campusId: string | null; campusLabel: string | null }
    >();
    for (const row of listings || []) {
      const sellerId = row.user_id as string;
      if (!sellerId) continue;
      const existing = bySeller.get(sellerId);
      if (!existing) {
        bySeller.set(sellerId, {
          count: 1,
          lastListingAt: row.created_at,
          campusId: row.campus_id || null,
          campusLabel: row.location || null,
        });
      } else {
        existing.count += 1;
      }
    }

    const sellerIds = Array.from(bySeller.keys());
    if (sellerIds.length === 0) {
      return { shops: [], total: 0, page, limit };
    }

    const activeListingIds = (listings || []).map((l: any) => l.id).filter(Boolean);
    const listingOwnerById = new Map(
      (listings || []).map((l: any) => [l.id as string, l.user_id as string])
    );

    const [{ data: profiles }, { data: prefs }, reviewsResult] = await Promise.all([
      this.db.from('profiles').select('id, name, avatar_url').in('id', sellerIds),
      this.db
        .from('marketplace_seller_preferences')
        .select('seller_id, shop_name, shop_bio, cover_image_url')
        .in('seller_id', sellerIds),
      activeListingIds.length > 0
        ? this.db
            .from('marketplace_reviews')
            .select('rating, listing_id')
            .in('listing_id', activeListingIds.slice(0, 1000))
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
    const prefsMap = new Map((prefs || []).map((p: any) => [p.seller_id, p]));
    const ratingMap = new Map<string, { sum: number; count: number }>();
    for (const r of reviewsResult.data || []) {
      const sid = listingOwnerById.get((r as any).listing_id);
      if (!sid) continue;
      const cur = ratingMap.get(sid) || { sum: 0, count: 0 };
      cur.sum += Number((r as any).rating) || 0;
      cur.count += 1;
      ratingMap.set(sid, cur);
    }

    let cards: MarketplaceShopCard[] = sellerIds.map((sellerId) => {
      const meta = bySeller.get(sellerId)!;
      const profile = profileMap.get(sellerId);
      const pref = prefsMap.get(sellerId);
      const fallbackName = (profile?.name || '').trim() || 'Shop';
      const shopName = (pref?.shop_name || '').trim() || fallbackName;
      const rating = ratingMap.get(sellerId);
      return {
        sellerId,
        shopName,
        bio: pref?.shop_bio?.trim() ? pref.shop_bio.trim() : null,
        coverImageUrl: pref?.cover_image_url?.trim() ? pref.cover_image_url.trim() : null,
        avatarUrl: profile?.avatar_url || null,
        activeListingCount: meta.count,
        avgRating: rating && rating.count > 0 ? Math.round((rating.sum / rating.count) * 10) / 10 : 0,
        totalReviews: rating?.count || 0,
        campusId: meta.campusId,
        campusLabel: meta.campusLabel,
        lastListingAt: meta.lastListingAt,
      };
    });

    if (q) {
      cards = cards.filter(
        (c) =>
          c.shopName.toLowerCase().includes(q) ||
          (c.bio || '').toLowerCase().includes(q) ||
          (c.campusLabel || '').toLowerCase().includes(q)
      );
    }

    cards.sort((a, b) => {
      const at = a.lastListingAt ? new Date(a.lastListingAt).getTime() : 0;
      const bt = b.lastListingAt ? new Date(b.lastListingAt).getTime() : 0;
      return bt - at;
    });

    const total = cards.length;
    const shops = cards.slice(from, from + limit);
    const coverRefs = shops
      .map((shop, index) => {
        if (!shop.coverImageUrl) return null;
        const parsed = parseStoredStorageRef(shop.coverImageUrl);
        if (!parsed || !isPrivateStorageBucket(parsed.bucket)) return null;
        return { bucket: parsed.bucket, path: parsed.path, index };
      })
      .filter(Boolean) as Array<{ bucket: string; path: string; index: number }>;
    if (coverRefs.length > 0) {
      const signedByIndex = await this.host.storageAcl.signStorageDisplayUrls(coverRefs, {
        expiresInSeconds: 60 * 60 * 24,
        variant: 'original',
      });
      for (const [index, signed] of signedByIndex) {
        const shop = shops[index];
        if (shop && signed) shop.coverImageUrl = signed;
      }
    }
    return { shops, total, page, limit };
  }

  async getPickupNudge(sellerId: string, buyerId?: string): Promise<PickupNudge> {
    const prefs = await this.getPreferences(sellerId);
    const minAmount = Number(prefs.hall_dropoff_min_amount) || 0;
    const enabled = prefs.hall_dropoff_enabled && minAmount > 0;

    if (!enabled || !buyerId || buyerId === sellerId) {
      return {
        enabled,
        minAmount,
        buyerSpentWithSeller: 0,
        remainingAmount: minAmount,
        message: enabled
          ? `Hall dropoff available on combined orders of ₦${minAmount.toLocaleString()}+ from this seller.`
          : null,
      };
    }

    const { data: orders } = await this.db
      .from('marketplace_orders')
      .select('amount, status')
      .eq('seller_id', sellerId)
      .eq('buyer_id', buyerId)
      .in('status', ['paid', 'ready_for_pickup', 'buyer_confirmed', 'completed']);

    const buyerSpentWithSeller = (orders || []).reduce((s, o) => s + Number(o.amount), 0);
    const remainingAmount = Math.max(0, minAmount - buyerSpentWithSeller);

    let message: string | null = null;
    if (remainingAmount <= 0) {
      message = `You qualify for hall dropoff with this seller (₦${minAmount.toLocaleString()} threshold met).`;
    } else if (buyerSpentWithSeller > 0) {
      message = `Add ₦${remainingAmount.toLocaleString()} more from this seller to unlock hall dropoff.`;
    } else {
      message = `Spend ₦${minAmount.toLocaleString()} with this seller to unlock hall dropoff.`;
    }

    return { enabled, minAmount, buyerSpentWithSeller, remainingAmount, message };
  }

  async createBundle(
    sellerId: string,
    input: {
      title: string;
      description?: string;
      price: number;
      listingIds: string[];
      images?: string[];
      location?: string;
      category?: string;
      campusId: string;
      countryCode: string;
      currency: string;
    }
  ): Promise<Record<string, unknown>> {
    if (!input.title?.trim()) throw new PublicError('Bundle title is required');
    if (!input.price || input.price <= 0) throw new PublicError('Bundle price must be positive');
    if (!input.campusId) throw new PublicError('Campus or city metadata is required');
    if (!input.listingIds?.length || input.listingIds.length < 2) {
      throw new PublicError('Select at least 2 listings for a bundle');
    }
    if (input.listingIds.length > 10) throw new PublicError('Bundles can include at most 10 items');

    const { data: listings, error } = await this.db
      .from('marketplace_listings')
      .select('id, title, price, images, status, user_id, category')
      .eq('user_id', sellerId)
      .in('id', input.listingIds);

    if (error) throw error;
    if (!listings || listings.length !== input.listingIds.length) {
      throw new PublicError('One or more bundle listings were not found');
    }

    const bundleItems: MarketplaceBundleItem[] = listings.map((l) => ({
      listing_id: l.id,
      title: l.title,
      price: l.price != null ? Number(l.price) : undefined,
    }));

    const images =
      input.images?.length
        ? input.images
        : listings.flatMap((l) => (Array.isArray(l.images) ? l.images : [])).slice(0, 5);

    const { data, error: insertError } = await this.db
      .from('marketplace_listings')
      .insert({
        user_id: sellerId,
        category: input.category || listings[0]?.category || 'personal_goods',
        title: input.title.trim(),
        description: input.description || null,
        price: input.price,
        location: input.location || null,
        campus_id: input.campusId,
        country_code: input.countryCode,
        currency: input.currency,
        images,
        status: 'active',
        listing_kind: 'bundle',
        bundle_items: bundleItems,
      })
      .select('*')
      .single();

    if (insertError) throw insertError;
    return data;
  }

  async sendCampaign(
    sellerId: string,
    input: { message: string; segment?: string; buyerIds?: string[] }
  ): Promise<{ sent: number; skipped: number }> {
    const message = input.message?.trim();
    if (!message || message.length < 5) throw new PublicError('Message must be at least 5 characters');
    if (message.length > 500) throw new PublicError('Message must be 500 characters or fewer');

    const { getMarketplaceOrdersService } = await import('./marketplaceOrders');
    const buyers = await getMarketplaceOrdersService(this.host).getSellerBuyersWithSegments(
      sellerId,
      input.segment
    );

    let recipients = buyers;
    if (input.buyerIds?.length) {
      const idSet = new Set(input.buyerIds);
      recipients = buyers.filter((b) => idSet.has(b.buyerId));
    }

    if (!recipients.length) throw new PublicError('No customers match this audience');

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const { count: sentToday } = await this.db
      .from('marketplace_campaign_log')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', sellerId)
      .gte('created_at', dayStart.toISOString());

    if ((sentToday || 0) >= DAILY_CAMPAIGN_CAP) {
      throw new PublicError('Daily campaign limit reached. Try again tomorrow.');
    }

    const batch = recipients.slice(0, MAX_CAMPAIGN_RECIPIENTS);
    let sent = 0;
    let skipped = 0;

    for (const buyer of batch) {
      try {
        await this.host.notifications.createNotification(buyer.buyerId, {
          type: 'marketplace_seller_campaign',
          message: message.slice(0, 240),
          link: 'marketplace:MY_LISTINGS',
          data: { sellerId, segment: input.segment || null, campaign: true },
        });

        try {
          await this.host.directMessages.sendDirectMessage(
            sellerId,
            buyer.buyerId,
            `[Marketplace update] ${message}`
          );
        } catch (dmErr) {
          logger.warn('Campaign DM skipped', { buyerId: buyer.buyerId, dmErr });
        }

        // BEST EFFORT (#108): the campaign audit line. The DM and the
        // notification are the delivery; this only records that they went.
        bestEffortWrite(
          await this.db.from('marketplace_campaign_log').insert({
            seller_id: sellerId,
            recipient_id: buyer.buyerId,
            segment: input.segment || null,
            message_preview: message.slice(0, 120),
          }),
          { table: 'marketplace_campaign_log', op: 'insert', sellerId, recipientId: buyer.buyerId },
        );
        sent += 1;
      } catch (err) {
        skipped += 1;
        logger.warn('Campaign recipient failed', { buyerId: buyer.buyerId, err });
      }
    }

    return { sent, skipped };
  }

  async getOnboardingStatus(sellerId: string): Promise<{
    needsOnboarding: boolean;
    boostCredits: number;
    listingCount: number;
    tips: string[];
  }> {
    const prefs = await this.getPreferences(sellerId);
    const { count } = await this.db
      .from('marketplace_listings')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', sellerId);

    return {
      needsOnboarding: !prefs.onboarding_completed_at,
      boostCredits: prefs.boost_credits ?? 1,
      listingCount: count ?? 0,
      tips: [
        'Add a shop name and bio so buyers recognize you.',
        'Add clear photos — listings with 3+ images get more views.',
        'Set a campus meetup location buyers recognize.',
        'Enable offers so buyers can negotiate fairly.',
        'Use hall dropoff thresholds to encourage larger orders.',
      ],
    };
  }

  async completeOnboarding(sellerId: string): Promise<SellerPreferencesRow> {
    const current = await this.getPreferences(sellerId);
    const next = this.prefsUpsertPayload(current, {
      onboarding_completed_at: new Date().toISOString(),
      boost_credits: Math.max(current.boost_credits ?? 0, 3),
      favorite_alert_threshold: current.favorite_alert_threshold ?? 3,
    });
    const { data, error } = await this.db
      .from('marketplace_seller_preferences')
      .upsert(next)
      .select('*')
      .single();

    if (error) throw error;
    return data as SellerPreferencesRow;
  }

  async consumeBoostCredit(sellerId: string): Promise<number> {
    const { data, error } = await this.db.rpc('marketplace_consume_boost_credit', {
      p_seller_id: sellerId,
    });

    if (error) throw error;
    if (typeof data !== 'number') {
      throw new PublicError('No boost credits remaining. Complete more sales to earn boosts.');
    }
    return data;
  }
}

let sellerToolsService: MarketplaceSellerToolsService | null = null;

export function getMarketplaceSellerToolsService(
  host: MarketplaceServiceHost
): MarketplaceSellerToolsService {
  if (!sellerToolsService) sellerToolsService = new MarketplaceSellerToolsService(host);
  return sellerToolsService;
}
