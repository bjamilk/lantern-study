import type { SupabaseService } from './supabase';
import { resolveEffectivePrice } from './marketplaceOrders';

export type MarketplaceCouponRow = {
  id: string;
  seller_id: string;
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  listing_id?: string | null;
  max_uses?: number | null;
  uses_count: number;
  starts_at?: string | null;
  ends_at?: string | null;
  active: boolean;
};

export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

export function computeCouponDiscount(
  baseAmount: number,
  coupon: Pick<MarketplaceCouponRow, 'discount_type' | 'discount_value'>
): number {
  if (baseAmount <= 0) return 0;
  if (coupon.discount_type === 'percent') {
    const pct = Math.min(100, Math.max(0, Number(coupon.discount_value)));
    return Math.round((baseAmount * pct) / 100 * 100) / 100;
  }
  return Math.min(baseAmount, Math.max(0, Number(coupon.discount_value)));
}

export class MarketplaceCouponsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  async listForSeller(sellerId: string): Promise<MarketplaceCouponRow[]> {
    const { data, error } = await this.db
      .from('marketplace_coupons')
      .select('*')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []) as MarketplaceCouponRow[];
  }

  async createCoupon(
    sellerId: string,
    input: {
      code: string;
      discountType: 'percent' | 'fixed';
      discountValue: number;
      listingId?: string;
      maxUses?: number;
      startsAt?: string;
      endsAt?: string;
    }
  ): Promise<MarketplaceCouponRow> {
    const code = normalizeCouponCode(input.code);
    if (!code) throw new Error('Coupon code is required');
    if (input.discountValue <= 0) throw new Error('Discount must be positive');
    if (input.discountType === 'percent' && input.discountValue > 100) {
      throw new Error('Percent discount cannot exceed 100');
    }

    const { data, error } = await this.db
      .from('marketplace_coupons')
      .insert({
        seller_id: sellerId,
        code,
        discount_type: input.discountType,
        discount_value: input.discountValue,
        listing_id: input.listingId || null,
        max_uses: input.maxUses ?? null,
        starts_at: input.startsAt || null,
        ends_at: input.endsAt || null,
        active: true,
      })
      .select('*')
      .single();

    if (error) throw error;
    return data as MarketplaceCouponRow;
  }

  async validateForListing(
    code: string,
    listing: { id: string; user_id: string; price?: number | null; sale_price?: number | null; sale_ends_at?: string | null },
    buyerId: string
  ): Promise<{ coupon: MarketplaceCouponRow; baseAmount: number; discountAmount: number; finalAmount: number }> {
    const normalized = normalizeCouponCode(code);
    const { data: coupon, error } = await this.db
      .from('marketplace_coupons')
      .select('*')
      .eq('seller_id', listing.user_id)
      .eq('code', normalized)
      .eq('active', true)
      .maybeSingle();

    if (error) throw error;
    if (!coupon) throw new Error('Invalid coupon code');
    if (listing.user_id === buyerId) throw new Error('Cannot use your own coupon');

    const row = coupon as MarketplaceCouponRow;
    const now = Date.now();
    if (row.starts_at && new Date(row.starts_at).getTime() > now) {
      throw new Error('Coupon is not active yet');
    }
    if (row.ends_at && new Date(row.ends_at).getTime() <= now) {
      throw new Error('Coupon has expired');
    }
    if (row.max_uses != null && row.uses_count >= row.max_uses) {
      throw new Error('Coupon has reached its usage limit');
    }
    if (row.listing_id && row.listing_id !== listing.id) {
      throw new Error('Coupon does not apply to this listing');
    }

    const baseAmount = resolveEffectivePrice(listing);
    const discountAmount = computeCouponDiscount(baseAmount, row);
    const finalAmount = Math.max(0, Math.round((baseAmount - discountAmount) * 100) / 100);
    if (finalAmount <= 0 && baseAmount > 0) {
      throw new Error('Coupon discount is too large');
    }

    return { coupon: row, baseAmount, discountAmount, finalAmount };
  }

  async redeemCoupon(couponId: string): Promise<void> {
    const { data, error } = await this.db
      .from('marketplace_coupons')
      .select('uses_count')
      .eq('id', couponId)
      .single();
    if (error || !data) return;

    await this.db
      .from('marketplace_coupons')
      .update({
        uses_count: (data.uses_count || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', couponId);
  }
}

let couponsService: MarketplaceCouponsService | null = null;

export function getMarketplaceCouponsService(supabaseService: SupabaseService): MarketplaceCouponsService {
  if (!couponsService) couponsService = new MarketplaceCouponsService(supabaseService);
  return couponsService;
}
