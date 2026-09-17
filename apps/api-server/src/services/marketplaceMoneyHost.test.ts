/**
 * The money-path reads that no suite drove (monolith lane M3, Phase B).
 *
 * ## Why this suite exists
 *
 * The marketplace money services used to take the whole `SupabaseService` and
 * call it FLAT: `this.supabaseService.logMarketplaceBudgetTransactions(…)`,
 * `.signStorageDisplayUrl(…)`, `.sendDirectMessage(…)`. Flipping them onto the
 * data layer moves each of those reads under the namespace that owns it
 * (`marketplace.`, `storageAcl.`, `directMessages.`), and a rename is exactly
 * the kind of edit a type-check can bless while the call site is still wrong —
 * the handle is what the #92 regression got wrong, and no test noticed.
 *
 * A census of the 33 marketplace / paystack / wallet / idempotency suites
 * showed these three reads had NO covering test, so they get one here, before
 * the flip lands:
 *
 *  - `marketplace.logMarketplaceBudgetTransactions` — the budget mirror that
 *    makes a completed sale show up in both sides' Budget, written on escrow
 *    release;
 *  - `storageAcl.signStorageDisplayUrl` — the seller shop cover and the recent
 *    listing thumbs, which render broken if they are not signed;
 *  - `notifications.createNotification` + `directMessages.sendDirectMessage` —
 *    the seller campaign, where the DM is best-effort and the notification is
 *    not.
 *
 * ## The gotcha
 *
 * The services are driven through a stand-in built by the PRODUCTION adapter
 * (`marketplaceHostFromFlat`), so these tests also pin that the adapter routes
 * each flat member to the namespace the service reads.
 */
import * as ordersModule from './marketplaceOrders';
import { MarketplaceOrdersService } from './marketplaceOrders';
import { MarketplaceSellerToolsService } from './marketplaceSellerTools';

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

type Rows = { data?: unknown; error?: unknown; count?: number | null };

/** Minimal PostgREST chain: builders return self, awaiting resolves. */
function chain(result: Rows) {
  const api: any = {};
  for (const method of [
    'select',
    'eq',
    'neq',
    'in',
    'gte',
    'lte',
    'order',
    'limit',
    'insert',
    'update',
    'upsert',
  ]) {
    api[method] = () => api;
  }
  api.single = async () => result;
  api.maybeSingle = async () => result;
  api.then = (resolve: (value: Rows) => unknown) =>
    Promise.resolve({ data: null, error: null, count: null, ...result }).then(resolve);
  return api;
}

describe('escrow release writes the budget mirror through marketplace.', () => {
  const COMPLETED = {
    id: 'order-1',
    listing_id: 'listing-1',
    buyer_id: 'buyer-1',
    seller_id: 'seller-1',
    amount: 5000,
    status: 'completed',
    source: 'buy_now',
    transaction_id: 'txn-1',
    listing: { title: 'Calc textbook' },
  };

  function serviceFor(overrides: { transactionId?: string | null } = {}) {
    const logMarketplaceBudgetTransactions = jest.fn(async () => true);
    const db = {
      rpc: jest.fn(async () => ({
        data: [{ order_id: 'order-1', already_completed: false }],
        error: null,
      })),
      from: () =>
        chain({
          data: {
            ...COMPLETED,
            transaction_id:
              overrides.transactionId === undefined ? 'txn-1' : overrides.transactionId,
          },
          error: null,
        }),
    };
    const self: any = Object.create(MarketplaceOrdersService.prototype);
    self.host = {
      getClient: () => db,
      marketplace: { logMarketplaceBudgetTransactions },
      notifications: { createNotification: jest.fn(async () => null), },
  } as never;
    return { self, logMarketplaceBudgetTransactions };
  }

  const release = (self: unknown) =>
    (MarketplaceOrdersService.prototype as any).finalizeEscrowRelease.call(self, 'order-1', {
      actorId: 'buyer-1',
      allowDisputed: false,
      notifyCompletion: false,
    });

  it('mirrors a completed sale into both sides of the budget', async () => {
    const { self, logMarketplaceBudgetTransactions } = serviceFor();

    await release(self);

    expect(logMarketplaceBudgetTransactions).toHaveBeenCalledWith({
      listingId: 'listing-1',
      listingTitle: 'Calc textbook',
      amount: 5000,
      sellerId: 'seller-1',
      buyerId: 'buyer-1',
      marketplaceTransactionId: 'txn-1',
      source: 'buy_now',
    });
  });

  it('writes no ledger row for an order with no transaction', async () => {
    // A cash / manual order never had a payment, so there is nothing to mirror
    // and a row here would invent money that did not move.
    const { self, logMarketplaceBudgetTransactions } = serviceFor({ transactionId: null });

    await release(self);

    expect(logMarketplaceBudgetTransactions).not.toHaveBeenCalled();
  });
});

