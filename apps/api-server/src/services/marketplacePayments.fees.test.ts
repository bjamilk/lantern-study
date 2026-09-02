/**
 * Fee-model regression (Phase 2 · I).
 *
 * createCheckoutForExistingOrder serves offer-accept AND the resume-checkout
 * fall-through from getCheckoutSessionForOrder, which carries orders of ANY
 * kind. It used to hardcode the PHYSICAL maths (5% buyer surcharge,
 * platform_fee 0, payout = full item), so a digital order re-entering checkout
 * was overcharged and the creator commission was silently lost.
 */
jest.mock('./paystack', () => ({
  isPaystackConfigured: () => true,
  createPaystackReference: () => 'ref_test',
  initializePaystackTransaction: jest.fn(async () => ({
    authorizationUrl: 'https://checkout.paystack.com/x',
    accessCode: 'x',
    reference: 'ref_test',
  })),
  getPaystackPublicKey: () => 'pk_test',
  initiatePaystackTransfer: jest.fn(),
  refundPaystackTransaction: jest.fn(),
  verifyPaystackTransaction: jest.fn(),
}));

import { MarketplacePaymentsService } from './marketplacePayments';

type Row = { data: unknown; error?: unknown };

function makeSelf(listingKind: string, amountNaira: number) {
  const inserts: Array<{ table: string; payload: any }> = [];
  const from = (table: string) => {
    const api: any = {};
    const self = () => api;
    api.select = self;
    api.eq = self;
    api.in = self;
    api.order = self;
    api.limit = self;
    api.update = () => api;
    api.insert = (payload: any) => {
      inserts.push({ table, payload });
      api.__inserted = payload;
      return api;
    };
    api.single = async (): Promise<Row> => {
      if (table === 'marketplace_payments') return { data: { id: 'pay-1', ...api.__inserted }, error: null };
      return { data: null, error: null };
    };
    api.maybeSingle = async (): Promise<Row> => {
      if (table === 'marketplace_listings') return { data: { listing_kind: listingKind }, error: null };
      return { data: null, error: null };
    };
    api.then = (resolve: (v: Row) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
    return api;
  };

  const self: any = {
    db: { from },
    supabaseService: {},
    orders: {
      getOrderById: jest.fn(async () => ({
        id: 'order-1',
        buyer_id: 'buyer-1',
        seller_id: 'seller-1',
        listing_id: 'listing-1',
        amount: amountNaira,
        payment_id: null,
        status: 'awaiting_payment',
      })),
    },
    assertSellerCanReceivePayout: jest.fn(async () => undefined),
  };
  return { self, inserts };
}

const run = (self: unknown) =>
  (MarketplacePaymentsService.prototype as any).createCheckoutForExistingOrder.call(self, {
    orderId: 'order-1',
    buyerId: 'buyer-1',
    buyerEmail: 'b@example.com',
  });

beforeEach(() => {
  process.env.MARKETPLACE_PAYSTACK_CHECKOUT = 'true';
  jest.clearAllMocks();
});

describe('createCheckoutForExistingOrder fee model', () => {
  it('digital order: buyer pays list price and the 15% commission is withheld', async () => {
    const { self, inserts } = makeSelf('study_pack', 5000);
    await run(self);
    const payment = inserts.find((i) => i.table === 'marketplace_payments')!.payload;
    expect(payment.item_amount_kobo).toBe(500_000);
    // No buyer surcharge on digital…
    expect(payment.service_fee_kobo).toBe(0);
    expect(payment.total_charged_kobo).toBe(500_000);
    // …and the platform's cut comes out of the creator's payout.
    expect(payment.platform_fee_kobo).toBe(75_000);
    expect(payment.seller_payout_kobo).toBe(425_000);
  });

  it('physical order charges the buyer the list price and pays the seller 95% of it', async () => {
    const { self, inserts } = makeSelf('single', 5000);
    await run(self);
    const payment = inserts.find((i) => i.table === 'marketplace_payments')!.payload;
    // Until 2026-09-02 this was +25_000 on the buyer and the full 500_000 to the
    // seller. The 5% moved into the price: nothing on top, Lantern keeps 25_000.
    expect(payment.service_fee_kobo).toBe(0);
    expect(payment.total_charged_kobo).toBe(500_000);
    expect(payment.platform_fee_kobo).toBe(25_000);
    expect(payment.seller_payout_kobo).toBe(475_000);
  });

  it('always satisfies the DB split invariant', async () => {
    for (const kind of ['study_pack', 'question_bank', 'single', 'bundle']) {
      const { self, inserts } = makeSelf(kind, 1234);
      await run(self);
      const p = inserts.find((i) => i.table === 'marketplace_payments')!.payload;
      expect(p.seller_payout_kobo + p.platform_fee_kobo).toBe(p.item_amount_kobo);
      expect(p.total_charged_kobo).toBe(p.item_amount_kobo + p.service_fee_kobo);
    }
  });
});
