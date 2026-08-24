/**
 * Study packs: publish gating, multi-target delivery (offline bundle + deck +
 * note), idempotent re-delivery via delivered_refs, update/versioning, the
 * answer-stripped preview, and the unified purchases library.
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

import { MarketplaceStudyPacksService } from './marketplaceStudyPacks';
import { PublicError } from '../utils/safeError';

type TableResult = { data: unknown; error?: unknown };

/** Minimal PostgREST double (per-table canned results + a write log). */
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
  guide: { markdown: 'Mitochondria are the powerhouse of the cell.', toc: [{ title: 'Intro', anchor: 'intro' }] },
  summaries: [{ title: 'Key points', markdown: 'ATP is energy currency. '.repeat(60) }],
  flashcards: [
    { front: 'What makes ATP?', back: 'Mitochondria' },
    { front: 'Genetic material?', back: 'DNA' },
  ],
  questions: [
    { id: 'q1', questionStem: 'What is 1+1?', options: [{ id: 'a', text: '2', isCorrect: true }], correctAnswer: 'a' },
    { id: 'q2', questionStem: 'What is 2+2?', options: [{ id: 'b', text: '4', isCorrect: true }], correctAnswer: 'b' },
  ],
};

function makeSupabase(overrides: {
  tables?: Record<string, TableResult | TableResult[]>;
  listing?: unknown;
  createdListing?: unknown;
  importedDeck?: unknown;
  createdNote?: unknown;
}) {
  const { db, writes } = makeDb(overrides.tables || {});
  const saveOfflineBundle = jest.fn(async () => undefined);
  const importDeck = jest.fn(async () => overrides.importedDeck ?? { deck: { id: 'deck-1' }, flashcards: [] });
  const replaceDeckCards = jest.fn(async () => undefined);
  const createNote = jest.fn(async () => overrides.createdNote ?? { id: 'note-1' });
  const updateNote = jest.fn(async () => ({ id: 'note-1' }));
  // The delivery path funnels the deck's topic through the same resolver every
  // artefact write uses. Default: a valid topic passes through; a null clears.
  // Tests override this to make it reject a cross-course topic.
  const resolveArtefactTopic = jest.fn(async (input: { topicId?: unknown }) => input.topicId ?? null);
  const supabaseService: any = {
    getClient: () => db,
    getMarketplaceListingById: jest.fn(async () => overrides.listing ?? null),
    createMarketplaceListing: jest.fn(async () => overrides.createdListing ?? { id: 'listing-1' }),
    saveOfflineBundle,
    importDeck,
    replaceDeckCards,
    createNote,
    updateNote,
    resolveArtefactTopic,
  };
  return {
    service: new MarketplaceStudyPacksService(supabaseService),
    supabaseService,
    writes,
    saveOfflineBundle,
    importDeck,
    replaceDeckCards,
    createNote,
    updateNote,
    resolveArtefactTopic,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPaystackEnabled.mockReturnValue(true);
  mockAssertSellerCanReceivePayout.mockResolvedValue(undefined);
});

