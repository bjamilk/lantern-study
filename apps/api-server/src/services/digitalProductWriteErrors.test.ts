/**
 * The remaining discarded writes in the digital-product and cart services
 * (#108, Phase B).
 *
 * ## What reading them changed
 *
 * This batch was picked as "the must-succeed stragglers", and the entitlement
 * grants that put `marketplaceStudyPacks` and `marketplaceQuestionBanks` on the
 * list turned out NOT to be among the discarded writes at all: both
 * `grantEntitlement` implementations already destructure and check their
 * upsert's `error`. A buyer who paid and got no entitlement was never one of
 * these bugs. What is left in the two files is one genuinely serious site each
 * and three cosmetic ones:
 *
 *  - the cleanup delete that removes a listing whose content insert failed. If
 *    it is lost, a PURCHASABLE listing exists with nothing behind it — someone
 *    can pay for a study pack or question bank that does not exist.
 *  - the browse-card counts refresh after a republish (both files): the card
 *    shows a stale question or flashcard count.
 *  - the deck course-filing retry, whose FIRST attempt is already checked; the
 *    fallback landing means a delivered deck sits unfiled.
 *
 * And two in the cart checkout:
 *
 *  - the `awaiting_payment` stamp on the non-Paystack branch, which re-writes
 *    the status the insert already set — cosmetic by construction;
 *  - the `failed` stamp in the rollback catch, which must not throw over the
 *    error that sent it there.
 *
 * None of the seven is must-succeed. That is the finding, not a shortcut.
 */
import { scriptedDb, writePayload, type Call } from '../testSupport/scriptedDb';

