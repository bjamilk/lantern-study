/**
 * Question-bank publish / republish require the rights attestation (Phase 1 · E)
 * and persist provenance (attested-at/version on bank + listing, ai_assisted,
 * sources_cited). Stubbed SupabaseService; no network.
 */
import { MarketplaceQuestionBanksService } from './marketplaceQuestionBanks';
// The service takes `MarketplaceServiceHost` since M3 Phase B. The stand-ins
// below stay FLAT and are regrouped by the production adapter
// (`marketplaceHostFromFlat`), so every assertion still names the same
// `jest.fn()` and the adapter itself is exercised by these suites.
import { marketplaceHostFromFlat } from './marketplaceServiceHost';
import { ATTESTATION_REQUIRED_MESSAGE, RIGHTS_ATTESTATION_VERSION } from '@lantern/shared/moderation';
import { COURSE_ANCHOR_COPY } from '@lantern/shared/marketplace';

jest.mock('./learningEvents', () => ({ recordLearningEvent: jest.fn(async () => undefined) }));

const CAMPUS = '11111111-1111-4111-8111-111111111111';
const LISTING = '22222222-2222-4222-8222-222222222222';
const SELLER = '33333333-3333-4333-8333-333333333333';
/** A publish now has to name a real course (Gap 3). */
const COURSE = '44444444-4444-4444-8444-444444444444';

function makeDb() {
  const writes: Array<{ table: string; kind: string; payload: any }> = [];
  const from = (table: string) => {
    const chain: any = {};
    let kind = 'select';
    let payload: any;
    chain.select = () => chain;
    chain.insert = (p: any) => ((kind = 'insert'), (payload = p), chain);
    chain.update = (p: any) => ((kind = 'update'), (payload = p), chain);
    chain.delete = () => ((kind = 'delete'), chain);
    let eqId: unknown;
    chain.eq = (column?: string, value?: unknown) => {
      if (column === 'id') eqId = value;
      return chain;
    };
    chain.maybeSingle = async () => {
      // Only the one known course resolves; any other id is "no such course".
      if (table === 'courses') {
        return { data: eqId === COURSE ? { id: COURSE } : null, error: null };
      }
      if (table === 'marketplace_question_banks') {
        return { data: { id: 'b1', listing_id: LISTING, version: 1, question_count: 1, content: { questions: [{}] } }, error: null };
      }
      return { data: null, error: null };
    };
    chain.single = async () => {
      writes.push({ table, kind, payload });
      return { data: { id: 'b1', listing_id: LISTING, version: 1, question_count: 1, source_group_id: null }, error: null };
    };
    chain.then = (onF: any, onR: any) => {
      writes.push({ table, kind, payload });
      return Promise.resolve({ data: [{ listing_id: LISTING }], error: null }).then(onF, onR);
    };
    return chain;
  };
  return { from, writes };
}

function service(db: ReturnType<typeof makeDb>) {
  const createMarketplaceListing = jest.fn(async (data: any) => ({ id: LISTING, title: data.title, ...data }));
  const supabaseService: any = {
    getClient: () => db,
    createMarketplaceListing,
    getMarketplaceListingById: jest.fn(async () => ({
      id: LISTING,
      user_id: SELLER,
      status: 'active',
      listing_kind: 'question_bank',
      category_specific_fields: {},
    })),
  };
  const svc = new MarketplaceQuestionBanksService(marketplaceHostFromFlat(supabaseService));
  // deliverBundle touches offline_bundles; not under test here.
  (svc as any).deliverBundle = jest.fn(async () => undefined);
  return { svc, createMarketplaceListing };
}

const content = { config: {}, questions: [{ id: 'q1' }] };

