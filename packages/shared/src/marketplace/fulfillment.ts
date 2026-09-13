/**
 * Campus fulfillment — meetup, hall dropoff, or seller-quoted shipping.
 *
 * Bumpa manual mode: the store collects an address and a flat shipping fee.
 * It does not book a courier. Live rate-shop (Shipbubble) is a later wave.
 */

import type { MarketplaceFulfillmentMode } from '../types';
import { isDigitalListingKind } from './lifecycle';

export const MARKETPLACE_FULFILLMENT_MODES = [
  'campus_meetup',
  'hall_dropoff',
  'shipping',
  'digital',
] as const;

export const FULFILLMENT_LABELS: Record<MarketplaceFulfillmentMode, string> = {
  campus_meetup: 'Meetup',
  hall_dropoff: 'Hall dropoff',
  shipping: 'Ships',
  digital: 'Instant',
};

export const FULFILLMENT_HINTS: Record<MarketplaceFulfillmentMode, string> = {
  campus_meetup: 'Meet on campus',
  hall_dropoff: 'Drop at a hall',
  shipping: 'Deliver to an address',
  digital: 'Delivered in the app',
};

export type SellerFulfillmentPrefs = {
  hall_dropoff_enabled?: boolean | null;
  hall_dropoff_min_amount?: number | null;
  shipping_enabled?: boolean | null;
  shipping_fee_naira?: number | null;
  shipping_free_over_naira?: number | null;
  ships_from_campus_id?: string | null;
  ships_from_city?: string | null;
};

export type ListingFulfillmentFields = {
  listing_kind?: string | null;
  user_id?: string;
  seller_id?: string;
};

export function normalizeFulfillmentMode(
  raw: string | null | undefined,
): MarketplaceFulfillmentMode | null {
  if (!raw) return null;
  return (MARKETPLACE_FULFILLMENT_MODES as readonly string[]).includes(raw)
    ? (raw as MarketplaceFulfillmentMode)
    : null;
}

export function sellerIdOfListing(listing: ListingFulfillmentFields): string | undefined {
  return listing.seller_id || listing.user_id;
}

export function fulfillmentOptionsForListing(
  listing: ListingFulfillmentFields,
  prefs?: SellerFulfillmentPrefs | null,
): MarketplaceFulfillmentMode[] {
  if (isDigitalListingKind(listing.listing_kind)) return ['digital'];
  const options: MarketplaceFulfillmentMode[] = ['campus_meetup'];
  if (prefs?.hall_dropoff_enabled) options.push('hall_dropoff');
  if (prefs?.shipping_enabled) options.push('shipping');
  return options;
}

export function fulfillmentChipLabels(
  listing: ListingFulfillmentFields,
  prefs?: SellerFulfillmentPrefs | null,
): string[] {
  return fulfillmentOptionsForListing(listing, prefs).map((mode) => FULFILLMENT_LABELS[mode]);
}

/** Flat shipping fee for one seller group. Free when the item total clears the threshold. */
export function shippingFeeNaira(
  prefs: SellerFulfillmentPrefs | null | undefined,
  itemTotalNaira: number,
): number {
  if (!prefs?.shipping_enabled) return 0;
  const fee = Number(prefs.shipping_fee_naira);
  const quoted = Number.isFinite(fee) && fee > 0 ? fee : 0;
  const freeOver = Number(prefs.shipping_free_over_naira);
  if (Number.isFinite(freeOver) && freeOver > 0 && itemTotalNaira >= freeOver) return 0;
  return quoted;
}

export type CartGroupLine<T> = {
  listingId: string;
  sellerId: string;
  quantity: number;
  itemTotalNaira: number;
  source: T;
};

export type CartSellerGroup<T> = {
  sellerId: string;
  lines: CartGroupLine<T>[];
  itemTotalNaira: number;
};

export function groupLinesBySeller<T>(lines: CartGroupLine<T>[]): CartSellerGroup<T>[] {
  const bySeller = new Map<string, CartSellerGroup<T>>();
  for (const line of lines) {
    const existing = bySeller.get(line.sellerId);
    if (existing) {
      existing.lines.push(line);
      existing.itemTotalNaira += line.itemTotalNaira;
    } else {
      bySeller.set(line.sellerId, {
        sellerId: line.sellerId,
        lines: [line],
        itemTotalNaira: line.itemTotalNaira,
      });
    }
  }
  return [...bySeller.values()];
}

export function checkoutRequiresAddress(
  modes: readonly (MarketplaceFulfillmentMode | null | undefined)[],
): boolean {
  return modes.some((mode) => mode === 'shipping');
}
