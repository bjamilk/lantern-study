import type { SupabaseService } from './supabase';
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
  onboarding_completed_at?: string | null;
  boost_credits: number;
  require_payment_confirmation: boolean;
  favorite_alert_threshold: number;
  updated_at: string;
};

export type PickupNudge = {
  enabled: boolean;
  minAmount: number;
  buyerSpentWithSeller: number;
  remainingAmount: number;
  message: string | null;
};

export class MarketplaceSellerToolsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  async getPreferences(sellerId: string): Promise<SellerPreferencesRow> {
    const { data } = await this.db
      .from('marketplace_seller_preferences')
      .select('*')
      .eq('seller_id', sellerId)
      .maybeSingle();

    return (
      data || {
        seller_id: sellerId,
        hall_dropoff_enabled: false,
        hall_dropoff_min_amount: null,
        onboarding_completed_at: null,
        boost_credits: 1,
        require_payment_confirmation: false,
        favorite_alert_threshold: 3,
        updated_at: new Date().toISOString(),
      }
    );
  }

  async updatePreferences(
    sellerId: string,
    patch: {
      hallDropoffEnabled?: boolean;
      hallDropoffMinAmount?: number | null;
      requirePaymentConfirmation?: boolean;
      favoriteAlertThreshold?: number;
    }
  ): Promise<SellerPreferencesRow> {
    const current = await this.getPreferences(sellerId);
    const next = {
      seller_id: sellerId,
      hall_dropoff_enabled: patch.hallDropoffEnabled ?? current.hall_dropoff_enabled,
      hall_dropoff_min_amount:
        patch.hallDropoffMinAmount !== undefined
          ? patch.hallDropoffMinAmount
          : current.hall_dropoff_min_amount,
      onboarding_completed_at: current.onboarding_completed_at,
      boost_credits: current.boost_credits,
      require_payment_confirmation:
        patch.requirePaymentConfirmation ?? current.require_payment_confirmation,
      favorite_alert_threshold:
        patch.favoriteAlertThreshold ?? current.favorite_alert_threshold,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.db
      .from('marketplace_seller_preferences')
      .upsert(next)
      .select('*')
      .single();

    if (error) throw error;
    return data as SellerPreferencesRow;
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
    }
  ): Promise<Record<string, unknown>> {
    if (!input.title?.trim()) throw new Error('Bundle title is required');
    if (!input.price || input.price <= 0) throw new Error('Bundle price must be positive');
    if (!input.listingIds?.length || input.listingIds.length < 2) {
      throw new Error('Select at least 2 listings for a bundle');
    }
    if (input.listingIds.length > 10) throw new Error('Bundles can include at most 10 items');

    const { data: listings, error } = await this.db
      .from('marketplace_listings')
      .select('id, title, price, images, status, user_id, category')
      .eq('user_id', sellerId)
      .in('id', input.listingIds);

    if (error) throw error;
    if (!listings || listings.length !== input.listingIds.length) {
      throw new Error('One or more bundle listings were not found');
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
    if (!message || message.length < 5) throw new Error('Message must be at least 5 characters');
    if (message.length > 500) throw new Error('Message must be 500 characters or fewer');

    const { getMarketplaceOrdersService } = await import('./marketplaceOrders');
    const buyers = await getMarketplaceOrdersService(this.supabaseService).getSellerBuyersWithSegments(
      sellerId,
      input.segment
    );

    let recipients = buyers;
    if (input.buyerIds?.length) {
      const idSet = new Set(input.buyerIds);
      recipients = buyers.filter((b) => idSet.has(b.buyerId));
    }

    if (!recipients.length) throw new Error('No customers match this audience');

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const { count: sentToday } = await this.db
      .from('marketplace_campaign_log')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', sellerId)
      .gte('created_at', dayStart.toISOString());

    if ((sentToday || 0) >= DAILY_CAMPAIGN_CAP) {
      throw new Error('Daily campaign limit reached. Try again tomorrow.');
    }

    const batch = recipients.slice(0, MAX_CAMPAIGN_RECIPIENTS);
    let sent = 0;
    let skipped = 0;

    for (const buyer of batch) {
      try {
        await this.supabaseService.createNotification(buyer.buyerId, {
          type: 'marketplace_seller_campaign',
          message: message.slice(0, 240),
          link: 'marketplace:MY_LISTINGS',
          data: { sellerId, segment: input.segment || null, campaign: true },
        });

        try {
          await this.supabaseService.sendDirectMessage(
            sellerId,
            buyer.buyerId,
            `[Marketplace update] ${message}`
          );
        } catch (dmErr) {
          logger.warn('Campaign DM skipped', { buyerId: buyer.buyerId, dmErr });
        }

        await this.db.from('marketplace_campaign_log').insert({
          seller_id: sellerId,
          recipient_id: buyer.buyerId,
          segment: input.segment || null,
          message_preview: message.slice(0, 120),
        });
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
        'Add clear photos — listings with 3+ images get more views.',
        'Set a campus meetup location buyers recognize.',
        'Enable offers so buyers can negotiate fairly.',
        'Use hall dropoff thresholds to encourage larger orders.',
      ],
    };
  }

  async completeOnboarding(sellerId: string): Promise<SellerPreferencesRow> {
    const current = await this.getPreferences(sellerId);
    const { data, error } = await this.db
      .from('marketplace_seller_preferences')
      .upsert({
        seller_id: sellerId,
        hall_dropoff_enabled: current.hall_dropoff_enabled,
        hall_dropoff_min_amount: current.hall_dropoff_min_amount,
        onboarding_completed_at: new Date().toISOString(),
        boost_credits: Math.max(current.boost_credits ?? 0, 3),
        require_payment_confirmation: current.require_payment_confirmation,
        favorite_alert_threshold: current.favorite_alert_threshold ?? 3,
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error) throw error;
    return data as SellerPreferencesRow;
  }

  async consumeBoostCredit(sellerId: string): Promise<number> {
    const prefs = await this.getPreferences(sellerId);
    if ((prefs.boost_credits ?? 0) <= 0) {
      throw new Error('No boost credits remaining. Complete more sales to earn boosts.');
    }
    const next = (prefs.boost_credits ?? 0) - 1;
    await this.db
      .from('marketplace_seller_preferences')
      .upsert({
        seller_id: sellerId,
        hall_dropoff_enabled: prefs.hall_dropoff_enabled,
        hall_dropoff_min_amount: prefs.hall_dropoff_min_amount,
        onboarding_completed_at: prefs.onboarding_completed_at,
        boost_credits: next,
        require_payment_confirmation: prefs.require_payment_confirmation,
        favorite_alert_threshold: prefs.favorite_alert_threshold ?? 3,
        updated_at: new Date().toISOString(),
      });
    return next;
  }
}

let sellerToolsService: MarketplaceSellerToolsService | null = null;

export function getMarketplaceSellerToolsService(
  supabaseService: SupabaseService
): MarketplaceSellerToolsService {
  if (!sellerToolsService) sellerToolsService = new MarketplaceSellerToolsService(supabaseService);
  return sellerToolsService;
}