describe('publishStudyPack', () => {
  const BASE_INPUT = {
    title: 'Cell Biology Study Pack',
    campusId: 'campus-1',
    content: CONTENT,
    attestation: true,
  };

  it('rejects content with no deliverable parts', async () => {
    const { service } = makeSupabase({});
    await expect(
      service.publishStudyPack('user-1', { ...BASE_INPUT, content: { summaries: [], flashcards: [], questions: [] } })
    ).rejects.toBeInstanceOf(PublicError);
  });

  it('rejects a missing title and campus', async () => {
    const { service } = makeSupabase({});
    await expect(
      service.publishStudyPack('user-1', { ...BASE_INPUT, title: '  ' })
    ).rejects.toThrow('Title is required');
    await expect(
      service.publishStudyPack('user-1', { ...BASE_INPUT, campusId: '' })
    ).rejects.toThrow('Campus is required');
  });

  it('requires the rights attestation', async () => {
    const { service } = makeSupabase({});
    await expect(
      service.publishStudyPack('user-1', { ...BASE_INPUT, attestation: false })
    ).rejects.toBeInstanceOf(PublicError);
  });

  it('blocks paid packs when Paystack is disabled', async () => {
    mockPaystackEnabled.mockReturnValue(false);
    const { service } = makeSupabase({});
    await expect(
      service.publishStudyPack('user-1', { ...BASE_INPUT, price: 500 })
    ).rejects.toThrow('require in-app payments');
  });

  it('requires a payable seller before publishing a paid pack', async () => {
    mockAssertSellerCanReceivePayout.mockRejectedValue(new PublicError('No payout profile'));
    const { service } = makeSupabase({});
    await expect(
      service.publishStudyPack('user-1', { ...BASE_INPUT, price: 500 })
    ).rejects.toThrow('No payout profile');
  });

  it('creates a study_pack listing and stores the snapshot with server-derived counts', async () => {
    const { service, supabaseService, writes } = makeSupabase({
      createdListing: { id: 'listing-9' },
      tables: {
        marketplace_study_packs: {
          data: { id: 'pack-1', listing_id: 'listing-9', version: 1, counts: {} },
          error: null,
        },
      },
    });

    const result = await service.publishStudyPack('user-1', BASE_INPUT);

    expect(result.pack.listingId).toBe('listing-9');
    expect(result.pack.version).toBe(1);
    expect(supabaseService.createMarketplaceListing).toHaveBeenCalledWith(
      expect.objectContaining({ listing_kind: 'study_pack', category: 'study_pack', quantity: null }),
      'user-1'
    );
    const packInsert = writes.find((w) => w.table === 'marketplace_study_packs' && w.op === 'insert');
    expect(packInsert?.payload).toMatchObject({
      listing_id: 'listing-9',
      version: 1,
      counts: { flashcards: 2, questions: 2, summaries: 1 },
    });
  });
});

