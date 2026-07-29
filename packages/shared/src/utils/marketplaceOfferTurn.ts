import type { MarketplaceOffer } from '../types';

/** Whose proposal this offer row represents (fallback for pre-migration rows). */
export function getOfferProposedBy(
  offer: Pick<MarketplaceOffer, 'proposed_by' | 'parent_offer_id'>,
): 'buyer' | 'seller' {
  if (offer.proposed_by === 'buyer' || offer.proposed_by === 'seller') {
    return offer.proposed_by;
  }
  return offer.parent_offer_id ? 'seller' : 'buyer';
}

/** True when `userId` may accept / decline / counter this pending offer. */
export function canRespondToOffer(
  offer: Pick<MarketplaceOffer, 'proposed_by' | 'parent_offer_id' | 'buyer_id' | 'seller_id' | 'status'>,
  userId: string,
): boolean {
  if (offer.status !== 'pending') return false;
  const proposedBy = getOfferProposedBy(offer);
  const responderId = proposedBy === 'seller' ? offer.buyer_id : offer.seller_id;
  return responderId === userId;
}

/** True when buyer may withdraw their own pending proposal. */
export function canWithdrawOffer(
  offer: Pick<MarketplaceOffer, 'proposed_by' | 'parent_offer_id' | 'buyer_id' | 'status'>,
  userId: string,
): boolean {
  if (offer.status !== 'pending') return false;
  if (offer.buyer_id !== userId) return false;
  return getOfferProposedBy(offer) === 'buyer';
}
