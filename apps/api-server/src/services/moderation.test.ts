/**
 * Moderation service (Phase 1 · E): takedown writes both the moderated status
 * and the takedown columns, strikes auto-suspend at 3, the appeal state
 * machine, the attestation + content-filter guards, and the migration shape.
 * Prototype + stub-db style (see supabase.listingModerationLock.test.ts).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ModerationService,
  assertListingAttestation,
  listingRightsFields,
  normalizePublishProvenance,
  runListingContentFilter,
  stripListingModerationFields,
} from './moderation';
import { logAdminAction, invalidateBanCache } from './adminAudit';
import {
  ATTESTATION_REQUIRED_MESSAGE,
  CONTENT_BLOCK_MESSAGE,
  RIGHTS_ATTESTATION_VERSION,
} from '@lantern/shared/moderation';

jest.mock('./adminAudit', () => ({
  logAdminAction: jest.fn(async () => undefined),
  invalidateBanCache: jest.fn(async () => undefined),
}));

const LISTING = '11111111-1111-4111-8111-111111111111';
const REPORT = '33333333-3333-4333-8333-333333333333';
const SELLER = '44444444-4444-4444-8444-444444444444';
const ADMIN = '55555555-5555-4555-8555-555555555555';
const MESSAGE = '66666666-6666-4666-8666-666666666666';

type Op = { table: string; kind: string; payload?: any; filters: Array<[string, string, unknown]>; head?: boolean };
function makeDb(resolve: (op: Op, ops: Op[]) => { data?: unknown; error?: unknown; count?: number }) {
  const ops: Op[] = [];
  const from = (table: string) => {
    const op: Op = { table, kind: 'select', filters: [] };
    const chain: any = {};
    chain.select = (_cols?: string, opts?: { head?: boolean }) => ((op.head = !!opts?.head), chain);
    chain.insert = (payload: unknown) => ((op.kind = 'insert'), (op.payload = payload), chain);
    chain.update = (payload: unknown) => ((op.kind = 'update'), (op.payload = payload), chain);
    for (const f of ['eq', 'gt', 'in', 'is']) {
      chain[f] = (col: string, val: unknown) => (op.filters.push([f, col, val]), chain);
    }
    chain.order = () => chain;
    chain.range = () => chain;
    chain.limit = () => chain;
    const run = () => {
      ops.push(op);
      return Promise.resolve(resolve(op, ops));
    };
    chain.maybeSingle = run;
    chain.single = run;
    chain.then = (onF: any, onR: any) => run().then(onF, onR);
    return chain;
  };
  return { from, ops };
}

function service(db: ReturnType<typeof makeDb>) {
  const createNotification = jest.fn(async () => null);
  const svc = new ModerationService({ getClient: () => db, createNotification } as any);
  return { svc, createNotification };
}

const filterOf = (op: Op, col: string) => op.filters.find(([, c]) => c === col)?.[2];

beforeEach(() => {
  (logAdminAction as jest.Mock).mockClear();
  (invalidateBanCache as jest.Mock).mockClear();
});

describe('applyReportAction remove_content on a listing', () => {
  it('sets status removed_by_admin AND the takedown columns, resolves the report, notifies force:true, audits', async () => {
    const db = makeDb((op) => {
      if (op.table === 'content_reports' && op.kind === 'select') {
        return { data: { id: REPORT, reporter_id: 'r', target_type: 'listing', target_id: LISTING, reason: 'copyright', status: 'pending' } };
      }
      if (op.table === 'marketplace_listings' && op.kind === 'select') {
        return { data: { id: LISTING, title: 'Anatomy notes', status: 'active', user_id: SELLER, listing_kind: 'single' } };
      }
      if (op.table === 'marketplace_listings' && op.kind === 'update') {
        return { data: { id: LISTING, user_id: SELLER, title: 'Anatomy notes', ...op.payload } };
      }
      if (op.table === 'content_reports' && op.kind === 'update') return { data: null };
      return { data: null };
    });
    const { svc, createNotification } = service(db);
    const result = await svc.applyReportAction(REPORT, { action: 'remove_content', note: 'Scanned textbook' }, ADMIN);
    expect(result).toEqual({ action: 'remove_content', status: 'resolved' });

    const takedown = db.ops.find((o) => o.table === 'marketplace_listings' && o.kind === 'update');
    expect(takedown?.payload).toMatchObject({
      status: 'removed_by_admin',
      rights_status: 'takedown',
      takedown_reason: 'Scanned textbook',
      takedown_by: ADMIN,
    });
    expect(typeof takedown?.payload.takedown_at).toBe('string');
    expect(filterOf(takedown!, 'id')).toBe(LISTING);

    const reportUpdate = db.ops.find((o) => o.table === 'content_reports' && o.kind === 'update');
    expect(reportUpdate?.payload).toMatchObject({ status: 'resolved', admin_note: 'Scanned textbook', resolved_by: ADMIN });

    expect(createNotification).toHaveBeenCalledWith(
      SELLER,
      expect.objectContaining({ force: true, message: expect.stringMatching(/removed by Lantern moderation/) }),
    );
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'report_remove_content', targetType: 'report', targetId: REPORT, actorId: ADMIN }),
    );
  });

  it('refuses remove_content on a message with 400 "dedicated tool" and parks the report under review', async () => {
    const db = makeDb((op) => {
      if (op.table === 'content_reports' && op.kind === 'select') {
        return { data: { id: REPORT, target_type: 'message', target_id: MESSAGE, reason: 'harassment', status: 'pending' } };
      }
      if (op.table === 'messages') return { data: { id: MESSAGE, text: 'hi', sender_id: 'u', group_id: 'g' } };
      return { data: null };
    });
    const { svc } = service(db);
    await expect(svc.applyReportAction(REPORT, { action: 'remove_content' }, ADMIN)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/dedicated admin tool/),
    });
    const reportUpdate = db.ops.find((o) => o.table === 'content_reports' && o.kind === 'update');
    expect(reportUpdate?.payload).toMatchObject({ status: 'under_review' });
    expect(db.ops.some((o) => o.table === 'messages' && o.kind !== 'select')).toBe(false);
  });

  it('rejects an unknown action and a missing report', async () => {
    const db = makeDb(() => ({ data: null }));
    const { svc } = service(db);
    await expect(svc.applyReportAction(REPORT, { action: 'nuke' }, ADMIN)).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.applyReportAction(REPORT, { action: 'dismiss' }, ADMIN)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('addStrike + automatic suspension', () => {
  function strikeDb(activeCount: number, settings: Record<string, unknown> = {}) {
    const db = makeDb((op) => {
      if (op.table === 'moderation_strikes' && op.kind === 'insert') {
        return { data: { id: 's1', user_id: SELLER, severity: op.payload.severity, reason: op.payload.reason, created_at: 'now', expires_at: op.payload.expires_at } };
      }
      if (op.table === 'moderation_strikes' && op.kind === 'select') return { count: activeCount };
      if (op.table === 'profiles' && op.kind === 'select') return { data: { settings } };
      if (op.table === 'profiles' && op.kind === 'update') return { data: null };
      return { data: null };
    });
    return db;
  }

  it('does not suspend at 2 active strikes', async () => {
    const db = strikeDb(2);
    const { svc, createNotification } = service(db);
    const result = await svc.addStrike(SELLER, { reason: 'Copyright', severity: 1, reportId: REPORT, createdBy: ADMIN });
    expect(result.activeStrikes).toBe(2);
    expect(result.suspendedUntil).toBeNull();
    expect(db.ops.some((o) => o.table === 'profiles' && o.kind === 'update')).toBe(false);
    expect(createNotification).toHaveBeenCalledWith(SELLER, expect.objectContaining({ force: true }));
  });

  it('suspends for 14 days at 3 active strikes (merging settings, invalidating the ban cache, auditing)', async () => {
    const db = strikeDb(3, { appearance: { theme: 'dark' } });
    const { svc, createNotification } = service(db);
    const before = Date.now();
    const result = await svc.addStrike(SELLER, { reason: 'Leaked exam', severity: 2, createdBy: ADMIN });
    expect(result.activeStrikes).toBe(3);
    const until = new Date(result.suspendedUntil!).getTime();
    expect(until - before).toBeGreaterThan(13.9 * 86_400_000);
    expect(until - before).toBeLessThan(14.1 * 86_400_000);

    const settingsUpdate = db.ops.find((o) => o.table === 'profiles' && o.kind === 'update');
    expect(settingsUpdate?.payload.settings).toEqual({
      appearance: { theme: 'dark' },
      suspended_until: result.suspendedUntil,
    });
    expect(invalidateBanCache).toHaveBeenCalledWith(SELLER);
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'user_suspend', targetType: 'user', targetId: SELLER }),
    );
    expect(createNotification).toHaveBeenCalledWith(
      SELLER,
      expect.objectContaining({ force: true, message: expect.stringMatching(/suspended until/) }),
    );
  });

  it('keeps a longer existing suspension instead of shortening it', async () => {
    const far = new Date(Date.now() + 60 * 86_400_000).toISOString();
    const db = strikeDb(4, { suspended_until: far });
    const { svc } = service(db);
    const result = await svc.addStrike(SELLER, { reason: 'Again', createdBy: ADMIN });
    expect(result.suspendedUntil).toBe(far);
    expect(db.ops.some((o) => o.table === 'profiles' && o.kind === 'update')).toBe(false);
  });

  it('validates reason and severity', async () => {
    const { svc } = service(makeDb(() => ({ data: null })));
    await expect(svc.addStrike(SELLER, { reason: '', createdBy: ADMIN })).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.addStrike(SELLER, { reason: 'x', severity: 5, createdBy: ADMIN })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('appeal state machine', () => {
  const listingRow = (status: string, appeal_status: string) => ({
    id: LISTING,
    user_id: SELLER,
    title: 'Anatomy notes',
    status,
    appeal_status,
    appeal_note: null,
  });

  it('lets the owner appeal a removed listing once', async () => {
    const db = makeDb((op) => {
      if (op.kind === 'select') return { data: listingRow('removed_by_admin', 'none') };
      if (op.kind === 'update') return { data: { id: LISTING, status: 'removed_by_admin', ...op.payload } };
      return { data: null };
    });
    const { svc } = service(db);
    const result = await svc.appealListing(LISTING, SELLER, 'I wrote these notes myself');
    expect(result).toMatchObject({ appeal_status: 'requested', appeal_note: 'I wrote these notes myself' });
    const update = db.ops.find((o) => o.kind === 'update');
    expect(update?.payload).toMatchObject({ appeal_status: 'requested' });
    // Optimistic: the write is fenced on the appeal_status we read.
    expect(update?.filters).toEqual(expect.arrayContaining([['eq', 'id', LISTING], ['eq', 'appeal_status', 'none']]));
  });

  it('refuses appeals on live listings (400), repeat appeals (409), non-owners (403), empty notes (400)', async () => {
    const active = makeDb(() => ({ data: listingRow('active', 'none') }));
    await expect(service(active).svc.appealListing(LISTING, SELLER, 'note')).rejects.toMatchObject({ statusCode: 400 });

    const again = makeDb(() => ({ data: listingRow('removed_by_admin', 'requested') }));
    await expect(service(again).svc.appealListing(LISTING, SELLER, 'note')).rejects.toMatchObject({ statusCode: 409 });

    const decided = makeDb(() => ({ data: listingRow('removed_by_admin', 'upheld') }));
    await expect(service(decided).svc.appealListing(LISTING, SELLER, 'note')).rejects.toMatchObject({ statusCode: 409 });

    const stranger = makeDb(() => ({ data: listingRow('removed_by_admin', 'none') }));
    await expect(service(stranger).svc.appealListing(LISTING, 'someone-else', 'note')).rejects.toMatchObject({ statusCode: 403 });

    const blank = makeDb(() => ({ data: listingRow('removed_by_admin', 'none') }));
    await expect(service(blank).svc.appealListing(LISTING, SELLER, '   ')).rejects.toMatchObject({ statusCode: 400 });
    expect(blank.ops.some((o) => o.kind === 'update')).toBe(false);
  });

  it('reversed restores the listing: status active, rights_status cleared, takedown fields cleared', async () => {
    const db = makeDb((op) => {
      if (op.kind === 'select') return { data: listingRow('removed_by_admin', 'requested') };
      if (op.kind === 'update') return { data: { id: LISTING, status: op.payload.status ?? 'removed_by_admin', appeal_status: op.payload.appeal_status } };
      return { data: null };
    });
    const { svc, createNotification } = service(db);
    const result = await svc.decideAppeal(LISTING, 'reversed', 'Verified authorship', ADMIN);
    expect(result).toEqual({ id: LISTING, status: 'active', appeal_status: 'reversed' });
    const update = db.ops.find((o) => o.kind === 'update');
    expect(update?.payload).toMatchObject({
      status: 'active',
      rights_status: 'cleared',
      takedown_reason: null,
      takedown_at: null,
      takedown_by: null,
      appeal_status: 'reversed',
      appeal_decided_by: ADMIN,
    });
    expect(update?.filters).toEqual(expect.arrayContaining([['eq', 'appeal_status', 'requested']]));
    expect(createNotification).toHaveBeenCalledWith(SELLER, expect.objectContaining({ force: true, message: expect.stringMatching(/live again/) }));
    expect(logAdminAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'listing_appeal_reversed', targetId: LISTING }));
  });

  it('upheld keeps the takedown and only records the decision', async () => {
    const db = makeDb((op) => {
      if (op.kind === 'select') return { data: listingRow('removed_by_admin', 'requested') };
      if (op.kind === 'update') return { data: { id: LISTING, status: 'removed_by_admin', appeal_status: op.payload.appeal_status } };
      return { data: null };
    });
    const { svc } = service(db);
    const result = await svc.decideAppeal(LISTING, 'upheld', null, ADMIN);
    expect(result.status).toBe('removed_by_admin');
    const update = db.ops.find((o) => o.kind === 'update');
    expect(update?.payload).toEqual({ appeal_status: 'upheld', appeal_decided_at: expect.any(String), appeal_decided_by: ADMIN });
    expect(update?.payload).not.toHaveProperty('status');
    expect(logAdminAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'listing_appeal_upheld' }));
  });

  it('refuses a decision when no appeal is waiting and an unknown decision', async () => {
    const none = makeDb(() => ({ data: listingRow('removed_by_admin', 'none') }));
    await expect(service(none).svc.decideAppeal(LISTING, 'reversed', null, ADMIN)).rejects.toMatchObject({ statusCode: 409 });
    await expect(service(none).svc.decideAppeal(LISTING, 'maybe', null, ADMIN)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('attestation + content filter guards', () => {
  it('academic listings (and every question bank) must attest; others may skip', () => {
    expect(() => assertListingAttestation({ listingKind: 'single', category: 'lecture_notes' })).toThrow(ATTESTATION_REQUIRED_MESSAGE);
    expect(() => assertListingAttestation({ listingKind: 'question_bank', category: 'custom:x' })).toThrow(ATTESTATION_REQUIRED_MESSAGE);
    let err: any;
    try {
      assertListingAttestation({ listingKind: 'single', category: 'pq_bank', attestation: 'yes' });
    } catch (e) {
      err = e;
    }
    expect(err?.statusCode).toBe(400);
    expect(assertListingAttestation({ listingKind: 'single', category: 'pq_bank', attestation: true })).toBe(true);
    expect(assertListingAttestation({ listingKind: 'single', category: 'accommodation' })).toBe(false);
    expect(assertListingAttestation({ listingKind: 'single', category: 'custom:lecture notes' })).toBe(false);
  });

  it('listingRightsFields writes the attested state with version + timestamp', () => {
    const now = new Date('2026-08-22T10:00:00Z');
    expect(listingRightsFields(true, now)).toEqual({
      rights_status: 'attested',
      rights_attested_at: now.toISOString(),
      rights_attestation_version: RIGHTS_ATTESTATION_VERSION,
    });
    expect(listingRightsFields(false)).toEqual({ rights_status: 'unattested', rights_attested_at: null, rights_attestation_version: null });
  });

  it('publish provenance requires attestation and normalises sources', () => {
    expect(() => normalizePublishProvenance({})).toThrow(ATTESTATION_REQUIRED_MESSAGE);
    expect(() => normalizePublishProvenance({ attestation: true, sourcesCited: ['x'.repeat(201)] })).toThrow(/200 characters/);
    const out = normalizePublishProvenance({ attestation: true, aiAssisted: true, sourcesCited: ' A \nB\n' });
    expect(out).toMatchObject({ ai_assisted: true, sources_cited: ['A', 'B'], rights_attestation_version: RIGHTS_ATTESTATION_VERSION });
  });

  it('content filter: leaked-exam wording is a 400, lecturer slides are flags, past questions pass', () => {
    let err: any;
    try {
      runListingContentFilter({ title: 'Leaked CHM 101 exam', description: '' });
    } catch (e) {
      err = e;
    }
    expect(err?.statusCode).toBe(400);
    expect(err?.message).toBe(CONTENT_BLOCK_MESSAGE);

    const flags = runListingContentFilter({ title: 'PHY 101', description: "Lecturer's slides, all topics", now: new Date('2026-08-22T10:00:00Z') });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ reason: 'copyright', at: '2026-08-22T10:00:00.000Z', field: 'title+description' });

    expect(runListingContentFilter({ title: 'BIO 201 past questions 2019–2025', description: 'with answers' })).toEqual([]);
  });

  it('recordListingFlags merges flags onto the listing and opens an under-review auto report (dupes ignored)', async () => {
    let inserted: any = null;
    const db = makeDb((op) => {
      if (op.table === 'marketplace_listings' && op.kind === 'select') {
        return { data: { id: LISTING, title: 'x', status: 'active', user_id: SELLER, moderation_flags: [{ pattern: 'old', reason: 'copyright', at: 't' }] } };
      }
      if (op.table === 'marketplace_listings' && op.kind === 'update') return { data: null };
      if (op.table === 'content_reports' && op.kind === 'insert') {
        inserted = op.payload;
        return { data: { id: 'r', status: 'under_review' } };
      }
      return { data: null };
    });
    const { svc } = service(db);
    await svc.recordListingFlags(LISTING, SELLER, [{ pattern: 'new', reason: 'copyright', at: 't2' }]);
    const update = db.ops.find((o) => o.table === 'marketplace_listings' && o.kind === 'update');
    expect(update?.payload.moderation_flags.map((f: any) => f.pattern)).toEqual(['old', 'new']);
    expect(inserted).toMatchObject({ reporter_id: SELLER, target_type: 'listing', target_id: LISTING, reason: 'copyright', status: 'under_review' });
    expect(inserted.details).toMatch(/^auto-flag: new/);

    const dupDb = makeDb((op) => {
      if (op.table === 'marketplace_listings' && op.kind === 'select') return { data: { id: LISTING, title: 'x', status: 'active', user_id: SELLER, moderation_flags: [] } };
      if (op.table === 'content_reports' && op.kind === 'insert') return { error: { code: '23505', message: 'dup' } };
      return { data: null };
    });
    await expect(service(dupDb).svc.recordListingFlags(LISTING, SELLER, [{ pattern: 'p', reason: 'copyright', at: 't' }])).resolves.toBeUndefined();
  });

  it('stripListingModerationFields drops every owner/admin-only column', () => {
    const stripped = stripListingModerationFields({
      id: LISTING,
      title: 'x',
      rights_status: 'takedown',
      takedown_reason: 'why',
      takedown_at: 't',
      takedown_by: ADMIN,
      appeal_status: 'requested',
      appeal_note: 'n',
      appealed_at: 't',
      appeal_decided_at: null,
      appeal_decided_by: null,
      moderation_flags: [],
      rights_attested_at: null,
      rights_attestation_version: null,
    });
    expect(stripped).toEqual({ id: LISTING, title: 'x' });
  });
});

describe('rights + moderation migration', () => {
  const sql = readFileSync(
    join(__dirname, '../../../../supabase/migrations/20260822140000_rights_and_moderation.sql'),
    'utf8',
  );

  it('adds the listing rights/takedown/appeal columns, bank provenance and notes.removed_by_admin_at', () => {
    for (const col of ['rights_status', 'rights_attested_at', 'rights_attestation_version', 'moderation_flags', 'takedown_reason', 'takedown_at', 'takedown_by', 'appeal_status', 'appeal_note', 'appealed_at', 'appeal_decided_at', 'appeal_decided_by']) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`));
    }
    expect(sql).toMatch(/rights_status IN \('unattested','attested','under_review','takedown','cleared'\)/);
    expect(sql).toMatch(/appeal_status IN \('none','requested','upheld','reversed'\)/);
    for (const col of ['ai_assisted', 'sources_cited', 'originality_score']) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`));
    }
    expect(sql).toMatch(/ALTER TABLE public\.notes\s+ADD COLUMN IF NOT EXISTS removed_by_admin_at timestamptz/);
  });

  it('creates content_reports with the target/reason/status CHECKs, the dedupe UNIQUE and the backfills', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.content_reports/);
    expect(sql).toMatch(/'listing','question_bank','note','deck','user','group','message','dm_message','job_posting'/);
    expect(sql).toMatch(/'scam','spam','inappropriate','copyright','leaked_exam','plagiarism',\s*'harassment','prohibited_item','wrong_category','discriminatory','other'/);
    expect(sql).toMatch(/status IN \('pending','under_review','resolved','dismissed'\)/);
    expect(sql).toMatch(/UNIQUE \(reporter_id, target_type, target_id\)/);
    expect(sql).toMatch(/FROM public\.marketplace_reports r/);
    expect(sql).toMatch(/FROM public\.job_reports r/);
    expect((sql.match(/ON CONFLICT \(reporter_id, target_type, target_id\) DO NOTHING/g) ?? []).length).toBe(2);
  });

  it('creates moderation_strikes (severity 1-3, 180-day expiry) as service-role only, and RLS on reports', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.moderation_strikes/);
    expect(sql).toMatch(/severity BETWEEN 1 AND 3/);
    expect(sql).toMatch(/interval '180 days'/);
    expect(sql).toMatch(/REVOKE ALL ON public\.moderation_strikes FROM PUBLIC, anon, authenticated/);
    // Security hardening: content_reports is service-role only. Clients report
    // through the API (rate-limited, existence/dedupe checked); direct PostgREST
    // insert with arbitrary status/admin_note is not allowed, and the two
    // earlier authenticated policies are explicitly dropped.
    expect(sql).toMatch(/REVOKE ALL ON public\.content_reports FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT ALL ON public\.content_reports TO service_role/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS content_reports_insert_own ON public\.content_reports/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS content_reports_select_own ON public\.content_reports/);
    expect(sql).not.toMatch(/CREATE POLICY content_reports_insert_own/);
  });
});
