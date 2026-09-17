/**
 * The cancellation note that cannot report its own failure (#108, Phase B).
 *
 * When a cancel's side effects fail — a refund that threw, a listing that could
 * not be restored — the order is already `cancelled` and must stay that way, so
 * the code leaves a note on the row instead. That note write ends in
 *
 *   .then(undefined, (noteErr) => logger.error('Failed to record …', …))
 *
 * and the handler can NEVER run. `.then(undefined, onRejected)` waits for a
 * rejection, and a failed supabase-js write does not reject: it RESOLVES with
 * `{ error }`. So a half-finished cancellation whose note also failed is
 * completely silent — which is the opposite of what the note exists for.
 *
 * This is the same family as every other site in #108, wearing a different
 * spelling. It gets its own commit because the spelling is the point: a
 * rejection handler that looks like error handling and is not.
 */
import { scriptedDb, writePayload, type Call } from '../testSupport/scriptedDb';

const mockRefundPaymentForOrder = jest.fn();

jest.mock('./marketplacePayments', () => ({
  marketplacePaystackEnabled: () => true,
  getMarketplacePaymentsService: () => ({ refundPaymentForOrder: mockRefundPaymentForOrder }),
  orderPayoutReference: (id: string) => `ls_po_${id}`,
}));

jest.mock('./cache', () => ({
  cacheService: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    deletePattern: jest.fn(async () => undefined),
    invalidateUserCache: jest.fn(async () => undefined),
  },
  CacheService: class {},
}));

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
  listing_id: 'listing_1',
  payment_id: 'pay_1',
  transaction_id: 'txn_1',
  quantity: 1,
  amount: 1000,
  status: 'paid',
  listing: { title: 'Calc textbook' },
};

const WRITE_ERROR = { message: 'could not serialize access', code: '40001' };

/** The note write, told apart from the status transition by its payload. */
function isNote(call: Call): boolean {
  const patch = writePayload(call, 'update');
  return Boolean(call.table === 'marketplace_orders' && patch && 'cancellation_note' in patch);
}

async function cancelWith(noteFails: boolean) {
  const { MarketplaceOrdersService } = await import('./marketplaceOrders');
  const { client, calls } = scriptedDb((call) => {
    if (noteFails && isNote(call)) return { data: null, error: WRITE_ERROR };
    if (call.table === 'marketplace_orders' && writePayload(call, 'update')) {
      return { data: { ...ORDER, status: 'cancelled' }, error: null };
    }
    return { data: null, error: null };
  });

  const service: any = Object.create(MarketplaceOrdersService.prototype);
  service.host = {
    getClient: () => client,
    marketplace: {},
    notifications: { createNotification: jest.fn(async () => null) },
  };
  service.getOrderById = jest.fn(async () => ORDER);
  service.notifyOrderParty = jest.fn(async () => undefined);

  const run = () => service.updateOrderStatus('ord_1', 'buyer_1', 'cancel');
  return { run, calls };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.MARKETPLACE_PAYSTACK_CHECKOUT = 'true';
  // The side effect that sends the cancel into its catch: a refund that threw.
  mockRefundPaymentForOrder.mockRejectedValue(new Error('paystack refund declined'));
});

describe('a cancel whose side effect failed', () => {
  it('leaves the note and rethrows the side-effect error', async () => {
    const { run, calls } = await cancelWith(false);
    await expect(run()).rejects.toThrow(/refund declined/);
    const note = calls.find(isNote);
    expect(writePayload(note as Call, 'update')).toEqual({
      cancellation_note: expect.stringContaining('refund declined'),
    });
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('TODAY: the note write failing too', () => {
  it('cannot run its own rejection handler, so nothing is said at all', async () => {
    // `.then(undefined, handler)` waits for a rejection that never comes. The
    // cancellation is half-finished, the note is missing, and the only record
    // is the refund error the caller sees.
    const { run } = await cancelWith(true);
    await expect(run()).rejects.toThrow(/refund declined/);
    expect(logger.error).not.toHaveBeenCalledWith(
      'Failed to record cancellation note',
      expect.anything(),
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