jest.mock('./marketplacePayments', () => ({
  marketplacePaystackEnabled: () => false,
  getMarketplacePaymentsService: () => ({
    assertSellerCanReceivePayout: jest.fn(),
    createCheckoutCharge: jest.fn(),
  }),
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

const WRITE_ERROR = { message: 'could not serialize access', code: '40001' };

const LISTING = {
  id: 'listing_1',
  user_id: 'seller_1',
  title: 'Organic Chemistry',
  status: 'active',
  category_specific_fields: { questionCount: 10 },
};

/** The counts refresh: a listings update carrying `category_specific_fields`. */
function isCountsRefresh(call: Call): boolean {
  const patch = writePayload(call, 'update');
  return Boolean(call.table === 'marketplace_listings' && patch && 'category_specific_fields' in patch);
}

/** The orphan cleanup: a listings DELETE. */
function isCleanupDelete(call: Call): boolean {
  return call.table === 'marketplace_listings' && call.ops.some((op) => op.fn === 'delete');
}

beforeEach(() => jest.clearAllMocks());

describe('the browse-card counts refresh after a republish', () => {
  const updateBank = async (countsFail: boolean) => {
    const { MarketplaceQuestionBanksService } = await import('./marketplaceQuestionBanks');
    const { client, calls } = scriptedDb((call) => {
      if (countsFail && isCountsRefresh(call)) return { data: null, error: WRITE_ERROR };
      if (call.table === 'marketplace_question_banks') {
        // The read, then the optimistic-locked update that returns its row.
        if (writePayload(call, 'update')) return { data: [{ listing_id: 'listing_1' }], error: null };
        return { data: { listing_id: 'listing_1', version: 3, question_count: 10 }, error: null };
      }
      return { data: null, error: null };
    });
    const service: any = Object.create(MarketplaceQuestionBanksService.prototype);
    service.host = {
      getClient: () => client,
      marketplace: { getMarketplaceListingById: jest.fn(async () => LISTING) },
    };
    const result = await service.updateQuestionBankContent(
      'listing_1',
      'seller_1',
      { config: {}, questions: [{ id: 'q1', question: 'Why?', options: ['a', 'b'], correctAnswer: 0 }] },
      { attestation: true, aiAssisted: false, sourcesCited: ['Lecture notes'] },
    );
    return { result, calls };
  };

  it('refreshes the card and says nothing when it succeeds', async () => {
    const { calls } = await updateBank(false);
    expect(calls.some(isCountsRefresh)).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('TODAY: republishes with a stale card count and says nothing', async () => {
    const { result } = await updateBank(true);
    expect(result).toEqual(expect.objectContaining({ version: 4 }));
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('the cleanup that removes a listing with no content behind it', () => {
  const COURSE_ID = '11111111-2222-3333-4444-555555555555';

  const publishBank = async (cleanupFails: boolean) => {
    const { MarketplaceQuestionBanksService } = await import('./marketplaceQuestionBanks');
    const { client, calls } = scriptedDb((call) => {
      if (cleanupFails && isCleanupDelete(call)) return { data: null, error: WRITE_ERROR };
      // The course anchor every new digital listing must carry.
      if (call.table === 'courses') {
        return { data: { id: COURSE_ID, campus_id: 'campus_1', title: 'CHM 101' }, error: null };
      }
      if (call.table === 'marketplace_listings' && call.ops.some((op) => op.fn === 'insert')) {
        return { data: LISTING, error: null };
      }
      // The content insert is what fails, sending the flow into its cleanup.
      if (call.table === 'marketplace_question_banks' && call.ops.some((op) => op.fn === 'insert')) {
        return { data: null, error: { message: 'content too large', code: '22001' } };
      }
      return { data: null, error: null };
    });
    const service: any = Object.create(MarketplaceQuestionBanksService.prototype);
    service.host = {
      getClient: () => client,
      marketplace: {
        getMarketplaceListingById: jest.fn(async () => LISTING),
        // The listing is created through the data layer; the content insert
        // below is the one that fails, which is what sends the flow into its
        // cleanup.
        createMarketplaceListing: jest.fn(async () => LISTING),
      },
      groups: { getGroupById: jest.fn(async () => null) },
    };
    const run = () =>
      service.publishQuestionBank('seller_1', {
        title: 'Organic Chemistry',
        description: 'A bank',
        campusId: 'campus_1',
        courseId: COURSE_ID,
        price: 0,
        attestation: true,
        aiAssisted: false,
        sourcesCited: ['Lecture notes'],
        content: {
          config: {},
          questions: [{ id: 'q1', question: 'Why?', options: ['a', 'b'], correctAnswer: 0 }],
        },
      });
    return { run, calls };
  };

  it('deletes the orphaned listing when the content insert fails', async () => {
    const { run, calls } = await publishBank(false);
    // The publish rethrows the PostgREST error object itself, not an `Error`.
    await expect(run()).rejects.toEqual(expect.objectContaining({ code: '22001' }));
    expect(calls.some(isCleanupDelete)).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('TODAY: says nothing when the cleanup itself fails, leaving a purchasable orphan', async () => {
    // A listing anyone can buy, with no question bank behind it.
    const { run, calls } = await publishBank(true);
    await expect(run()).rejects.toEqual(expect.objectContaining({ code: '22001' }));
    // The cleanup really did run and really did fail — without this the
    // assertions below would pass vacuously on a flow that never got there.
    expect(calls.some(isCleanupDelete)).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
    expect(captureScopedException).not.toHaveBeenCalled();
  });
});

describe('the cart checkout stamps', () => {
  const CART = [{ listing_id: 'listing_9', quantity: 1, listing: null }];

  const runCheckout = async (options: { stamp: 'awaiting' | 'failed'; fails: boolean }) => {
    jest.resetModules();
    jest.doMock('./marketplaceCart', () => ({
      getMarketplaceCartService: () => ({ listCart: async () => CART }),
    }));
    jest.doMock('./marketplaceSellerTools', () => ({
      getMarketplaceSellerToolsService: () => ({
        getPreferences: async () => ({ hall_dropoff_enabled: true, shipping_enabled: false }),
      }),
    }));
    jest.doMock('./marketplaceAddresses', () => ({
      getMarketplaceAddressesService: () => ({ getOwned: async () => null, snapshot: () => ({}) }),
    }));
    jest.doMock('./marketplaceOrders', () => ({
      getMarketplaceOrdersService: () => ({ updateOrderStatus: jest.fn(async () => ({})) }),
      resolveEffectivePrice: () => 1000,
    }));

    const isAwaitingStamp = (call: Call) => {
      const patch = writePayload(call, 'update');
      return Boolean(
        call.table === 'marketplace_checkouts' && patch && patch.status === 'awaiting_payment',
      );
    };
    const isFailedStamp = (call: Call) => {
      const patch = writePayload(call, 'update');
      return Boolean(call.table === 'marketplace_checkouts' && patch && patch.status === 'failed');
    };

    const { client, calls } = scriptedDb((call) => {
      const target = options.stamp === 'awaiting' ? isAwaitingStamp : isFailedStamp;
      if (options.fails && target(call)) return { data: null, error: WRITE_ERROR };
      if (call.table === 'marketplace_checkouts' && call.ops.some((op) => op.fn === 'insert')) {
        return { data: { id: 'chk_1', status: 'awaiting_payment' }, error: null };
      }
      if (call.table === 'marketplace_orders' && writePayload(call, 'update')) {
        // For the rollback case: the attach patch fails, which is what sends
        // `createFromCart` into its catch.
        return options.stamp === 'failed'
          ? { data: null, error: { message: 'attach failed', code: '23503' } }
          : { data: { id: 'ord_1', seller_id: 'seller_9' }, error: null };
      }
      return { data: null, error: null };
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MarketplaceCheckoutService } = require('./marketplaceCheckout');
    const service: any = Object.create(MarketplaceCheckoutService.prototype);
    service.data = {
      getClient: () => client,
      marketplace: {
        getMarketplaceListingById: async () => ({
          id: 'listing_9',
          user_id: 'seller_9',
          listing_kind: 'physical',
          price: 1000,
          quantity: 5,
        }),
      },
    };
    service.createOrdersForGroups = undefined;
    const run = () =>
      service.createFromCart('buyer_1', {
        groups: [{ sellerId: 'seller_9', fulfillmentMode: 'hall_dropoff' }],
      });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const freshLogger = (require('../utils/logger') as { logger: { warn: jest.Mock; error: jest.Mock } })
      .logger;
    return { run, calls, freshLogger, isAwaitingStamp, isFailedStamp };
  };

  it('TODAY: says nothing when the awaiting_payment stamp fails', async () => {
    const { run, freshLogger } = await runCheckout({ stamp: 'awaiting', fails: true });
    await run().catch(() => undefined);
    expect(freshLogger.warn).not.toHaveBeenCalled();
    expect(freshLogger.error).not.toHaveBeenCalled();
  });

  it('TODAY: says nothing when the rollback failed stamp fails', async () => {
    const { run, freshLogger } = await runCheckout({ stamp: 'failed', fails: true });
    await expect(run()).rejects.toThrow();
    expect(freshLogger.warn).not.toHaveBeenCalled();
    expect(freshLogger.error).not.toHaveBeenCalled();
  });
});