describe('grantEntitlement (delivery)', () => {
  const PACK = {
    id: 'pack-1',
    listing_id: 'listing-1',
    version: 2,
    content: CONTENT,
    counts: { guideWords: 6, summaries: 1, flashcards: 2, questions: 2 },
    course_id: 'course-1',
  };

  it('delivers a bundle, a deck and a note, then records delivered_refs', async () => {
    const { service, writes, saveOfflineBundle, importDeck, createNote, replaceDeckCards, updateNote } =
      makeSupabase({
        tables: {
          marketplace_study_packs: { data: PACK, error: null },
          marketplace_question_bank_entitlements: { data: null, error: null },
          marketplace_listings: { data: { title: 'Cell Biology Study Pack' }, error: null },
        },
      });

    const result = await service.grantEntitlement('listing-1', 'buyer-1', 'order-1');

    expect(saveOfflineBundle).toHaveBeenCalledWith(
      'buyer-1',
      expect.objectContaining({ bundleId: 'pack-listing-1', questions: CONTENT.questions })
    );
    expect(importDeck).toHaveBeenCalledTimes(1);
    expect(createNote).toHaveBeenCalledWith(
      'buyer-1',
      expect.objectContaining({ sourceType: 'import', courseId: 'course-1' })
    );
    expect(replaceDeckCards).not.toHaveBeenCalled();
    expect(updateNote).not.toHaveBeenCalled();
    expect(result).toMatchObject({ bundleId: 'pack-listing-1', deckId: 'deck-1', noteId: 'note-1', version: 2 });

    const refsUpdate = writes.find(
      (w) => w.table === 'marketplace_question_bank_entitlements' && w.op === 'update'
    );
    expect(refsUpdate?.payload).toMatchObject({
      version_at_download: 2,
      delivered_refs: { bundleId: 'pack-listing-1', deckId: 'deck-1', noteId: 'note-1', version: 2 },
    });
  });

  it('reuses the deck and note on re-delivery instead of duplicating', async () => {
    const { service, importDeck, createNote, replaceDeckCards, updateNote } = makeSupabase({
      tables: {
        marketplace_study_packs: { data: PACK, error: null },
        marketplace_question_bank_entitlements: {
          data: { id: 'ent-1', delivered_refs: { deckId: 'deck-9', noteId: 'note-9' }, version_at_download: 1 },
          error: null,
        },
        marketplace_listings: { data: { title: 'Cell Biology Study Pack' }, error: null },
      },
    });

    await service.grantEntitlement('listing-1', 'buyer-1', null);

    expect(replaceDeckCards).toHaveBeenCalledWith('deck-9', CONTENT.flashcards);
    expect(updateNote).toHaveBeenCalledWith('buyer-1', 'note-9', expect.objectContaining({ body: expect.any(String) }));
    expect(importDeck).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });

  it('clears the delivered question bundle when a new version drops all questions', async () => {
    const NO_Q_PACK = { ...PACK, content: { ...CONTENT, questions: [] } };
    const { service, saveOfflineBundle } = makeSupabase({
      tables: {
        marketplace_study_packs: { data: NO_Q_PACK, error: null },
        marketplace_question_bank_entitlements: {
          data: { id: 'ent-1', delivered_refs: { bundleId: 'pack-listing-1', deckId: 'deck-9', noteId: 'note-9' }, version_at_download: 1 },
          error: null,
        },
        marketplace_listings: { data: { title: 'Pack' }, error: null },
      },
    });
    await service.grantEntitlement('listing-1', 'buyer-1', null);
    // The bundle is overwritten with an empty question set — no stale questions.
    expect(saveOfflineBundle).toHaveBeenCalledWith(
      'buyer-1',
      expect.objectContaining({ bundleId: 'pack-listing-1', questions: [] })
    );
  });

  it('recreates the deck when the buyer deleted it (replaceDeckCards fails)', async () => {
    const { service, importDeck, replaceDeckCards } = makeSupabase({
      tables: {
        marketplace_study_packs: { data: PACK, error: null },
        marketplace_question_bank_entitlements: {
          data: { id: 'ent-1', delivered_refs: { deckId: 'deck-gone', noteId: 'note-9' }, version_at_download: 1 },
          error: null,
        },
        marketplace_listings: { data: { title: 'Pack' }, error: null },
      },
    });
    replaceDeckCards.mockRejectedValueOnce(new Error('deck FK gone'));
    const result = await service.grantEntitlement('listing-1', 'buyer-1', null);
    expect(replaceDeckCards).toHaveBeenCalledWith('deck-gone', CONTENT.flashcards);
    expect(importDeck).toHaveBeenCalledTimes(1); // recreated fresh
    expect(result.deckId).toBe('deck-1');
  });

  it('fails clearly when the content snapshot is missing', async () => {
    const { service } = makeSupabase({
      tables: { marketplace_study_packs: { data: null, error: null } },
    });
    await expect(service.grantEntitlement('listing-1', 'buyer-1', null)).rejects.toThrow('content not found');
  });

  it('files the delivered parts under the listing topic while the listing is still in the pack course', async () => {
    const { service, createNote, writes } = makeSupabase({
      tables: {
        marketplace_study_packs: { data: PACK, error: null },
        marketplace_question_bank_entitlements: { data: null, error: null },
        marketplace_listings: { data: { title: 'Pack', course_id: 'course-1', topic_id: 'topic-1' }, error: null },
      },
    });

    await service.grantEntitlement('listing-1', 'buyer-1', null);

    expect(createNote).toHaveBeenCalledWith(
      'buyer-1',
      expect.objectContaining({ courseId: 'course-1', topicId: 'topic-1' })
    );
    const deckUpdate = writes.find((w) => w.table === 'decks' && w.op === 'update');
    expect(deckUpdate?.payload).toMatchObject({ course_id: 'course-1', topic_id: 'topic-1' });
  });

  it('drops a topic the seller left behind by moving the listing to another course', async () => {
    // marketplace_study_packs.course_id is never updated by a listing edit, so
    // the listing's topic belongs to a course the artefacts are NOT filed under.
    const { service, createNote, writes } = makeSupabase({
      tables: {
        marketplace_study_packs: { data: PACK, error: null },
        marketplace_question_bank_entitlements: { data: null, error: null },
        marketplace_listings: { data: { title: 'Pack', course_id: 'course-2', topic_id: 'topic-2' }, error: null },
      },
    });

    await service.grantEntitlement('listing-1', 'buyer-1', null);

    expect(createNote).toHaveBeenCalledWith(
      'buyer-1',
      expect.objectContaining({ courseId: 'course-1', topicId: null })
    );
    const deckUpdate = writes.find((w) => w.table === 'decks' && w.op === 'update');
    expect(deckUpdate?.payload).toEqual({ course_id: 'course-1' });
  });

  it('delivers the deck UNFILED when the topic fails the resolver, instead of failing a paid delivery', async () => {
    // The listing sits in the pack's course, so the caller's course guard passes
    // its topic through — but the stored topic_id is stale and does not belong to
    // that course. The shared resolver (resolveForArtefact) is the only thing that
    // catches this.
    //
    // It must NOT abort: the buyer has paid, and which row of a syllabus their
    // deck sits under is cosmetic next to receiving the deck at all. Aborting is
    // precisely the blocker this feature already shipped once — a seller edit
    // desynced the pair and paid delivery broke permanently. So: deck delivered,
    // topic dropped, no topic_id on the write.
    const { service, supabaseService, importDeck, writes } = makeSupabase({
      tables: {
        marketplace_study_packs: { data: PACK, error: null }, // course_id: 'course-1'
        marketplace_question_bank_entitlements: { data: null, error: null },
        marketplace_listings: {
          data: { title: 'Pack', course_id: 'course-1', topic_id: 'topic-from-another-course' },
          error: null,
        },
      },
    });
    supabaseService.resolveArtefactTopic.mockRejectedValue(
      new PublicError('That topic does not belong to the selected course')
    );

    await expect(service.grantEntitlement('listing-1', 'buyer-1', null)).resolves.toBeDefined();

    // The deck IS minted and filed under the pack's course, with the stray topic
    // simply absent — never misfiled onto the buyer's deck.
    expect(importDeck).toHaveBeenCalled();
    const deckUpdate = writes.find((w) => w.table === 'decks' && w.op === 'update');
    expect(deckUpdate?.payload).toEqual({ course_id: 'course-1' });
    expect(deckUpdate?.payload).not.toHaveProperty('topic_id');
  });

  it('records the parts already delivered when a later step fails, so a retry cannot duplicate them', async () => {
    const { service, createNote, writes } = makeSupabase({
      tables: {
        marketplace_study_packs: { data: PACK, error: null },
        marketplace_question_bank_entitlements: { data: null, error: null },
        marketplace_listings: { data: { title: 'Pack' }, error: null },
      },
    });
    createNote.mockRejectedValueOnce(new Error('note write failed'));

    await expect(service.grantEntitlement('listing-1', 'buyer-1', null)).rejects.toThrow('note write failed');

    const refsUpdate = writes.find(
      (w) => w.table === 'marketplace_question_bank_entitlements' && w.op === 'update'
    );
    // The deck that was minted is remembered; the version is not, because the
    // buyer does not hold a fully delivered copy of it.
    expect(refsUpdate?.payload).toEqual({
      delivered_refs: { version: 2, bundleId: 'pack-listing-1', deckId: 'deck-1' },
    });
  });
});

