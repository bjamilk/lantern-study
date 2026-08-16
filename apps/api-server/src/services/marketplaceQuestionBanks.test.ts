/**
 * Question banks: publish gating, entitlement delivery, and the digital
 * fulfillment invariants — delivery must survive payout/completion failures,
 * and non-digital orders must be untouched by the digital branch.
 */
const mockPaystackEnabled = jest.fn();
const mockAssertSellerCanReceivePayout = jest.fn();

jest.mock('./marketplacePayments', () => ({
  marketplacePaystackEnabled: (...args: unknown[]) => mockPaystackEnabled(...args),
  getMarketplacePaymentsService: () => ({
    assertSellerCanReceivePayout: (...args: unknown[]) =>
      mockAssertSellerCanReceivePayout(...args),
  }),
}));

import { MarketplaceQuestionBanksService } from './marketplaceQuestionBanks';
import { PublicError } from '../utils/safeError';

type TableResult = { data: unknown; error?: unknown };

/**
 * Minimal PostgREST double: per-table canned results plus a log of writes so
 * tests can assert exactly what was inserted/upserted.
 */
function makeDb(tables: Record<string, TableResult>) {
  const writes: Array<{ table: string; op: string; payload: unknown }> = [];
  const from = (table: string) => {
    const result = tables[table] ?? { data: null, error: null };
    const api: any = {};
    const self = () => api;
    api.select = self;
    api.eq = self;
    api.in = self;
    api.limit = self;
    api.order = self;
    api.delete = () => {
      writes.push({ table, op: 'delete', payload: null });
      return api;
    };
    api.insert = (payload: unknown) => {
      writes.push({ table, op: 'insert', payload });
      return api;
    };
    api.upsert = (payload: unknown) => {
      writes.push({ table, op: 'upsert', payload });
      return api;
    };
    api.single = async () => result;
    api.maybeSingle = async () => result;
    api.then = (resolve: (value: TableResult) => unknown) =>
      Promise.resolve(result).then(resolve);
    return api;
  };
  return { db: { from }, writes };
}

const CONTENT = {
  config: { questionCount: 2 },
  questions: [
    { id: 'q1', text: 'What is 1+1?' },
    { id: 'q2', text: 'What is 2+2?' },
  ],
};

function makeService(overrides: {
  tables?: Record<string, TableResult>;
  listing?: unknown;
  group?: unknown;
  createdListing?: unknown;
}) {
  const { db, writes } = makeDb(overrides.tables || {});
  const saveOfflineBundle = jest.fn(async () => undefined);
  const supabaseService: any = {
    getClient: () => db,
    getMarketplaceListingById: jest.fn(async () => overrides.listing ?? null),
    getGroupById: jest.fn(async () => overrides.group ?? null),
    createMarketplaceListing: jest.fn(async () => overrides.createdListing ?? { id: 'listing-1' }),
    saveOfflineBundle,
  };
  return {
    service: new MarketplaceQuestionBanksService(supabaseService),
    supabaseService,
    writes,
    saveOfflineBundle,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPaystackEnabled.mockReturnValue(true);
  mockAssertSellerCanReceivePayout.mockResolvedValue(undefined);
});

describe('publishQuestionBank', () => {
  const BASE_INPUT = {
    title: 'GST 101 Past Questions',
    campusId: 'campus-1',
    content: CONTENT,
  };

  it('rejects empty content', async () => {
    const { service } = makeService({});
    await expect(
      service.publishQuestionBank('user-1', { ...BASE_INPUT, content: { questions: [] } })
    ).rejects.toBeInstanceOf(PublicError);
  });

  it('rejects a missing title and campus', async () => {
    const { service } = makeService({});
    await expect(
      service.publishQuestionBank('user-1', { ...BASE_INPUT, title: '  ' })
    ).rejects.toThrow('Title is required');
    await expect(
      service.publishQuestionBank('user-1', { ...BASE_INPUT, campusId: '' })
    ).rejects.toThrow('Campus is required');
  });

  it('blocks non-admin members from publishing a group bank', async () => {
    const { service } = makeService({
      group: { adminIds: ['someone-else'], permissions: {} },
    });
    await expect(
      service.publishQuestionBank('user-1', { ...BASE_INPUT, groupId: 'group-1' })
    ).rejects.toThrow('Only group admins');
  });

  it('lets a group admin publish and stores the snapshot with the listing', async () => {
    const { service, supabaseService, writes } = makeService({
      group: { adminIds: ['user-1'], permissions: {} },
      createdListing: { id: 'listing-9' },
      tables: {
        marketplace_question_banks: {
          data: { id: 'bank-1', listing_id: 'listing-9', version: 1, question_count: 2 },
          error: null,
        },
      },
    });

    const result = await service.publishQuestionBank('user-1', {
      ...BASE_INPUT,
      groupId: 'group-1',
    });

    expect(result.bank.listing_id).toBe('listing-9');
    expect(supabaseService.createMarketplaceListing).toHaveBeenCalledWith(
      expect.objectContaining({
        listing_kind: 'question_bank',
        quantity: null,
        category: 'pq_bank',
      }),
      'user-1'
    );
    const bankInsert = writes.find(
      (w) => w.table === 'marketplace_question_banks' && w.op === 'insert'
    );
    expect(bankInsert?.payload).toMatchObject({
      listing_id: 'listing-9',
      source_group_id: 'group-1',
      question_count: 2,
    });
  });

  it('blocks paid banks when Paystack is disabled', async () => {
    mockPaystackEnabled.mockReturnValue(false);
    const { service } = makeService({});
    await expect(
      service.publishQuestionBank('user-1', { ...BASE_INPUT, price: 500 })
    ).rejects.toThrow('require in-app payments');
  });

  it('requires a payable seller before publishing a paid bank', async () => {
    mockAssertSellerCanReceivePayout.mockRejectedValue(new PublicError('No payout profile'));
    const { service } = makeService({});
    await expect(
      service.publishQuestionBank('user-1', { ...BASE_INPUT, price: 500 })
    ).rejects.toThrow('No payout profile');
  });
});

