/**
 * What a REFUND does when one of its writes FAILS (#108, Phase B).
 *
 * Five bare awaited writes, on both sides of the one Paystack call:
 *
 *  - voiding a payment that was never charged (`initialized` → `failed`).
 *    Nothing was captured, so this is the one refund write that can simply
 *    stop.
 *  - the rollback in the `catch`, when the Paystack refund call threw.
 *  - the `refunded` + `refund_reference` stamp, written once Paystack has
 *    ALREADY paid the money back.
 *  - the release back to `paid` when a sibling order in the same cart is still
 *    open, so the charge as a whole is not refunded.
 *  - the order's `payout_status: skipped`, which is what stops a late
 *    transfer.success paying a seller for a refunded order.
 *
 * The last three are the shape the founder ruled on (2026-09-17): the money has
 * already moved, so throwing would tell the buyer their refund failed when
 * Paystack has already paid it, and a retry is refused anyway because the claim
 * is held. They report and carry on.
 *
 * ## The gotcha
 *
 * The rollback and the sibling release write the IDENTICAL payload —
 * `{ status: 'paid' }` filtered on `status = 'refunding'` — because they mean
 * the same thing to the database and different things to us. They are told
 * apart here by which scenario is running, never by the payload.
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

jest.mock('./marketplaceOrders', () => {
  class MarketplaceOrdersService {
    getOrderById = mockGetOrderById;
    getOrderByIdAdmin = jest.fn();
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

const PAID_PAYMENT = {
  id: 'pay_1',
  buyer_id: 'buyer_1',
  seller_id: 'seller_1',
  order_id: 'ord_1',
  checkout_id: null as string | null,
  status: 'paid',
  paystack_mode: 'test',
  paystack_reference: 'ls_buy_ref',
  paystack_transaction_id: '99',
  total_charged_kobo: 105_000,
};

type FailingWrite = 'none' | 'void_initialized' | 'release_to_paid' | 'refund_stamp' | 'order_skipped';

const WRITE_ERROR = { message: 'could not serialize access', code: '40001' };

function which(call: Call): FailingWrite | 'claim' | 'hold' | 'other' {
  if (call.table === 'marketplace_payments') {
    const patch = writePayload(call, 'update');
    if (!patch) return 'other';
    if (patch.status === 'failed') return 'void_initialized';
    if (patch.status === 'refunding') return 'claim';
    if (patch.status === 'refunded') return 'refund_stamp';
    if (patch.status === 'paid') return 'release_to_paid';
    return 'other';
  }
  if (call.table === 'marketplace_orders') {
    const patch = writePayload(call, 'update');
    if (!patch) return 'other';
    if (patch.payout_status === 'refund_hold') return 'hold';
    if (patch.payout_status === 'skipped') return 'order_skipped';
  }
  return 'other';
}

function buildService(
  failOn: FailingWrite,
  options: { paymentStatus?: string; checkoutId?: string | null; siblingOpen?: boolean } = {},
) {
  const payment = {
    ...PAID_PAYMENT,
    status: options.paymentStatus ?? 'paid',
    checkout_id: options.checkoutId ?? null,
  };
  const { client, calls } = scriptedDb((call) => {
    if (which(call) === failOn) return { data: null, error: WRITE_ERROR };
    if (call.table === 'marketplace_payments') {
      const patch = writePayload(call, 'update');
      // The refund claim CAS returns the row it took; that is what proves this
      // caller, and only this caller, may call Paystack.
      if (patch && patch.status === 'refunding') return { data: { id: 'pay_1' }, error: null };
      if (patch) return { data: null, error: null };
      return { data: payment, error: null };
    }
    if (call.table === 'marketplace_orders') {
      const patch = writePayload(call, 'update');
      if (patch && patch.payout_status === 'refund_hold') return { data: { id: 'ord_1' }, error: null };
      if (patch) return { data: null, error: null };
      // The sibling roster: an un-terminated chain.
      if (call.terminal === 'then') {
        return {
          data: options.siblingOpen
            ? [
                { id: 'ord_1', status: 'paid' },
                { id: 'ord_2', status: 'paid' },
              ]
            : [{ id: 'ord_1', status: 'paid' }],
          error: null,
        };
      }
      return { data: { payout_status: 'pending' }, error: null };
    }
    return { data: null, error: null };
  });

  const host = { getClient: () => client, marketplace: {} } as never;
  return { host, calls };
}

async function serviceFor(
  failOn: FailingWrite,
  options: { paymentStatus?: string; checkoutId?: string | null; siblingOpen?: boolean } = {},
) {
  const { MarketplacePaymentsService } = await import('./marketplacePayments');
  const { host, calls } = buildService(failOn, options);
  return { service: new MarketplacePaymentsService(host), calls };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
  mockGetOrderById.mockResolvedValue(ORDER);
  mockRefundPaystackTransaction.mockResolvedValue({ id: 4242 });
});

describe('a refund, with every write succeeding', () => {
  it('claims the payment, refunds at Paystack and stamps the reference', async () => {
    const { service, calls } = await serviceFor('none');
    await service.refundPaymentForOrder('ord_1', 'buyer_1');

    expect(mockRefundPaystackTransaction).toHaveBeenCalledTimes(1);
    expect(calls.some((call) => which(call) === 'claim')).toBe(true);
    const stamp = calls.find((call) => which(call) === 'refund_stamp');
    expect(writePayload(stamp as Call, 'update')).toEqual(
      expect.objectContaining({ refund_reference: '4242' }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('releases a cart charge back to paid and skips the order’s payout', async () => {
    const { service, calls } = await serviceFor('none', {
      checkoutId: 'chk_1',
      siblingOpen: true,
    });
    await service.refundPaymentForOrder('ord_1', 'buyer_1');
    expect(calls.some((call) => which(call) === 'release_to_paid')).toBe(true);
    expect(calls.some((call) => which(call) === 'refund_stamp')).toBe(false);
    expect(calls.some((call) => which(call) === 'order_skipped')).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('voids a payment that was never charged, without calling Paystack', async () => {
    const { service, calls } = await serviceFor('none', { paymentStatus: 'initialized' });
    await service.refundPaymentForOrder('ord_1', 'buyer_1');
    expect(mockRefundPaystackTransaction).not.toHaveBeenCalled();
    expect(calls.some((call) => which(call) === 'void_initialized')).toBe(true);
  });
});

describe('TODAY: a refund write failing', () => {
  it('reports success when an uncharged payment was never voided', async () => {
    // The row stays `initialized`, so a late charge.success against its
    // reference can still settle an order the buyer just cancelled.
    const { service } = await serviceFor('void_initialized', { paymentStatus: 'initialized' });
    await expect(service.refundPaymentForOrder('ord_1', 'buyer_1')).resolves.toBeUndefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('says nothing when the refunded stamp fails after Paystack paid it back', async () => {
    // The buyer has their money. The row is stuck at `refunding`, which refuses
    // every later refund AND the payout, and `refund_reference` is lost.
    const { service } = await serviceFor('refund_stamp');
    await expect(service.refundPaymentForOrder('ord_1', 'buyer_1')).resolves.toBeUndefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('says nothing when the sibling release fails', async () => {
    const { service } = await serviceFor('release_to_paid', {
      checkoutId: 'chk_1',
      siblingOpen: true,
    });
    await expect(service.refundPaymentForOrder('ord_1', 'buyer_1')).resolves.toBeUndefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('says nothing when the refunded order was never marked unpayable', async () => {
    const { service } = await serviceFor('order_skipped', {
      checkoutId: 'chk_1',
      siblingOpen: true,
    });
    await expect(service.refundPaymentForOrder('ord_1', 'buyer_1')).resolves.toBeUndefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('says nothing when the rollback after a failed Paystack refund fails', async () => {
    mockRefundPaystackTransaction.mockRejectedValue(new Error('paystack refund declined'));
    const { service } = await serviceFor('release_to_paid');
    await expect(service.refundPaymentForOrder('ord_1', 'buyer_1')).rejects.toThrow(
      /refund declined/,
    );
    expect(logger.error).not.toHaveBeenCalled();
  });
});
