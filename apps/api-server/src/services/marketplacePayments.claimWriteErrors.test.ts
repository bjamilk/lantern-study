/**
 * What GIVING A CLAIM BACK does when its write fails, and what happens to the
 * mismatch stamp (#108, Phase B).
 *
 * Three writes, each already wrapped in a `try/catch` that logs — and each
 * catch is DEAD CODE, because a failed supabase-js write resolves rather than
 * rejecting. So today the log those three functions promise never appears.
 *
 *  - `releaseOrderPayoutClaim` — puts an order's `payout_status` back to
 *    `pending` after a payout attempt that never moved money.
 *  - `releaseRefundHold` — the same for a `refund_hold` when the refund did not
 *    happen.
 *  - `recordSettlementMismatch` — stamps the payment row when captured funds do
 *    not match what was initialised.
 *
 * ## Why a stuck claim matters, and for how long
 *
 * Both claims are single slots with NO expiry and no sweeper. The payout CAS
 * only moves `pending → paying`, and the refund hold only `pending →
 * refund_hold`, so an order left at `paying` can never be paid out again, and
 * one left at `refund_hold` refuses both the payout and every later refund
 * ("A refund for this order is already in progress"). Nothing times out: it is
 * until a `transfer.failed` / `transfer.reversed` webhook arrives (and on this
 * path none will, because no transfer was made), an admin intervenes, or the
 * reconciliation job in #113 runs. Money is never at risk — both releases only
 * run where nothing moved — but the seller is not paid and the buyer cannot be
 * refunded until someone acts.
 *
 * That is exactly why the release failing must be VISIBLE, and why it must not
 * throw over the error that caused the release.
 */
import { scriptedDb, writePayload, type Call } from '../testSupport/scriptedDb';

const mockRefundPaystackTransaction = jest.fn();

jest.mock('./paystack', () => ({
  createPaystackReference: (prefix = 'ls') => `${prefix}_test_ref`,
  createPaystackTransferRecipient: jest.fn(),
  getPaystackPublicKey: () => 'pk_test',
  initializePaystackTransaction: jest.fn(),
  initiatePaystackTransfer: jest.fn(),
  isPaystackConfigured: () => true,
  paystackMode: () => 'test',
  assertPaystackLiveKeyInProduction: () => {},
  refundPaystackTransaction: (...args: unknown[]) => mockRefundPaystackTransaction(...args),
  resolvePaystackAccount: jest.fn(),
  verifyPaystackSignature: () => true,
  verifyPaystackTransaction: jest.fn(),
}));

const mockGetOrderById = jest.fn();
const mockGetOrderByIdAdmin = jest.fn();

jest.mock('./marketplaceOrders', () => {
  class MarketplaceOrdersService {
    getOrderById = mockGetOrderById;
    getOrderByIdAdmin = mockGetOrderByIdAdmin;
    releaseEscrow = jest.fn();
    notifyOrderParty = jest.fn();
    stampOrderPaidAt = jest.fn();
  }
  return {
    MarketplaceOrdersService,
    invalidateSellerAnalyticsCache: jest.fn(),
    resolveEffectivePrice: () => 1000,
  };
});

