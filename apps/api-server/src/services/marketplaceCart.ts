import type { SupabaseService } from './supabase';
import { getMarketplaceOrdersService, type MarketplaceOrderRow } from './marketplaceOrders';

export type MarketplaceCartItemRow = {
  id: string;
  buyer_id: string;
  listing_id: string;
  quantity: number;
  created_at: string;
  updated_at: string;
  listing?: any;
};

const cartSelect = `
  id, buyer_id, listing_id, quantity, created_at, updated_at,
  listing:marketplace_listings(
    id, title, price, sale_price, sale_ends_at, images, category, status, quantity, location, user_id
  )
`;

function normalizeQuantity(raw: unknown, fallback = 1): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

export class MarketplaceCartService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  async listCart(buyerId: string): Promise<MarketplaceCartItemRow[]> {
    const { data, error } = await this.db
      .from('marketplace_cart_items')
      .select(cartSelect)
      .eq('buyer_id', buyerId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []) as unknown as MarketplaceCartItemRow[];
  }

  private assertListingPurchasable(
    listing: {
      id: string;
      user_id: string;
      status: string;
      quantity?: number | null;
    },
    buyerId: string,
    quantity: number
  ): void {
    if (listing.user_id === buyerId) {
      throw new Error('Cannot add your own listing to cart');
    }
    if (listing.status !== 'active') {
      throw new Error('Listing is not available for purchase');
    }
    if (listing.quantity == null) {
      if (quantity !== 1) {
        throw new Error('This listing can only be purchased as a single item');
      }
      return;
    }
    if (listing.quantity < quantity) {
      throw new Error('Not enough stock for the requested quantity');
    }
  }

  async addToCart(
    buyerId: string,
    listingId: string,
    quantityInput?: number
  ): Promise<MarketplaceCartItemRow> {
    const quantity = normalizeQuantity(quantityInput, 1);
    const listing = await this.supabaseService.getMarketplaceListingById(listingId);
    if (!listing) throw new Error('Listing not found');
    this.assertListingPurchasable(listing, buyerId, quantity);

    const { data: existing } = await this.db
      .from('marketplace_cart_items')
      .select('id, quantity')
      .eq('buyer_id', buyerId)
      .eq('listing_id', listingId)
      .maybeSingle();

    if (existing) {
      const nextQty =
        listing.quantity == null
          ? 1
          : Math.min(Number(listing.quantity), Number(existing.quantity) + quantity);
      this.assertListingPurchasable(listing, buyerId, nextQty);
      const { data, error } = await this.db
        .from('marketplace_cart_items')
        .update({ quantity: nextQty })
        .eq('id', existing.id)
        .select(cartSelect)
        .single();
      if (error) throw error;
      return data as unknown as MarketplaceCartItemRow;
    }

    const { data, error } = await this.db
      .from('marketplace_cart_items')
      .insert({
        buyer_id: buyerId,
        listing_id: listingId,
        quantity: listing.quantity == null ? 1 : quantity,
      })
      .select(cartSelect)
      .single();
    if (error) throw error;
    return data as unknown as MarketplaceCartItemRow;
  }

  async updateCartItem(
    buyerId: string,
    listingId: string,
    quantityInput: number
  ): Promise<MarketplaceCartItemRow | null> {
    const raw = Math.floor(Number(quantityInput));
    if (!Number.isFinite(raw) || raw < 1) {
      await this.removeCartItem(buyerId, listingId);
      return null;
    }

    const listing = await this.supabaseService.getMarketplaceListingById(listingId);
    if (!listing) throw new Error('Listing not found');
    this.assertListingPurchasable(listing, buyerId, raw);

    const { data, error } = await this.db
      .from('marketplace_cart_items')
      .update({ quantity: listing.quantity == null ? 1 : raw })
      .eq('buyer_id', buyerId)
      .eq('listing_id', listingId)
      .select(cartSelect)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Cart item not found');
    return data as unknown as MarketplaceCartItemRow;
  }

  async removeCartItem(buyerId: string, listingId: string): Promise<void> {
    const { error } = await this.db
      .from('marketplace_cart_items')
      .delete()
      .eq('buyer_id', buyerId)
      .eq('listing_id', listingId);
    if (error) throw error;
  }

  async clearCart(buyerId: string): Promise<void> {
    const { error } = await this.db
      .from('marketplace_cart_items')
      .delete()
      .eq('buyer_id', buyerId);
    if (error) throw error;
  }

  async checkout(buyerId: string): Promise<{
    orders: MarketplaceOrderRow[];
    failures: Array<{ listingId: string; error: string }>;
  }> {
    const items = await this.listCart(buyerId);
    if (items.length === 0) {
      throw new Error('Cart is empty');
    }

    const ordersService = getMarketplaceOrdersService(this.supabaseService);
    const orders: MarketplaceOrderRow[] = [];
    const failures: Array<{ listingId: string; error: string }> = [];
    const succeededListingIds: string[] = [];

    for (const item of items) {
      try {
        const order = await ordersService.createOrderFromBuyNow(
          item.listing_id,
          buyerId,
          undefined,
          item.quantity
        );
        orders.push(order);
        succeededListingIds.push(item.listing_id);
      } catch (err: any) {
        failures.push({
          listingId: item.listing_id,
          error: err?.message || 'Could not create order',
        });
      }
    }

    if (succeededListingIds.length > 0) {
      const { error } = await this.db
        .from('marketplace_cart_items')
        .delete()
        .eq('buyer_id', buyerId)
        .in('listing_id', succeededListingIds);
      if (error) throw error;
    }

    if (orders.length === 0) {
      throw new Error(failures[0]?.error || 'Checkout failed for all items');
    }

    return { orders, failures };
  }
}

let cartService: MarketplaceCartService | null = null;

export function getMarketplaceCartService(supabaseService: SupabaseService): MarketplaceCartService {
  if (!cartService) cartService = new MarketplaceCartService(supabaseService);
  return cartService;
}
