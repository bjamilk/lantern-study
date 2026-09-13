import { resolveListingDisplayPrice } from '../utils';
import { groupLinesBySeller, sellerIdOfListing, type CartSellerGroup } from './fulfillment';
import type { MarketplaceCartItem } from '../types';

export function groupCartItems(
  items: MarketplaceCartItem[],
): CartSellerGroup<MarketplaceCartItem>[] {
  return groupLinesBySeller(
    items.map((item) => {
      const listing = item.listing;
      const unit = listing ? resolveListingDisplayPrice(listing).effective : 0;
      return {
        listingId: item.listing_id,
        sellerId: listing ? sellerIdOfListing(listing) || 'unknown' : 'unknown',
        quantity: item.quantity,
        itemTotalNaira: unit * item.quantity,
        source: item,
      };
    }),
  );
}
