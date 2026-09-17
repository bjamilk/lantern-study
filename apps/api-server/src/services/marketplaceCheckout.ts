import type { MarketplaceFulfillmentMode } from '@lantern/shared/types';
import { bestEffortWrite } from './data/writeResult';
import {
  isDigitalListingKind,
  nairaToKobo,
  quoteCheckout,
  resolveMarketplaceFees,
} from '@lantern/shared/marketplace';
import { resolveListingDisplayPrice } from '@lantern/shared/utils';
import { PublicError } from '../utils/safeError';
import type { DataLayer } from './data';
import { getMarketplaceAddressesService } from './marketplaceAddresses';
import { getMarketplaceCartService } from './marketplaceCart';
import {
  getMarketplaceOrdersService,
  resolveEffectivePrice,
  type MarketplaceOrderRow,
} from './marketplaceOrders';
import { getMarketplaceSellerToolsService } from './marketplaceSellerTools';

export type CheckoutGroupInput = {
  sellerId: string;
  fulfillmentMode: MarketplaceFulfillmentMode;
  meetingLocation?: string | null;
};

export class MarketplaceCheckoutService {
  constructor(private readonly data: DataLayer) {}

  private get db() {
    return this.data.getClient();
  }

  async getCheckout(checkoutId: string, buyerId: string) {
    const { data, error } = await this.db
      .from('marketplace_checkouts')
      .select('*')
      .eq('id', checkoutId)
      .eq('buyer_id', buyerId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async createFromCart(
    buyerId: string,
    input: {
      groups: CheckoutGroupInput[];
      addressId?: string | null;
      buyerEmail?: string;
    },
  ) {
    const cart = await getMarketplaceCartService(this.data).listCart(buyerId);
    if (cart.length === 0) throw new PublicError('Cart is empty');
    const ordersService = getMarketplaceOrdersService(this.data);
    const sellerTools = getMarketplaceSellerToolsService(this.data);
    const addresses = getMarketplaceAddressesService(this.data);

    const modeBySeller = new Map(
      (input.groups || []).map((group) => [group.sellerId, group] as const),
    );

    type PreparedLine = {
      listingId: string;
      sellerId: string;
      quantity: number;
      itemTotalNaira: number;
      listing: any;
    };
    const prepared: PreparedLine[] = [];

    for (const item of cart) {
      const listing = item.listing || (await this.data.marketplace.getMarketplaceListingById(item.listing_id));
      if (!listing) throw new PublicError('A cart listing is no longer available');
      if (isDigitalListingKind(listing.listing_kind)) {
        throw new PublicError('Digital products are bought instantly and cannot be checked out from the cart');
      }
      const sellerId = String(listing.user_id);
      const unit = resolveListingDisplayPrice(listing).effective ?? resolveEffectivePrice(listing);
      prepared.push({
        listingId: item.listing_id,
        sellerId,
        quantity: item.quantity,
        itemTotalNaira: unit * item.quantity,
        listing,
      });
    }

    const sellerIds = [...new Set(prepared.map((line) => line.sellerId))];
    const prefsBySeller = new Map<string, Awaited<ReturnType<typeof sellerTools.getPreferences>>>();
    for (const sellerId of sellerIds) {
      prefsBySeller.set(sellerId, await sellerTools.getPreferences(sellerId));
    }

    for (const sellerId of sellerIds) {
      const group = modeBySeller.get(sellerId);
      if (!group) throw new PublicError('Choose meetup, hall dropoff, or shipping for each seller');
      const prefs = prefsBySeller.get(sellerId);
      if (group.fulfillmentMode === 'hall_dropoff' && !prefs?.hall_dropoff_enabled) {
        throw new PublicError('This seller does not offer hall dropoff');
      }
      if (group.fulfillmentMode === 'shipping' && !prefs?.shipping_enabled) {
        throw new PublicError('This seller does not ship');
      }
      if (group.fulfillmentMode === 'digital') {
        throw new PublicError('Cart checkout is for physical items only');
      }
    }

    const quote = quoteCheckout(
      sellerIds.map((sellerId) => ({
        sellerId,
        itemTotalNaira: prepared
          .filter((line) => line.sellerId === sellerId)
          .reduce((sum, line) => sum + line.itemTotalNaira, 0),
        fulfillmentMode: modeBySeller.get(sellerId)!.fulfillmentMode,
        prefs: prefsBySeller.get(sellerId),
      })),
    );

    let addressSnapshot: Record<string, unknown> | null = null;
    if (quote.requiresAddress) {
      if (!input.addressId) throw new PublicError('Add a delivery address to ship');
      const address = await addresses.getOwned(buyerId, input.addressId);
      if (!address) throw new PublicError('Delivery address not found');
      addressSnapshot = addresses.snapshot(address as Record<string, unknown>);
    }

    const { data: checkout, error: checkoutErr } = await this.db
      .from('marketplace_checkouts')
      .insert({
        buyer_id: buyerId,
        status: 'awaiting_payment',
        item_amount_kobo: quote.itemAmountKobo,
        shipping_amount_kobo: quote.shippingAmountKobo,
        total_charged_kobo: quote.totalChargeKobo,
        shipping_address: addressSnapshot,
      })
      .select('*')
      .single();
    if (checkoutErr || !checkout) throw checkoutErr || new PublicError('Could not start checkout');

    const created: MarketplaceOrderRow[] = [];
    try {
      const { getMarketplacePaymentsService, marketplacePaystackEnabled } = await import(
        './marketplacePayments'
      );
      const payments = getMarketplacePaymentsService(this.data);
      const paystackOn = marketplacePaystackEnabled();

      for (const line of prepared) {
        const group = modeBySeller.get(line.sellerId)!;
        const quoteGroup = quote.groups.find((row) => row.sellerId === line.sellerId);
        const sellerLines = prepared.filter((row) => row.sellerId === line.sellerId);
        const isFirstOfSeller = sellerLines[0]?.listingId === line.listingId;
        const shippingNaira = isFirstOfSeller ? (quoteGroup?.shippingNaira ?? 0) : 0;
        const fees = resolveMarketplaceFees({
          listingKind: line.listing.listing_kind,
          itemAmountKobo: nairaToKobo(line.itemTotalNaira),
          env: process.env,
        });
        const sellerPayoutKobo = fees.sellerPayoutKobo + nairaToKobo(shippingNaira);

        const order = paystackOn
          ? await payments.createAwaitingPaymentOrderForCheckout({
              listingId: line.listingId,
              buyerId,
              quantity: line.quantity,
            })
          : await ordersService.createOrderFromBuyNow(line.listingId, buyerId, undefined, line.quantity);

        const patch: Record<string, unknown> = {
          checkout_id: checkout.id,
          fulfillment_mode: group.fulfillmentMode,
          meeting_location: group.meetingLocation || null,
          shipping_amount: shippingNaira,
          shipping_address: group.fulfillmentMode === 'shipping' ? addressSnapshot : null,
          seller_payout_kobo: sellerPayoutKobo,
        };
        if (paystackOn) patch.status = 'awaiting_payment';

        const { data: updated, error: patchErr } = await this.db
          .from('marketplace_orders')
          .update(patch)
          .eq('id', order.id)
          .select('*')
          .single();
        if (patchErr || !updated) throw patchErr || new PublicError('Could not attach order to checkout');
        created.push(updated as MarketplaceOrderRow);
      }

      if (!paystackOn) {
        // BEST EFFORT (#108): the insert above already set `awaiting_payment`,
        // so this re-stamps the status it already has and moves `updated_at`.
        // Cosmetic by construction.
        bestEffortWrite(
          await this.db
            .from('marketplace_checkouts')
            .update({ status: 'awaiting_payment', updated_at: new Date().toISOString() })
            .eq('id', checkout.id),
          { table: 'marketplace_checkouts', op: 'update', checkoutId: checkout.id },
        );
        return {
          checkout: { ...checkout, authorizationUrl: null },
          orders: created,
          authorizationUrl: null,
        };
      }

      const email = input.buyerEmail || '';
      if (!email) throw new PublicError('A verified email is required for Paystack checkout');

      const session = await payments.createCheckoutCharge({
        checkoutId: checkout.id,
        buyerId,
        buyerEmail: email,
        orders: created.map((order) => ({
          id: String(order.id),
          seller_id: String(order.seller_id),
          listing_id: String(order.listing_id),
          amount: Number(order.amount),
          quantity: order.quantity,
        })),
        itemAmountKobo: quote.itemAmountKobo,
        shippingAmountKobo: quote.shippingAmountKobo,
        totalChargeKobo: quote.totalChargeKobo,
      });

      return {
        checkout: { ...checkout, payment_id: session.paymentId, authorizationUrl: session.authorizationUrl },
        orders: created,
        authorizationUrl: session.authorizationUrl,
      };
    } catch (err) {
      for (const order of created) {
        try {
          await ordersService.updateOrderStatus(order.id, buyerId, 'cancel');
        } catch {
          // best-effort rollback
        }
      }
      // BEST EFFORT at ERROR level (#108): it must not throw over the error
      // that sent this rollback running — the caller needs that one. A failure
      // leaves the checkout reading `awaiting_payment` while its orders have
      // been cancelled, which is a stale row rather than a money problem: no
      // charge was opened, and `createCheckoutCharge` throws before Paystack.
      bestEffortWrite(
        await this.db
          .from('marketplace_checkouts')
          .update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('id', checkout.id),
        {
          table: 'marketplace_checkouts',
          op: 'update',
          checkoutId: checkout.id,
          reason: 'checkout_rollback',
        },
        'error',
      );
      throw err;
    }
  }
}

let checkoutService: MarketplaceCheckoutService | null = null;

export function getMarketplaceCheckoutService(
  data: DataLayer,
): MarketplaceCheckoutService {
  if (!checkoutService) checkoutService = new MarketplaceCheckoutService(data);
  return checkoutService;
}
