/**
 * Digital fulfillment invariants for digital orders (question banks + study
 * packs):
 * - non-digital orders return false and are untouched
 * - the order's listing_kind selects the delivering service
 * - a delivery failure halts the chain: no completion, no payout, so the money
 *   stays refundable (payout failure alone still self-heals via forcePayoutForOrder)
 */
const mockGrantBank = jest.fn();
const mockGrantPack = jest.fn();

jest.mock('./marketplaceQuestionBanks', () => ({
  getMarketplaceQuestionBanksService: () => ({
    grantEntitlement: (...args: unknown[]) => mockGrantBank(...args),
  }),
}));
jest.mock('./marketplaceStudyPacks', () => ({
  getMarketplaceStudyPacksService: () => ({
    grantEntitlement: (...args: unknown[]) => mockGrantPack(...args),
  }),
}));

import { MarketplacePaymentsService } from './marketplacePayments';

const ORDER = {
  id: 'order-1',
  listing_id: 'listing-1',
  buyer_id: 'buyer-1',
  seller_id: 'seller-1',
};

/** listing_kind: null → non-digital; 'question_bank' | 'study_pack' → digital. */
function makeSelf(orderRow: unknown, listingKind: string | null) {
  const releaseEscrow = jest.fn(async () => ({}));
  const notifyOrderParty = jest.fn(async () => undefined);
  const transferSellerPayout = jest.fn(async () => 'transferred');
  const from = (table: string) => {
    const chain: any = {};
    const self = () => chain;
    chain.select = self;
    chain.eq = self;
    chain.maybeSingle = async () => {
      if (table === 'marketplace_orders') return { data: orderRow, error: null };
      if (table === 'marketplace_listings')
        return { data: orderRow ? { listing_kind: listingKind } : null, error: null };
      return { data: null, error: null };
    };
    return chain;
  };
  return {
    self: {
      db: { from },
      supabaseService: {},
      orders: { releaseEscrow, notifyOrderParty },
      transferSellerPayout,
    },
    releaseEscrow,
    notifyOrderParty,
    transferSellerPayout,
  };
}

const run = (self: unknown, payment: Record<string, unknown> = { id: 'pay-1', status: 'paid' }) =>
  (MarketplacePaymentsService.prototype as any).fulfillDigitalOrderAfterPayment.call(
    self,
    'order-1',
    payment
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockGrantBank.mockResolvedValue({ bundleId: 'qbank-listing-1', questionCount: 10 });
  mockGrantPack.mockResolvedValue({ bundleId: 'pack-listing-1', deckId: 'deck-1', noteId: 'note-1', version: 1 });
});

describe('fulfillDigitalOrderAfterPayment', () => {
  it('returns false and does nothing for non-digital orders', async () => {
    const { self, releaseEscrow, transferSellerPayout } = makeSelf(ORDER, null);
    await expect(run(self)).resolves.toBe(false);
    expect(mockGrantBank).not.toHaveBeenCalled();
    expect(mockGrantPack).not.toHaveBeenCalled();
    expect(releaseEscrow).not.toHaveBeenCalled();
    expect(transferSellerPayout).not.toHaveBeenCalled();
  });

  it('delivers, completes, and pays out a question-bank order', async () => {
    const { self, releaseEscrow, transferSellerPayout, notifyOrderParty } = makeSelf(
      ORDER,
      'question_bank'
    );
    await expect(run(self)).resolves.toBe(true);
    expect(mockGrantBank).toHaveBeenCalledWith('listing-1', 'buyer-1', 'order-1');
    expect(mockGrantPack).not.toHaveBeenCalled();
    expect(releaseEscrow).toHaveBeenCalledWith('order-1', 'buyer-1');
    expect(transferSellerPayout).toHaveBeenCalledWith(
      'order-1',
      'seller-1',
      expect.objectContaining({ status: 'paid' })
    );
    expect(notifyOrderParty).toHaveBeenCalledWith(
      'buyer-1',
      expect.objectContaining({ data: expect.objectContaining({ questionBankDelivered: true }) })
    );
  });

  it('delivers a study-pack order via the study-pack service', async () => {
    const { self, releaseEscrow, transferSellerPayout, notifyOrderParty } = makeSelf(
      ORDER,
      'study_pack'
    );
    await expect(run(self)).resolves.toBe(true);
    expect(mockGrantPack).toHaveBeenCalledWith('listing-1', 'buyer-1', 'order-1');
    expect(mockGrantBank).not.toHaveBeenCalled();
    expect(releaseEscrow).toHaveBeenCalledWith('order-1', 'buyer-1');
    expect(transferSellerPayout).toHaveBeenCalled();
    expect(notifyOrderParty).toHaveBeenCalledWith(
      'buyer-1',
      expect.objectContaining({ data: expect.objectContaining({ studyPackDelivered: true }) })
    );
  });

  it('stops before completion and payout when delivery fails', async () => {
    // The buyer has nothing. Completing the order and paying the seller would
    // put the money past auto-refund for goods that were never delivered, so
    // the order stays open and the payment stays 'paid' (refundable) until a
    // later attempt delivers.
    mockGrantPack.mockRejectedValue(new Error('deck store down'));
    const { self, releaseEscrow, transferSellerPayout } = makeSelf(ORDER, 'study_pack');
    await expect(run(self)).resolves.toBe(true);
    expect(releaseEscrow).not.toHaveBeenCalled();
    expect(transferSellerPayout).not.toHaveBeenCalled();
  });

  it('still reports digital when payout fails (payment stays recoverable)', async () => {
    const { self, transferSellerPayout, releaseEscrow } = makeSelf(ORDER, 'question_bank');
    transferSellerPayout.mockRejectedValue(new Error('recipient inactive'));
    await expect(run(self)).resolves.toBe(true);
    expect(releaseEscrow).toHaveBeenCalled();
  });

  it('returns false when the order row is missing', async () => {
    const { self } = makeSelf(null, 'question_bank');
    await expect(run(self)).resolves.toBe(false);
  });
});
