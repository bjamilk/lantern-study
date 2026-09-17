/**
 * What the SELLER PAYOUT path does when one of its writes FAILS (#108, Phase B).
 *
 * Every write here sits on one side or the other of an irreversible Paystack
 * transfer, and which side it is on decides everything:
 *
 *  - `payout_transfer_code` + `metadata.payoutReference`, stamped AFTER the
 *    transfer returned. The money is gone. (The cart branch's twin of this
 *    write is already checked and logged; this single-order one was missed.)
 *  - the rollback in the `catch`, run when the transfer call threw. It may have
 *    reached Paystack anyway, and a failed rollback wedges the payment at
 *    `payout_pending` with a claim marker no webhook can match.
 *  - `finalizeOrderPayout` and `markPaymentPaidOut`, which record a payout as
 *    settled. These have TWO callers with opposite needs, which is the whole
 *    difficulty: a `transfer.success` WEBHOOK wants a non-2xx so Paystack
 *    re-delivers, while the INLINE call right after a successful transfer must
 *    not 500 a buyer's confirm-received for a payout that actually worked.
 *
 * Both callers of both functions are driven below.
 */
import { scriptedDb, writePayload, type Call } from '../testSupport/scriptedDb';

const mockInitiatePaystackTransfer = jest.fn();

jest.mock('./paystack', () => ({
  createPaystackReference: (prefix = 'ls') => `${prefix}_test_ref`,
  createPaystackTransferRecipient: jest.fn(),
  getPaystackPublicKey: () => 'pk_test',
  initializePaystackTransaction: jest.fn(),
  initiatePaystackTransfer: (...args: unknown[]) => mockInitiatePaystackTransfer(...args),
  isPaystackConfigured: () => true,
  paystackMode: () => 'test',
  assertPaystackLiveKeyInProduction: () => {},
  refundPaystackTransaction: jest.fn(),
  resolvePaystackAccount: jest.fn(),
  verifyPaystackSignature: () => true,
  verifyPaystackTransaction: jest.fn(),
}));

const mockGetOrderByIdAdmin = jest.fn();
const mockGetOrderById = jest.fn();
const mockReleaseEscrow = jest.fn();