jest.mock('../utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), http: jest.fn() },
}));
jest.mock('../utils/sentry', () => ({
  captureException: jest.fn(),
  captureScopedException: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { logger } = require('../utils/logger') as { logger: { error: jest.Mock; warn: jest.Mock } };

const ORDER = {
  id: 'ord_1',
  buyer_id: 'buyer_1',
  seller_id: 'seller_1',
  payment_id: 'pay_1',
  amount: 1000,
  shipping_amount: 0,
  status: 'paid',
};

type Scenario = 'payout_claim' | 'refund_hold' | 'mismatch';
type FailingWrite = 'none' | 'release';

const WRITE_ERROR = { message: 'could not serialize access', code: '40001' };

/** The release write each scenario is about. */
function isRelease(scenario: Scenario, call: Call): boolean {
  const patch = writePayload(call, 'update');
  if (!patch) return false;
  if (scenario === 'payout_claim') {
    return call.table === 'marketplace_orders' && patch.payout_status === 'pending' && 'payout_failed_reason' in patch;
  }
  if (scenario === 'refund_hold') {
    return (
      call.table === 'marketplace_orders' &&
      patch.payout_status === 'pending' &&
      !('payout_failed_reason' in patch)
    );
  }
  return call.table === 'marketplace_payments' && 'metadata' in patch && !('status' in patch);
}

function buildService(scenario: Scenario, failOn: FailingWrite) {
  const payment = {
    id: 'pay_1',
    buyer_id: 'buyer_1',
    seller_id: 'seller_1',
    order_id: 'ord_1',
    // Both claim scenarios need the CART branch: that is where the payout
    // claim and the refund hold both live on the order row.
    checkout_id: scenario === 'mismatch' ? null : 'chk_1',
    status: scenario === 'mismatch' ? 'refunded' : 'paid',
    paystack_mode: 'test',
    paystack_reference: 'ls_buy_ref',
    paystack_transaction_id: '99',
    total_charged_kobo: 105_000,
    item_amount_kobo: 100_000,
    seller_payout_kobo: 95_000,
    metadata: {},
  };

  const { client, calls } = scriptedDb((call) => {
    if (failOn === 'release' && isRelease(scenario, call)) {
      return { data: null, error: WRITE_ERROR };
    }
    if (call.table === 'marketplace_seller_payout_profiles') {
      // Inactive on purpose: the payout claim is taken and then has to be
      // given back, without any money moving.
      return { data: { paystack_recipient_code: null, status: 'inactive' }, error: null };
    }
    if (call.table === 'marketplace_payments') {
      const patch = writePayload(call, 'update');
      if (patch && patch.status === 'refunding') return { data: { id: 'pay_1' }, error: null };
      if (patch) return { data: null, error: null };
      return { data: payment, error: null };
    }
    if (call.table === 'marketplace_orders') {
      const patch = writePayload(call, 'update');
      // Both claims are won, so both have something to give back.
      if (patch && (patch.payout_status === 'paying' || patch.payout_status === 'refund_hold')) {
        return { data: { id: 'ord_1', payout_attempt: 0, seller_payout_kobo: 95_000 }, error: null };
      }
      if (patch) return { data: null, error: null };
      if (call.terminal === 'then') return { data: [{ id: 'ord_1', status: 'paid' }], error: null };
      return { data: { payout_status: 'pending' }, error: null };
    }
    return { data: null, error: null };
  });

  const host = { getClient: () => client, marketplace: {} } as never;
  return { host, calls };
}

async function serviceFor(scenario: Scenario, failOn: FailingWrite) {
  const { MarketplacePaymentsService } = await import('./marketplacePayments');
  const { host, calls } = buildService(scenario, failOn);
  return { service: new MarketplacePaymentsService(host), calls };
}

/** An amount Paystack never charged: the mismatch path. */
const MISMATCHED_CHARGE = JSON.stringify({
  event: 'charge.success',
  data: { id: 99, reference: 'ls_buy_ref', amount: 1, currency: 'NGN' },
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
  mockGetOrderById.mockResolvedValue(ORDER);
  mockGetOrderByIdAdmin.mockResolvedValue(ORDER);
  mockRefundPaystackTransaction.mockRejectedValue(new Error('paystack refund declined'));
});

describe('with every write succeeding', () => {
  it('gives the payout claim back when the seller cannot be paid', async () => {
    const { service, calls } = await serviceFor('payout_claim', 'none');
    await expect(service.forcePayoutForOrder('ord_1')).rejects.toThrow(/payout profile/i);
    expect(calls.some((call) => isRelease('payout_claim', call))).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('gives the refund hold back when the refund did not happen', async () => {
    const { service, calls } = await serviceFor('refund_hold', 'none');
    await expect(service.refundPaymentForOrder('ord_1', 'buyer_1')).rejects.toThrow(
      /refund declined/,
    );
    expect(calls.some((call) => isRelease('refund_hold', call))).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('stamps a settlement mismatch on the payment row', async () => {
    const { service, calls } = await serviceFor('mismatch', 'none');
    await service.handleWebhook(MISMATCHED_CHARGE, 'sig');
    expect(calls.some((call) => isRelease('mismatch', call))).toBe(true);
    // The mismatch itself is already loud; that is not what this lane changes.
    expect(logger.error).toHaveBeenCalledWith('Paystack settlement mismatch', expect.anything());
  });
});

describe('TODAY: the release itself failing', () => {
  it('says nothing when the payout claim could not be given back', async () => {
    // The order is left at `paying` for good: the payout CAS only moves
    // `pending → paying`, nothing expires it, and no transfer webhook is coming
    // because no transfer was made.
    const { service } = await serviceFor('payout_claim', 'release');
    await expect(service.forcePayoutForOrder('ord_1')).rejects.toThrow(/payout profile/i);
    expect(logger.error).not.toHaveBeenCalledWith(
      'Failed to release order payout claim',
      expect.anything(),
    );
  });

  it('says nothing when the refund hold could not be given back', async () => {
    // Left at `refund_hold`, which refuses the payout AND every later refund.
    const { service } = await serviceFor('refund_hold', 'release');
    await expect(service.refundPaymentForOrder('ord_1', 'buyer_1')).rejects.toThrow(
      /refund declined/,
    );
    expect(logger.error).not.toHaveBeenCalledWith('Failed to release refund hold', expect.anything());
  });

  it('says nothing when the mismatch stamp could not be written', async () => {
    // The Sentry event still fires, but the durable half of the only trace that
    // money was captured without settling an order is silently lost.
    const { service } = await serviceFor('mismatch', 'release');
    await expect(service.handleWebhook(MISMATCHED_CHARGE, 'sig')).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