describe('publishQuestionBank attestation', () => {
  it('refuses to publish without attestation (400, before touching the DB)', async () => {
    const db = makeDb();
    const { svc, createMarketplaceListing } = service(db);
    await expect(
      svc.publishQuestionBank(SELLER, { title: 'CHM 101 PQ', campusId: CAMPUS, content }),
    ).rejects.toMatchObject({ statusCode: 400, message: ATTESTATION_REQUIRED_MESSAGE });
    await expect(
      svc.publishQuestionBank(SELLER, { title: 'CHM 101 PQ', campusId: CAMPUS, content, attestation: 'true' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(createMarketplaceListing).not.toHaveBeenCalled();
    expect(db.writes).toHaveLength(0);
  });

  it('writes rights state on the listing and provenance on the bank when attested', async () => {
    const db = makeDb();
    const { svc, createMarketplaceListing } = service(db);
    await svc.publishQuestionBank(SELLER, {
      title: 'CHM 101 PQ',
      campusId: CAMPUS,
      courseId: COURSE,
      content,
      attestation: true,
      aiAssisted: true,
      sourcesCited: ['Lecture notes week 3', ' Stroud '],
    });
    expect(createMarketplaceListing).toHaveBeenCalledWith(
      expect.objectContaining({
        listing_kind: 'question_bank',
        rights_status: 'attested',
        rights_attestation_version: RIGHTS_ATTESTATION_VERSION,
        rights_attested_at: expect.any(String),
      }),
      SELLER,
    );
    const bankInsert = db.writes.find((w) => w.table === 'marketplace_question_banks' && w.kind === 'insert');
    expect(bankInsert?.payload).toMatchObject({
      listing_id: LISTING,
      rights_attestation_version: RIGHTS_ATTESTATION_VERSION,
      rights_attested_at: expect.any(String),
      ai_assisted: true,
      sources_cited: ['Lecture notes week 3', 'Stroud'],
    });
  });

  it('rejects more than 20 sources', async () => {
    const { svc } = service(makeDb());
    await expect(
      svc.publishQuestionBank(SELLER, {
        title: 'x',
        campusId: CAMPUS,
        content,
        attestation: true,
        sourcesCited: Array.from({ length: 21 }, (_, i) => `s${i}`),
      }),
    ).rejects.toMatchObject({ statusCode: 400, message: /at most 20/ });
  });

  it('blocks a leaked-exam title via the content filter, before touching the DB (finding D)', async () => {
    const db = makeDb();
    const { svc, createMarketplaceListing } = service(db);
    await expect(
      svc.publishQuestionBank(SELLER, {
        title: 'Leaked CHM 101 exam answers before the paper',
        campusId: CAMPUS,
        content,
        attestation: true,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(createMarketplaceListing).not.toHaveBeenCalled();
    expect(db.writes).toHaveLength(0);
  });

  it('rejects a non-uuid courseId (400, not a DB 500) (finding D)', async () => {
    const { svc } = service(makeDb());
    await expect(
      svc.publishQuestionBank(SELLER, {
        title: 'CHM 101 PQ',
        campusId: CAMPUS,
        content,
        attestation: true,
        courseId: 'not-a-uuid',
      }),
    ).rejects.toThrow(/course could not be found/);
  });

  it('refuses a publish with NO course at all (Gap 3), before touching the DB', async () => {
    const db = makeDb();
    const { svc, createMarketplaceListing } = service(db);
    await expect(
      svc.publishQuestionBank(SELLER, {
        title: 'CHM 101 PQ',
        campusId: CAMPUS,
        content,
        attestation: true,
      }),
    ).rejects.toThrow(COURSE_ANCHOR_COPY.required);
    expect(createMarketplaceListing).not.toHaveBeenCalled();
    expect(db.writes).toHaveLength(0);
  });

  it('refuses a course id that names no course', async () => {
    const db = makeDb();
    const { svc, createMarketplaceListing } = service(db);
    await expect(
      svc.publishQuestionBank(SELLER, {
        title: 'CHM 101 PQ',
        campusId: CAMPUS,
        courseId: '55555555-5555-4555-8555-555555555555',
        content,
        attestation: true,
        // The double answers `courses` with the known COURSE row only for that
        // id; any other id resolves to null.
      }),
    ).rejects.toThrow(COURSE_ANCHOR_COPY.invalid);
    expect(createMarketplaceListing).not.toHaveBeenCalled();
  });

  it('still publishes a legitimate "past questions" title (filter must not over-match) (finding D)', async () => {
    const db = makeDb();
    const { svc, createMarketplaceListing } = service(db);
    await svc.publishQuestionBank(SELLER, {
      title: 'CHM 101 Past Questions and Answers',
      campusId: CAMPUS,
      courseId: COURSE,
      content,
      attestation: true,
    });
    expect(createMarketplaceListing).toHaveBeenCalled();
  });
});

describe('updateQuestionBankContent attestation', () => {
  it('re-requires attestation on every republish', async () => {
    const db = makeDb();
    const { svc } = service(db);
    await expect(svc.updateQuestionBankContent(LISTING, SELLER, content)).rejects.toMatchObject({
      statusCode: 400,
      message: ATTESTATION_REQUIRED_MESSAGE,
    });
    expect(db.writes).toHaveLength(0);
  });

  it('refreshes rights_attested_at/version on the bank (and provenance when sent)', async () => {
    const db = makeDb();
    const { svc } = service(db);
    await expect(
      svc.updateQuestionBankContent(LISTING, SELLER, content, { attestation: true, aiAssisted: false }),
    ).resolves.toEqual({ version: 2, questionCount: 1 });
    const bankUpdate = db.writes.find((w) => w.table === 'marketplace_question_banks' && w.kind === 'update');
    expect(bankUpdate?.payload).toMatchObject({
      version: 2,
      rights_attestation_version: RIGHTS_ATTESTATION_VERSION,
      rights_attested_at: expect.any(String),
      ai_assisted: false,
    });
    expect(bankUpdate?.payload).not.toHaveProperty('sources_cited');
  });
});