jest.mock('./marketplaceOrders', () => {
  class MarketplaceOrdersService {
    getOrderById = mockGetOrderById;
    getOrderByIdAdmin = mockGetOrderByIdAdmin;
    releaseEscrow = mockReleaseEscrow;
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
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { captureScopedException } = require('../utils/sentry') as {
  captureScopedException: jest.Mock;
};

const ORDER = { id: 'ord_1', seller_id: 'seller_1', buyer_id: 'buyer_1', payment_id: 'pay_1' };

/** A single-order payment: payout state lives on the payment row itself. */
const PAID_PAYMENT = {
  id: 'pay_1',
  buyer_id: 'buyer_1',
  seller_id: 'seller_1',
  order_id: 'ord_1',
  checkout_id: null,
  status: 'paid',
  paystack_mode: 'test',
  item_amount_kobo: 100_000,
  seller_payout_kobo: 95_000,
  payout_attempt: 0,
  metadata: {},
};

const LOCKED = { ...PAID_PAYMENT, status: 'payout_pending' };

type FailingWrite = 'none' | 'transfer_stamp' | 'rollback' | 'paid_out' | 'order_paid_out';

const WRITE_ERROR = { message: 'could not serialize access', code: '40001' };

function which(call: Call): FailingWrite | 'other' {
  if (call.table === 'marketplace_payments') {
    const patch = writePayload(call, 'update');
    if (!patch) return 'other';
    if (patch.status === 'paid_out') return 'paid_out';
    if (patch.status === 'paid' && 'payout_failed_reason' in patch) return 'rollback';
    if ('payout_transfer_code' in patch && !('status' in patch)) return 'transfer_stamp';
    return 'other';
  }
  if (call.table === 'marketplace_orders') {
    const patch = writePayload(call, 'update');
    if (patch && patch.payout_status === 'paid_out') return 'order_paid_out';
  }
  return 'other';
}

function buildService(failOn: FailingWrite) {
  const { client, calls } = scriptedDb((call) => {
    if (which(call) === failOn) return { data: null, error: WRITE_ERROR };
    if (call.table === 'marketplace_seller_payout_profiles') {
      return { data: { paystack_recipient_code: 'RCP_1', status: 'active' }, error: null };
    }
    if (call.table === 'marketplace_payments') {
      const patch = writePayload(call, 'update');
      // The claim CAS returns the row it locked; that is what proves the caller
      // won it and may go on to move money.
      if (patch && patch.status === 'payout_pending') return { data: LOCKED, error: null };
      if (patch) return { data: null, error: null };
      return { data: PAID_PAYMENT, error: null };
    }
    return { data: null, error: null };
  });

  const host = { getClient: () => client, marketplace: {} } as never;
  return { host, calls };
}

async function serviceFor(failOn: FailingWrite) {
  const { MarketplacePaymentsService } = await import('./marketplacePayments');
  const { host, calls } = buildService(failOn);
  return { service: new MarketplacePaymentsService(host), calls };
}

const TRANSFER_SUCCESS = JSON.stringify({
  event: 'transfer.success',
  data: { transfer_code: 'TRF_1', reference: 'ls_po_ref' },
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
  mockGetOrderByIdAdmin.mockResolvedValue(ORDER);
  mockGetOrderById.mockResolvedValue({ ...ORDER, status: 'ready_for_pickup', amount: 1000 });
  mockReleaseEscrow.mockResolvedValue({ id: 'ord_1', status: 'completed' });
  mockInitiatePaystackTransfer.mockResolvedValue({
    transferCode: 'TRF_1',
    reference: 'ls_po_ref',
    status: 'success',
  });
});

describe('a single-order payout, with every write succeeding', () => {
  it('claims, transfers, stamps the code and settles the payment', async () => {
    const { service, calls } = await serviceFor('none');
    await service.forcePayoutForOrder('ord_1');

    expect(mockInitiatePaystackTransfer).toHaveBeenCalledTimes(1);
    expect(calls.some((call) => which(call) === 'transfer_stamp')).toBe(true);
    expect(calls.some((call) => which(call) === 'paid_out')).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(captureScopedException).not.toHaveBeenCalled();
  });

  it('stamps the real code only under this attempt’s own claim marker', async () => {
    const { service, calls } = await serviceFor('none');
    await service.forcePayoutForOrder('ord_1');
    const stamp = calls.find((call) => which(call) === 'transfer_stamp');
    expect(stamp?.ops.some((op) => op.fn === 'eq' && op.args[0] === 'payout_transfer_code')).toBe(
      true,
    );
  });
});

describe('TODAY: a payout write failing', () => {
  it('reports the payout as done when the transfer code was never stamped', async () => {
    // The money has left. Nothing records where it went, and nothing is logged.
    const { service } = await serviceFor('transfer_stamp');
    await expect(service.forcePayoutForOrder('ord_1')).resolves.toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('says nothing when the rollback after a failed transfer fails', async () => {
    // The payment is left at `payout_pending` holding a claim marker no webhook
    // can match: the seller is never paid and the buyer's refund is refused
    // with "Payout in progress".
    mockInitiatePaystackTransfer.mockRejectedValue(new Error('paystack timeout'));
    const { service } = await serviceFor('rollback');
    await expect(service.forcePayoutForOrder('ord_1')).rejects.toThrow(/paystack timeout/);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('says nothing when the payment could not be marked paid_out inline', async () => {
    const { service } = await serviceFor('paid_out');
    await expect(service.forcePayoutForOrder('ord_1')).resolves.toBeUndefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('answers ok to a transfer.success WEBHOOK that could not be recorded', async () => {
    // Paystack is told the event is handled, so it never re-delivers, and the
    // payment stays `payout_pending` for money the seller already has.
    const { service } = await serviceFor('paid_out');
    await expect(service.handleWebhook(TRANSFER_SUCCESS, 'sig')).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );
  });
});
