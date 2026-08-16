/**
 * Digital fulfillment invariants for question-bank orders:
 * - non-digital orders return false and are untouched
 * - delivery, completion, and payout each run; a failure in one never blocks
 *   the others (delivery self-heals via restore; payout via forcePayoutForOrder)
 */
const mockIsQuestionBank = jest.fn();
const mockGrantEntitlement = jest.fn();

jest.mock('./marketplaceQuestionBanks', () => ({
  getMarketplaceQuestionBanksService: () => ({
    isQuestionBankListing: (...args: unknown[]) => mockIsQuestionBank(...args),
    grantEntitlement: (...args: unknown[]) => mockGrantEntitlement(...args),
  }),
}));

import { MarketplacePaymentsService } from './marketplacePayments';

const ORDER = {
  id: 'order-1',
  listing_id: 'listing-1',
  buyer_id: 'buyer-1',
  seller_id: 'seller-1',
};

function makeSelf(orderRow: unknown) {
  const releaseEscrow = jest.fn(async () => ({}));
  const notifyOrderParty = jest.fn(async () => undefined);
  const transferSellerPayout = jest.fn(async () => 'transferred');
  const chain: any = {};
  const self = () => chain;
  chain.select = self;
  chain.eq = self;
  chain.maybeSingle = async () => ({ data: orderRow, error: null });
  return {
    self: {
      db: { from: () => chain },
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
  (MarketplacePaymentsService.prototype as any).fulfillQuestionBankOrderIfDigital.call(
    self,
    'order-1',
    payment
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockIsQuestionBank.mockResolvedValue(true);
  mockGrantEntitlement.mockResolvedValue({ bundleId: 'qbank-listing-1', questionCount: 10 });
});

describe('fulfillQuestionBankOrderIfDigital', () => {
  it('returns false and does nothing for non-digital orders', async () => {
    mockIsQuestionBank.mockResolvedValue(false);
    const { self, releaseEscrow, transferSellerPayout } = makeSelf(ORDER);
    await expect(run(self)).resolves.toBe(false);
    expect(mockGrantEntitlement).not.toHaveBeenCalled();
    expect(releaseEscrow).not.toHaveBeenCalled();
    expect(transferSellerPayout).not.toHaveBeenCalled();
  });

  it('delivers, completes, and pays out a digital order', async () => {
    const { self, releaseEscrow, transferSellerPayout, notifyOrderParty } = makeSelf(ORDER);
    await expect(run(self)).resolves.toBe(true);
    expect(mockGrantEntitlement).toHaveBeenCalledWith('listing-1', 'buyer-1', 'order-1');
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

  it('still completes and pays out when delivery fails', async () => {
    mockGrantEntitlement.mockRejectedValue(new Error('bundle store down'));
    const { self, releaseEscrow, transferSellerPayout } = makeSelf(ORDER);
    await expect(run(self)).resolves.toBe(true);
    expect(releaseEscrow).toHaveBeenCalled();
    expect(transferSellerPayout).toHaveBeenCalled();
  });

  it('still reports digital when payout fails (payment stays recoverable)', async () => {
    const { self, transferSellerPayout, releaseEscrow } = makeSelf(ORDER);
    transferSellerPayout.mockRejectedValue(new Error('recipient inactive'));
    await expect(run(self)).resolves.toBe(true);
    expect(releaseEscrow).toHaveBeenCalled();
  });

  it('returns false when the order row is missing', async () => {
    const { self } = makeSelf(null);
    await expect(run(self)).resolves.toBe(false);
  });
});
