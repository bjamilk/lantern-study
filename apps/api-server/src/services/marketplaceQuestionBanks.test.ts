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
// The service takes `MarketplaceServiceHost` since M3 Phase B. The stand-ins
// below stay FLAT and are regrouped by the production adapter
// (`marketplaceHostFromFlat`), so every assertion still names the same
// `jest.fn()` and the adapter itself is exercised by these suites.
import { PublicError } from '../utils/safeError';

type TableResult = { data: unknown; error?: unknown };

/**
 * Minimal PostgREST double: per-table canned results plus a log of writes so
 * tests can assert exactly what was inserted/upserted. A table may map to an
 * array of results, consumed in call order (the last one repeats) — needed
 * when a method reads then writes the same table.
 */
function makeDb(tables: Record<string, TableResult | TableResult[]>) {
  const writes: Array<{ table: string; op: string; payload: unknown }> = [];
  const queues = new Map<string, TableResult[]>();
  const nextResult = (table: string): TableResult => {
    const configured = tables[table];
    if (configured === undefined) return { data: null, error: null };
    if (!Array.isArray(configured)) return configured;
    if (!queues.has(table)) queues.set(table, [...configured]);
    const queue = queues.get(table)!;
    return queue.length > 1 ? queue.shift()! : queue[0];
  };
  const from = (table: string) => {
    const result = nextResult(table);
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
    api.update = (payload: unknown) => {
      writes.push({ table, op: 'update', payload });
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

/** A publish now has to name a real course (Gap 3). */
const COURSE_ID = '44444444-4444-4444-8444-444444444444';

function makeService(overrides: {
  tables?: Record<string, TableResult | TableResult[]>;
  listing?: unknown;
  group?: unknown;
  createdListing?: unknown;
}) {
  const { db, writes } = makeDb({
    // The course anchor resolves by default; a test that wants the "no such
    // course" branch overrides `courses` with { data: null }.
    courses: { data: { id: COURSE_ID }, error: null },
    ...(overrides.tables || {}),
  });
  const saveOfflineBundle = jest.fn(async () => undefined);
  const supabaseService: any = {
    getClient: () => db,
    getMarketplaceListingById: jest.fn(async () => overrides.listing ?? null),
    getGroupById: jest.fn(async () => overrides.group ?? null),
    createMarketplaceListing: jest.fn(async () => overrides.createdListing ?? { id: 'listing-1' }),
    saveOfflineBundle,
  };
  // The stand-in stays FLAT, because the assertions below name its members;
  // the service takes the namespaced host, built from the very same
  // `jest.fn()`s. (This is what the transitional `marketplaceHostFromFlat`
  // adapter did while the facade still existed — written out here now that it
  // is deleted.)
  const host: any = {
    getClient: supabaseService.getClient,
    groups: { getGroupById: supabaseService.getGroupById, },
    marketplace: { getMarketplaceListingById: supabaseService.getMarketplaceListingById, createMarketplaceListing: supabaseService.createMarketplaceListing, },
    offlineBundles: { saveOfflineBundle: supabaseService.saveOfflineBundle, },
  };
  return {
    service: new MarketplaceQuestionBanksService(host),
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
    courseId: COURSE_ID,
    content: CONTENT,
    // Rights attestation is mandatory since Phase 1 · E (see
    // marketplaceQuestionBanks.attestation.test.ts for the refusal path).
    attestation: true,
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

describe('updateQuestionBankContent', () => {
  const BANK_ROW = {
    id: 'bank-1',
    listing_id: 'listing-1',
    version: 2,
    question_count: 2,
    content: CONTENT,
  };

  it('rejects non-sellers', async () => {
    const { service } = makeService({
      listing: { id: 'listing-1', user_id: 'seller-1', category_specific_fields: {} },
      tables: { marketplace_question_banks: { data: BANK_ROW, error: null } },
    });
    await expect(
      service.updateQuestionBankContent('listing-1', 'someone-else', CONTENT, { attestation: true })
    ).rejects.toThrow('Only the seller');
  });

  it('bumps the version and updates the snapshot for the seller', async () => {
    const { service, writes } = makeService({
      listing: { id: 'listing-1', user_id: 'seller-1', title: 'Bank', category_specific_fields: {} },
      tables: {
        // First call reads the bank row; second is update(...).select() where
        // non-empty rows mean the optimistic lock held.
        marketplace_question_banks: [
          { data: BANK_ROW, error: null },
          { data: [{ listing_id: 'listing-1' }], error: null },
        ],
        marketplace_listings: { data: { title: 'Bank' }, error: null },
      },
    });

    await expect(
      service.updateQuestionBankContent('listing-1', 'seller-1', CONTENT, { attestation: true })
    ).resolves.toEqual({ version: 3, questionCount: 2 });

    const bankUpdate = writes.find(
      (w) => w.table === 'marketplace_question_banks' && w.op === 'update'
    );
    expect(bankUpdate?.payload).toMatchObject({ version: 3, question_count: 2 });
  });

  it('fails when the optimistic lock misses (concurrent update)', async () => {
    const { service } = makeService({
      listing: { id: 'listing-1', user_id: 'seller-1', category_specific_fields: {} },
      tables: {
        marketplace_question_banks: [
          { data: BANK_ROW, error: null },
          { data: [], error: null }, // 0 rows matched the expected version
        ],
      },
    });
    await expect(
      service.updateQuestionBankContent('listing-1', 'seller-1', CONTENT, { attestation: true })
    ).rejects.toThrow('updated elsewhere');
  });
});

describe('recordScore', () => {
  const rpcOk = {
    best_score_pct: 80,
    best_correct: 8,
    best_total: 10,
    attempts: 2,
    improved: true,
  };

  function serviceWithRpc(entitled: boolean) {
    const rpc = jest.fn(async () => ({ data: [rpcOk], error: null }));
    const chain: any = {};
    const self = () => chain;
    chain.select = self;
    chain.eq = self;
    chain.maybeSingle = async () => ({ data: entitled ? { id: 'ent-1' } : null, error: null });
    // This one reaches only the client.
    const host: any = { getClient: () => ({ from: () => chain, rpc }) };
    return { service: new MarketplaceQuestionBanksService(host), rpc };
  }

  it('refuses users who do not own the bank', async () => {
    const { service, rpc } = serviceWithRpc(false);
    await expect(service.recordScore('l1', 'u1', 5, 10)).rejects.toThrow('do not own');
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    [5, 0],
    [-1, 10],
    [11, 10],
  ])('rejects correct=%p total=%p', async (correct, total) => {
    const { service } = serviceWithRpc(true);
    await expect(service.recordScore('l1', 'u1', correct, total)).rejects.toBeInstanceOf(
      PublicError
    );
  });

  it('records a valid attempt for an owner', async () => {
    const { service, rpc } = serviceWithRpc(true);
    await expect(service.recordScore('l1', 'u1', 8, 10)).resolves.toEqual({
      bestScorePct: 80,
      bestCorrect: 8,
      bestTotal: 10,
      attempts: 2,
      improved: true,
    });
    expect(rpc).toHaveBeenCalledWith(
      'marketplace_record_question_bank_score',
      expect.objectContaining({ p_correct: 8, p_total: 10 })
    );
  });
});

describe('getLeaderboard', () => {
  it('returns an empty board when the scores table is missing (migration not applied)', async () => {
    const { service } = makeService({
      tables: {
        marketplace_question_bank_scores: {
          data: null,
          error: { code: 'PGRST205', message: "Could not find the table 'marketplace_question_bank_scores'" },
        },
      },
    });
    await expect(service.getLeaderboard('l1', 'u1')).resolves.toEqual({
      entries: [],
      viewerEntry: null,
    });
  });

  it('ranks entries and flags the viewer', async () => {
    const { service } = makeService({
      tables: {
        marketplace_question_bank_scores: {
          data: [
            { user_id: 'u2', best_score_pct: 90, best_correct: 9, best_total: 10, attempts: 1, best_at: '2026-08-01' },
            { user_id: 'u1', best_score_pct: 70, best_correct: 7, best_total: 10, attempts: 3, best_at: '2026-08-02' },
          ],
          error: null,
        },
        profiles: { data: [{ id: 'u2', name: 'Ada' }], error: null },
      },
    });
    const board = await service.getLeaderboard('l1', 'u1');
    expect(board.entries.map((e) => [e.rank, e.name, e.isViewer])).toEqual([
      [1, 'Ada', false],
      [2, 'Student', true],
    ]);
  });
});

describe('listAvailableUpdates', () => {
  it('returns only banks newer than the held version', async () => {
    const { service } = makeService({
      tables: {
        marketplace_question_bank_entitlements: {
          data: [
            { listing_id: 'l1', version_at_download: 1 },
            { listing_id: 'l2', version_at_download: 3 },
          ],
          error: null,
        },
        marketplace_question_banks: {
          data: [
            { listing_id: 'l1', version: 2, question_count: 10 },
            { listing_id: 'l2', version: 3, question_count: 5 },
          ],
          error: null,
        },
      },
    });

    await expect(service.listAvailableUpdates('buyer-1')).resolves.toEqual([
      { listingId: 'l1', bundleId: 'qbank-l1', version: 2, questionCount: 10 },
    ]);
  });

  it('returns empty for users with no entitlements', async () => {
    const { service } = makeService({
      tables: { marketplace_question_bank_entitlements: { data: [], error: null } },
    });
    await expect(service.listAvailableUpdates('buyer-1')).resolves.toEqual([]);
  });
});