describe('downloadStudyPack', () => {
  const tables = {
    marketplace_study_packs: {
      data: { id: 'pack-1', listing_id: 'listing-1', version: 1, content: CONTENT, counts: {}, course_id: null },
      error: null,
    },
    marketplace_listings: { data: { title: 'Free Pack' }, error: null },
    marketplace_question_bank_entitlements: { data: null, error: null },
  };

  it('grants free packs to any signed-in user', async () => {
    const { service, saveOfflineBundle } = makeSupabase({
      listing: { id: 'listing-1', user_id: 'seller-1', listing_kind: 'study_pack', status: 'active', price: null },
      tables,
    });
    await expect(service.downloadStudyPack('listing-1', 'buyer-1')).resolves.toMatchObject({
      bundleId: 'pack-listing-1',
    });
    expect(saveOfflineBundle).toHaveBeenCalled();
  });

  it('refuses paid packs without an entitlement', async () => {
    const { service } = makeSupabase({
      listing: { id: 'listing-1', user_id: 'seller-1', listing_kind: 'study_pack', status: 'active', price: 500 },
      tables,
    });
    await expect(service.downloadStudyPack('listing-1', 'buyer-1')).rejects.toThrow('Purchase this study pack');
  });

  it('rejects non-study-pack listings', async () => {
    const { service } = makeSupabase({
      listing: { id: 'listing-1', user_id: 'seller-1', listing_kind: 'single', status: 'active', price: 500 },
    });
    await expect(service.downloadStudyPack('listing-1', 'buyer-1')).rejects.toThrow('Study pack not found');
  });
});

