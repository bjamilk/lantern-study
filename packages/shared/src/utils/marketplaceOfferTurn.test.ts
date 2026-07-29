import {
  canRespondToOffer,
  canWithdrawOffer,
  getOfferProposedBy,
} from './marketplaceOfferTurn';

const base = {
  buyer_id: 'buyer-1',
  seller_id: 'seller-1',
  status: 'pending' as const,
};

describe('marketplaceOfferTurn', () => {
  it('infers proposed_by from parent_offer_id when missing', () => {
    expect(getOfferProposedBy({ parent_offer_id: undefined })).toBe('buyer');
    expect(getOfferProposedBy({ parent_offer_id: 'parent' })).toBe('seller');
  });

  it('lets seller respond to buyer proposals only', () => {
    const offer = { ...base, proposed_by: 'buyer' as const };
    expect(canRespondToOffer(offer, 'seller-1')).toBe(true);
    expect(canRespondToOffer(offer, 'buyer-1')).toBe(false);
    expect(canWithdrawOffer(offer, 'buyer-1')).toBe(true);
  });

  it('lets buyer respond to seller counters only', () => {
    const offer = { ...base, proposed_by: 'seller' as const, parent_offer_id: 'p1' };
    expect(canRespondToOffer(offer, 'buyer-1')).toBe(true);
    expect(canRespondToOffer(offer, 'seller-1')).toBe(false);
    expect(canWithdrawOffer(offer, 'buyer-1')).toBe(false);
  });
});
