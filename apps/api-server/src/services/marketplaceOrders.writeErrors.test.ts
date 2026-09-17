/**
 * What the ORDER lifecycle does when one of its writes FAILS (#108, Phase B).
 *
 * Six bare awaited writes across four flows:
 *
 *  - `confirm_received` → `buyer_confirmed_at`, stamped immediately BEFORE the
 *    seller payout it authorises;
 *  - `open_dispute` → the `marketplace_transactions` mirror;
 *  - `cancel` → the transactions mirror again (`refundEscrow`) and the listing
 *    stock restore, both AFTER a refund has been issued;
 *  - escrow release → the inquiry that led to the sale, closed out;
 *  - admin dispute resolution → the outcome stamp the seller's trust score is
 *    counted from.
 *
 * ## The two that are not best-effort
 *
 * `buyer_confirmed_at` is written while nothing external has happened yet, and
 * the very next thing the buyer's confirm does is release the seller's money.
 * Paying a seller on a confirmation the order does not record is the wrong
 * order of events, so that one stops.
 *
 * The listing restore is the opposite: it runs after the buyer has already been
 * refunded, so throwing would undo nothing and roll back a cancellation that
 * must stand. Stock silently lost from a listing needs a human, not a rollback,
 * so it reports with the stable fingerprint instead.
 *
 * Three of the six sat inside a `try/catch` that logged and could never run,
 * because a failed supabase-js write resolves rather than rejecting.
 */
import { scriptedDb, writePayload, type Call } from '../testSupport/scriptedDb';

const mockRefundPaymentForOrder = jest.fn();
const mockForcePayoutForOrder = jest.fn();
const mockPayoutOnConfirmReceived = jest.fn();