describe('updateStudyPackContent', () => {
  const PACK_ROW = {
    id: 'pack-1',
    listing_id: 'listing-1',
    version: 2,
    content: CONTENT,
    counts: {},
    course_id: null,
  };

  it('rejects non-sellers', async () => {
    const { service } = makeSupabase({
      listing: { id: 'listing-1', user_id: 'seller-1', category_specific_fields: {} },
      tables: { marketplace_study_packs: { data: PACK_ROW, error: null } },
    });
    await expect(
      service.updateStudyPackContent('listing-1', 'someone-else', CONTENT, { attestation: true })
    ).rejects.toThrow('Only the seller');
  });

  it('bumps the version for the seller', async () => {
    const { service, writes } = makeSupabase({
      listing: { id: 'listing-1', user_id: 'seller-1', title: 'Pack', status: 'active', category_specific_fields: {} },
      tables: {
        marketplace_study_packs: [
          { data: PACK_ROW, error: null }, // getPackForListing
          { data: [{ listing_id: 'listing-1' }], error: null }, // update().select() → lock held
          { data: PACK_ROW, error: null }, // grantEntitlement re-read (best-effort)
        ],
        marketplace_listings: { data: { title: 'Pack' }, error: null },
        marketplace_question_bank_entitlements: { data: null, error: null },
      },
    });

    const result = await service.updateStudyPackContent('listing-1', 'seller-1', CONTENT, { attestation: true });
    expect(result.version).toBe(3);
    const packUpdate = writes.find((w) => w.table === 'marketplace_study_packs' && w.op === 'update');
    expect(packUpdate?.payload).toMatchObject({ version: 3 });
  });

  it('fails when the optimistic lock misses (concurrent update)', async () => {
    const { service } = makeSupabase({
      listing: { id: 'listing-1', user_id: 'seller-1', status: 'active', category_specific_fields: {} },
      tables: {
        marketplace_study_packs: [
          { data: PACK_ROW, error: null },
          { data: [], error: null }, // 0 rows matched the expected version
        ],
      },
    });
    await expect(
      service.updateStudyPackContent('listing-1', 'seller-1', CONTENT, { attestation: true })
    ).rejects.toThrow('updated elsewhere');
  });
});

describe('getStudyPackPreview', () => {
  it('strips answer keys and truncates the summary', async () => {
    const { service } = makeSupabase({
      listing: { id: 'listing-1', user_id: 'seller-1', listing_kind: 'study_pack', title: 'Pack' },
      tables: {
        marketplace_study_packs: {
          data: { id: 'pack-1', listing_id: 'listing-1', version: 1, content: CONTENT, counts: { questions: 2 }, course_id: null },
          error: null,
        },
        marketplace_question_bank_entitlements: { data: null, error: null },
      },
    });
    const preview = await service.getStudyPackPreview('listing-1', 'viewer-1');
    expect(preview.title).toBe('Pack');
    expect(preview.owned).toBe(false);
    expect(preview.flashcardFronts).toEqual(['What makes ATP?', 'Genetic material?']);
    expect(preview.summaryPreview!.length).toBeLessThanOrEqual(600);
    // no correctness markers survive
    for (const q of preview.questions as Array<Record<string, any>>) {
      expect(q.correctAnswer).toBeUndefined();
      for (const opt of (q.options || []) as Array<Record<string, any>>) {
        expect(opt.isCorrect).toBeUndefined();
      }
    }
  });
});

describe('listPurchases', () => {
  it('returns a unified library across question banks and study packs', async () => {
    const { service } = makeSupabase({
      tables: {
        marketplace_question_bank_entitlements: {
          data: [
            { listing_id: 'l-pack', version_at_download: 1, delivered_refs: { deckId: 'd1' }, created_at: '2026-08-22' },
            { listing_id: 'l-bank', version_at_download: 3, delivered_refs: {}, created_at: '2026-08-21' },
          ],
          error: null,
        },
        marketplace_listings: {
          data: [
            { id: 'l-pack', title: 'Pack', user_id: 's1', listing_kind: 'study_pack', course_id: 'c1', price: 500, status: 'active' },
            { id: 'l-bank', title: 'Bank', user_id: 's2', listing_kind: 'question_bank', course_id: null, price: null, status: 'active' },
          ],
          error: null,
        },
        marketplace_study_packs: { data: [{ listing_id: 'l-pack', version: 2 }], error: null },
        marketplace_question_banks: { data: [{ listing_id: 'l-bank', version: 3 }], error: null },
        profiles: { data: [{ id: 's1', name: 'Ada' }, { id: 's2', name: 'Grace' }], error: null },
      },
    });

    const purchases = (await service.listPurchases('buyer-1')) as any[];
    const byId = new Map(purchases.map((p) => [p.listingId, p]));
    expect(byId.get('l-pack')).toMatchObject({
      kind: 'study_pack',
      sellerName: 'Ada',
      version: 2,
      versionAtDownload: 1,
      updateAvailable: true,
    });
    expect(byId.get('l-bank')).toMatchObject({
      kind: 'question_bank',
      sellerName: 'Grace',
      version: 3,
      versionAtDownload: 3,
      updateAvailable: false,
    });
  });
});