describe('seller shop media is signed through storageAcl.', () => {
  function serviceFor() {
    const signStorageDisplayUrl = jest.fn(
      async (url: string, _ttl?: number, variant?: string) => `signed:${variant}:${url}`,
    );
    const self: any = Object.create(MarketplaceSellerToolsService.prototype);
    self.host = {
      getClient: () => ({}),
      storageAcl: { signStorageDisplayUrl },
  } as never;
    return { self, signStorageDisplayUrl };
  }

  it('signs the shop cover as an original', async () => {
    const { self, signStorageDisplayUrl } = serviceFor();

    const shop = await self.signShopPublic({
      shopName: 'Books',
      bio: null,
      coverImageUrl: 'cover.png',
    });

    expect(shop.coverImageUrl).toBe('signed:original:cover.png');
    expect(signStorageDisplayUrl).toHaveBeenCalledWith('cover.png', 60 * 60 * 24, 'original');
  });

  it('leaves a shop with no cover alone, and signs listing images as thumbs', async () => {
    const { self, signStorageDisplayUrl } = serviceFor();

    const data = await self.signSellerProfileMedia({
      shop: { shopName: 'Books', bio: null, coverImageUrl: null },
      recentListings: [{ id: 'listing-1', images: ['a.png', 'b.png'] }],
    });

    expect(data.shop.coverImageUrl).toBeNull();
    expect(data.recentListings[0].images).toEqual(['signed:thumb:a.png', 'signed:thumb:b.png']);
    expect(signStorageDisplayUrl).toHaveBeenCalledTimes(2);
  });
});

describe('a seller campaign notifies through notifications. and DMs through directMessages.', () => {
  function serviceFor(dmThrows = false) {
    const createNotification = jest.fn(async () => null);
    const sendDirectMessage = jest.fn(async () => {
      if (dmThrows) throw new Error('blocked');
      return { id: 'dm-1' };
    });
    const inserted: unknown[] = [];
    const db = {
      from: (table: string) => {
        if (table !== 'marketplace_campaign_log') throw new Error(`Unexpected table: ${table}`);
        const api: any = chain({ data: null, error: null, count: 0 });
        api.insert = (payload: unknown) => {
          inserted.push(payload);
          return api;
        };
        return api;
      },
    };
    const self: any = Object.create(MarketplaceSellerToolsService.prototype);
    self.host = {
      getClient: () => db,
      notifications: { createNotification },
      directMessages: { sendDirectMessage },
  } as never;
    return { self, createNotification, sendDirectMessage, inserted };
  }

  const BUYERS = [{ buyerId: 'buyer-1', segment: 'repeat' }];

  beforeEach(() => {
    // `sendCampaign` resolves its audience through the orders service, which
    // owns that query; this suite is about what the campaign does with the
    // audience, so the audience itself is stubbed at the module boundary.
    jest
      .spyOn(ordersModule, 'getMarketplaceOrdersService')
      .mockReturnValue({ getSellerBuyersWithSegments: async () => BUYERS } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends the notification and the DM to each recipient', async () => {
    const { self, createNotification, sendDirectMessage, inserted } = serviceFor();

    const result = await self.sendCampaign('seller-1', { message: 'Half price today' });

    expect(result).toEqual({ sent: 1, skipped: 0 });
    expect(createNotification).toHaveBeenCalledWith(
      'buyer-1',
      expect.objectContaining({ type: 'marketplace_seller_campaign' }),
    );
    expect(sendDirectMessage).toHaveBeenCalledWith(
      'seller-1',
      'buyer-1',
      '[Marketplace update] Half price today',
    );
    expect(inserted).toHaveLength(1);
  });

  it('still counts a recipient whose DM fails — the DM is best effort', async () => {
    const { self, createNotification } = serviceFor(true);

    const result = await self.sendCampaign('seller-1', { message: 'Half price today' });

    expect(result).toEqual({ sent: 1, skipped: 0 });
    expect(createNotification).toHaveBeenCalledTimes(1);
  });
});