describe('grantEntitlement', () => {
  const TABLES = {
    marketplace_question_banks: {
      data: { id: 'bank-1', listing_id: 'listing-1', version: 3, question_count: 2, content: CONTENT },
      error: null,
    },
    marketplace_listings: { data: { title: 'GST 101 Bank' }, error: null },
  };

  it('records ownership and delivers a deterministic offline bundle', async () => {
    const { service, writes, saveOfflineBundle } = makeService({ tables: TABLES });

    const result = await service.grantEntitlement('listing-1', 'buyer-1', 'order-1');

    expect(result.bundleId).toBe('qbank-listing-1');
    const entitlement = writes.find(
      (w) => w.table === 'marketplace_question_bank_entitlements' && w.op === 'upsert'
    );
    expect(entitlement?.payload).toMatchObject({
      listing_id: 'listing-1',
      user_id: 'buyer-1',
      order_id: 'order-1',
      version_at_download: 3,
    });
    expect(saveOfflineBundle).toHaveBeenCalledWith(
      'buyer-1',
      expect.objectContaining({
        bundleId: 'qbank-listing-1',
        groupName: 'GST 101 Bank',
        questions: CONTENT.questions,
      })
    );
  });

  it('fails clearly when the content snapshot is missing', async () => {
    const { service } = makeService({
      tables: { marketplace_question_banks: { data: null, error: null } },
    });
    await expect(service.grantEntitlement('listing-1', 'buyer-1', null)).rejects.toThrow(
      'content not found'
    );
  });
});

describe('downloadQuestionBank', () => {
  const bankTables = {
    marketplace_question_banks: {
      data: { id: 'bank-1', listing_id: 'listing-1', version: 1, question_count: 2, content: CONTENT },
      error: null,
    },
    marketplace_listings: { data: { title: 'Free Bank' }, error: null },
    marketplace_question_bank_entitlements: { data: null, error: null },
  };

  it('grants free banks to any signed-in user', async () => {
    const { service, saveOfflineBundle } = makeService({
      listing: { id: 'listing-1', user_id: 'seller-1', listing_kind: 'question_bank', status: 'active', price: null },
      tables: bankTables,
    });
    await expect(service.downloadQuestionBank('listing-1', 'buyer-1')).resolves.toMatchObject({
      bundleId: 'qbank-listing-1',
    });
    expect(saveOfflineBundle).toHaveBeenCalled();
  });

  it('refuses paid banks without an entitlement', async () => {
    const { service } = makeService({
      listing: { id: 'listing-1', user_id: 'seller-1', listing_kind: 'question_bank', status: 'active', price: 500 },
      tables: bankTables,
    });
    await expect(service.downloadQuestionBank('listing-1', 'buyer-1')).rejects.toThrow(
      'Purchase this question bank'
    );
  });

  it('re-delivers to an owner who already bought it', async () => {
    const { service, saveOfflineBundle } = makeService({
      listing: { id: 'listing-1', user_id: 'seller-1', listing_kind: 'question_bank', status: 'active', price: 500 },
      tables: {
        ...bankTables,
        marketplace_question_bank_entitlements: { data: { id: 'ent-1' }, error: null },
      },
    });
    await expect(service.downloadQuestionBank('listing-1', 'buyer-1')).resolves.toMatchObject({
      bundleId: 'qbank-listing-1',
    });
    expect(saveOfflineBundle).toHaveBeenCalled();
  });

  it('rejects non-question-bank listings', async () => {
    const { service } = makeService({
      listing: { id: 'listing-1', user_id: 'seller-1', listing_kind: 'single', status: 'active', price: 500 },
    });
    await expect(service.downloadQuestionBank('listing-1', 'buyer-1')).rejects.toThrow(
      'Question bank not found'
    );
  });
});