jest.mock('./marketplacePayments', () => ({
  marketplacePaystackEnabled: () => true,
  getMarketplacePaymentsService: () => ({
    refundPaymentForOrder: mockRefundPaymentForOrder,
    forcePayoutForOrder: mockForcePayoutForOrder,
    payoutOnConfirmReceived: mockPayoutOnConfirmReceived,
  }),
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
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { captureScopedException } = require('../utils/sentry') as {
  captureScopedException: jest.Mock;
};

const ORDER = {
  id: 'ord_1',
  buyer_id: 'buyer_1',
  seller_id: 'seller_1',
  listing_id: 'listing_1',
  payment_id: 'pay_1',
  transaction_id: 'txn_1',
  inquiry_id: 'inq_1',
  quantity: 2,
  amount: 1000,
  status: 'shipped',
  source: 'buy_now',
  listing: { title: 'Calc textbook' },
};

const LISTING = { id: 'listing_1', quantity: 3, status: 'active', user_id: 'seller_1' };

type FailingWrite =
  | 'none'
  | 'buyer_confirmed'
  | 'txn_disputed'
  | 'txn_refunded'
  | 'listing_restore'
  | 'inquiry_purchased'
  | 'dispute_outcome';

const WRITE_ERROR = { message: 'could not serialize access', code: '40001' };

function which(call: Call): FailingWrite | 'other' {
  const patch = writePayload(call, 'update');
  if (!patch) return 'other';
  if (call.table === 'marketplace_orders') {
    if ('buyer_confirmed_at' in patch && !('status' in patch)) return 'buyer_confirmed';
    if ('dispute_outcome' in patch) return 'dispute_outcome';
    return 'other';
  }
  if (call.table === 'marketplace_transactions') {
    if (patch.status === 'disputed') return 'txn_disputed';
    if (patch.status === 'refunded') return 'txn_refunded';
    return 'other';
  }
  if (call.table === 'marketplace_listings') return 'listing_restore';
  if (call.table === 'marketplace_inquiries' && patch.status === 'purchased') {
    return 'inquiry_purchased';
  }
  return 'other';
}

function serviceFor(
  failOn: FailingWrite,
  overrides: Partial<typeof ORDER> = {},
  listing: Record<string, unknown> | null = LISTING,
) {
  const order = { ...ORDER, ...overrides };
  const { client, calls } = scriptedDb((call) => {
    if (which(call) === failOn) return { data: null, error: WRITE_ERROR };
    // The escrow-release RPC, which the admin dispute path runs through.
    if (call.table === 'rpc:marketplace_release_escrow') {
      return { data: [{ order_id: 'ord_1', already_completed: false }], error: null };
    }
    if (call.table === 'marketplace_orders') {
      // An update that selects back returns the transitioned row; a plain read
      // (the escrow release re-reads the order after its RPC) returns the row
      // as it stands.
      if (writePayload(call, 'update')) return { data: { ...order, status: 'cancelled' }, error: null };
      if (call.terminal !== 'then') return { data: order, error: null };
    }
    return { data: null, error: null };
  });

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { MarketplaceOrdersService } = require('./marketplaceOrders');
  const service: any = Object.create(MarketplaceOrdersService.prototype);
  service.host = {
    getClient: () => client,
    marketplace: {
      // `restoreListingAfterCancelledOrder` reads the listing through the data
      // layer, not the client, so the stock it gives back comes from here.
      getMarketplaceListingById: jest.fn(async () => (listing ? { ...listing, title: 'Calc textbook' } : null)),
      logMarketplaceBudgetTransactions: jest.fn(async () => true),
    },
    notifications: { createNotification: jest.fn(async () => null) },
  };
  service.getOrderById = jest.fn(async () => order);
  service.getOrderByIdAdmin = jest.fn(async () => order);
  service.notifyOrderParty = jest.fn(async () => undefined);
  service.releaseEscrow = jest.fn(async () => ({ ...order, status: 'completed' }));
  return { service, calls, order };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.MARKETPLACE_PAYSTACK_CHECKOUT = 'true';
  mockRefundPaymentForOrder.mockResolvedValue(undefined);
  mockForcePayoutForOrder.mockResolvedValue(undefined);
  mockPayoutOnConfirmReceived.mockResolvedValue({ id: 'ord_1', status: 'completed' });
});

describe('confirm_received, with every write succeeding', () => {
  it('stamps the confirmation and then releases the seller’s money', async () => {
    const { service, calls } = serviceFor('none');
    await service.updateOrderStatus('ord_1', 'buyer_1', 'confirm_received');
    expect(calls.some((call) => which(call) === 'buyer_confirmed')).toBe(true);
    expect(mockPayoutOnConfirmReceived).toHaveBeenCalledWith('ord_1', 'buyer_1');
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('open_dispute, with every write succeeding', () => {
  it('mirrors the dispute onto the transaction row', async () => {
    const { service, calls } = serviceFor('none', { status: 'paid' });
    await service.updateOrderStatus('ord_1', 'buyer_1', 'open_dispute');
    expect(calls.some((call) => which(call) === 'txn_disputed')).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('cancel, with every write succeeding', () => {
  it('refunds, mirrors the refund and gives the held stock back', async () => {
    const { service, calls } = serviceFor('none', { status: 'paid' });
    await service.updateOrderStatus('ord_1', 'buyer_1', 'cancel');
    expect(mockRefundPaymentForOrder).toHaveBeenCalled();
    expect(calls.some((call) => which(call) === 'txn_refunded')).toBe(true);
    const restore = calls.find((call) => which(call) === 'listing_restore');
    expect(writePayload(restore as Call, 'update')).toEqual(
      expect.objectContaining({ quantity: 5, status: 'active' }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('re-opens a unique listing that has no quantity', async () => {
    const { service, calls } = serviceFor('none', { status: 'paid' }, { ...LISTING, quantity: null });
    await service.updateOrderStatus('ord_1', 'buyer_1', 'cancel');
    const restore = calls.find((call) => which(call) === 'listing_restore');
    expect(writePayload(restore as Call, 'update')).toEqual(
      expect.objectContaining({ status: 'active' }),
    );
    expect(restore?.ops).toContainEqual({ fn: 'eq', args: ['status', 'reserved'] });
  });
});

describe('escrow release, with every write succeeding', () => {
  it('closes out the inquiry that led to the sale', async () => {
    const { service, calls } = serviceFor('none', { status: 'disputed' });
    await service.resolveDisputeAsAdmin('ord_1', 'release_to_seller', 'admin_1', 'note');
    const closed = calls.find((call) => which(call) === 'inquiry_purchased');
    expect(closed).toBeDefined();
    // Idempotent by filter: an inquiry already `purchased` is not re-marked.
    expect(closed?.ops).toContainEqual({ fn: 'neq', args: ['status', 'purchased'] });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

const BEST_EFFORT = 'Database write failed (best-effort)';
const MONEY_MOVED = 'Database write failed AFTER the money moved; needs reconciliation';

describe('an order write failing before anything external happened', () => {
  it('does NOT pay the seller when the confirmation cannot be recorded', async () => {
    // MUST SUCCEED: the next thing this branch does is release the seller's
    // money. Paying on a confirmation the order does not record is the wrong
    // order of events.
    const { service } = serviceFor('buyer_confirmed');
    await expect(
      service.updateOrderStatus('ord_1', 'buyer_1', 'confirm_received'),
    ).rejects.toThrow(/marketplace_orders/);
    expect(mockPayoutOnConfirmReceived).not.toHaveBeenCalled();
  });

  it('names the order and what it was stamping', async () => {
    const { WriteFailedError } = await import('./data/writeResult');
    const { service } = serviceFor('buyer_confirmed');
    const error = await service
      .updateOrderStatus('ord_1', 'buyer_1', 'confirm_received')
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(WriteFailedError);
    expect((error as InstanceType<typeof WriteFailedError>).context).toEqual(
      expect.objectContaining({ orderId: 'ord_1', reason: 'buyer_confirmed_at' }),
    );
  });
});

describe('an order write failing where the action must still stand', () => {
  it('still opens the dispute when its ledger mirror fails, and warns', async () => {
    const { service } = serviceFor('txn_disputed', { status: 'paid' });
    await expect(
      service.updateOrderStatus('ord_1', 'buyer_1', 'open_dispute'),
    ).resolves.toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      BEST_EFFORT,
      expect.objectContaining({ table: 'marketplace_transactions', transactionId: 'txn_1' }),
    );
  });

  it('still cancels when the refund mirror fails, and reports at ERROR level', async () => {
    // A transaction row left at `held` for money that has gone back misreports
    // both sides' Budget.
    const { service } = serviceFor('txn_refunded', { status: 'paid' });
    await service.updateOrderStatus('ord_1', 'buyer_1', 'cancel');
    expect(logger.error).toHaveBeenCalledWith(
      BEST_EFFORT,
      expect.objectContaining({ table: 'marketplace_transactions', orderId: 'ord_1' }),
    );
  });

  it('still completes the escrow release when the inquiry close-out fails, and warns', async () => {
    const { service } = serviceFor('inquiry_purchased', { status: 'disputed' });
    await service.resolveDisputeAsAdmin('ord_1', 'release_to_seller', 'admin_1', 'note');
    expect(logger.warn).toHaveBeenCalledWith(
      BEST_EFFORT,
      expect.objectContaining({ table: 'marketplace_inquiries', inquiryId: 'inq_1' }),
    );
  });

  it('still resolves the dispute when the outcome stamp fails, and reports at ERROR level', async () => {
    // The trust score counts disputes LOST BY THE SELLER; a missing stamp
    // leaves a seller who WON punished forever.
    const { service } = serviceFor('dispute_outcome', { status: 'disputed' });
    await service.resolveDisputeAsAdmin('ord_1', 'release_to_seller', 'admin_1', 'note');
    expect(mockForcePayoutForOrder).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      BEST_EFFORT,
      expect.objectContaining({ table: 'marketplace_orders', outcome: 'seller' }),
    );
  });
});

describe('stock that could not be given back after a refund', () => {
  it('does not roll back the cancellation, and reports for reconciliation', async () => {
    // COMPENSATING: the buyer has already been refunded, so throwing would undo
    // nothing. The units are lost from the listing, which needs a human.
    const { service } = serviceFor('listing_restore', { status: 'paid' });
    await expect(service.updateOrderStatus('ord_1', 'buyer_1', 'cancel')).resolves.toBeDefined();
    expect(logger.error).toHaveBeenCalledWith(
      MONEY_MOVED,
      expect.objectContaining({
        table: 'marketplace_listings',
        listingId: 'listing_1',
        restoredQuantity: 2,
        reason: 'stock_not_restored_after_cancel',
      }),
    );
  });

  it('reports under the stable fingerprint', async () => {
    const { service } = serviceFor('listing_restore', { status: 'paid' });
    await service.updateOrderStatus('ord_1', 'buyer_1', 'cancel');
    expect(captureScopedException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        fingerprint: ['money-moved-write-failed:marketplace_listings:update'],
      }),
    );
  });

  it('reports the unique-listing twin too', async () => {
    const { service } = serviceFor('listing_restore', { status: 'paid' }, { ...LISTING, quantity: null });
    await service.updateOrderStatus('ord_1', 'buyer_1', 'cancel');
    expect(logger.error).toHaveBeenCalledWith(
      MONEY_MOVED,
      expect.objectContaining({ reason: 'listing_not_reopened_after_cancel' }),
    );
  });
});
