/**
 * POST /api/v1/reports (Phase 1 · E).
 *
 * Pins the body validation the clients rely on (target type, per-target
 * reason, uuid target, details cap), that the route is registered, and the
 * service-level dedupe: a second report of the same target by the same user
 * is a 409, not a 500 from the UNIQUE constraint.
 */
import { validationResult } from 'express-validator';
import router, { respondReportError, validateCreateReport } from './reports';
import { ModerationService } from '../services/moderation';

jest.mock('../services/adminAudit', () => ({
  logAdminAction: jest.fn(async () => undefined),
  invalidateBanCache: jest.fn(async () => undefined),
}));

const LISTING = '11111111-1111-4111-8111-111111111111';
const REPORTER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const POST = '44444444-4444-4444-8444-444444444444';

async function runValidators(body: Record<string, unknown>) {
  const req = { body } as any;
  for (const validator of validateCreateReport) {
    await validator.run(req);
  }
  return validationResult(req);
}

const failedParam = (result: ReturnType<typeof validationResult>, name: string) =>
  result.array().some((e) => 'path' in e && e.path === name);

describe('validateCreateReport', () => {
  it('accepts a well-formed listing report', async () => {
    const result = await runValidators({
      targetType: 'listing',
      targetId: LISTING,
      reason: 'leaked_exam',
      details: 'This is next week’s paper',
    });
    expect(result.isEmpty()).toBe(true);
  });

  it('rejects an unknown target type and a non-uuid target id', async () => {
    const bad = await runValidators({ targetType: 'comment', targetId: LISTING, reason: 'spam' });
    expect(failedParam(bad, 'targetType')).toBe(true);
    const badId = await runValidators({ targetType: 'listing', targetId: 'abc', reason: 'spam' });
    expect(failedParam(badId, 'targetId')).toBe(true);
  });

  it('rejects a reason the target does not offer (harassment on a listing, leaked_exam on a user)', async () => {
    const a = await runValidators({ targetType: 'listing', targetId: LISTING, reason: 'harassment' });
    expect(failedParam(a, 'reason')).toBe(true);
    const b = await runValidators({ targetType: 'user', targetId: LISTING, reason: 'leaked_exam' });
    expect(failedParam(b, 'reason')).toBe(true);
    const ok = await runValidators({ targetType: 'user', targetId: LISTING, reason: 'harassment' });
    expect(ok.isEmpty()).toBe(true);
  });

  it('caps details at 1000 characters', async () => {
    const result = await runValidators({
      targetType: 'note',
      targetId: LISTING,
      reason: 'copyright',
      details: 'x'.repeat(1001),
    });
    expect(failedParam(result, 'details')).toBe(true);
  });
});

describe('reports router', () => {
  it('registers POST /', () => {
    const posts = (router as any).stack
      .filter((layer: any) => layer.route?.methods?.post)
      .map((layer: any) => layer.route.path);
    expect(posts).toEqual(['/']);
  });
});

// Minimal chainable stub: every table query resolves through `resolve(op)`.
type Op = { table: string; kind: string; payload?: any; filters: Array<[string, string, unknown]> };
function makeDb(resolve: (op: Op) => { data?: unknown; error?: unknown; count?: number }) {
  const ops: Op[] = [];
  const from = (table: string) => {
    const op: Op = { table, kind: 'select', filters: [] };
    const chain: any = {};
    chain.select = () => chain;
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
      return Promise.resolve(resolve(op));
    };
    chain.maybeSingle = run;
    chain.single = run;
    chain.then = (onF: any, onR: any) => run().then(onF, onR);
    return chain;
  };
  return { from, ops };
}

function service(db: ReturnType<typeof makeDb>) {
  return new ModerationService({
    getClient: () => db,
    createNotification: jest.fn(async () => null),
  } as any);
}

describe('ModerationService.createReport', () => {
  it('answers 409 when the same user reports the same target twice', async () => {
    const db = makeDb((op) => {
      if (op.table === 'marketplace_listings') {
        return { data: { id: LISTING, title: 'Notes', status: 'active', user_id: 'seller' } };
      }
      if (op.table === 'content_reports' && op.kind === 'insert') {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      }
      return { data: null };
    });
    await expect(
      service(db).createReport({ reporterId: REPORTER, targetType: 'listing', targetId: LISTING, reason: 'spam' }),
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/already reported/i) });
  });

  it('writes content_reports with the validated shape and returns id + status', async () => {
    const db = makeDb((op) => {
      if (op.table === 'marketplace_listings') {
        return { data: { id: LISTING, title: 'Notes', status: 'active', user_id: 'seller' } };
      }
      if (op.table === 'content_reports' && op.kind === 'insert') {
        return { data: { id: 'r1', status: op.payload.status } };
      }
      return { data: null };
    });
    await expect(
      service(db).createReport({
        reporterId: REPORTER,
        targetType: 'listing',
        targetId: LISTING,
        reason: 'copyright',
        details: '  scanned textbook  ',
      }),
    ).resolves.toEqual({ id: 'r1', status: 'pending' });
    const insert = db.ops.find((o) => o.table === 'content_reports' && o.kind === 'insert');
    expect(insert?.payload).toEqual({
      reporter_id: REPORTER,
      target_type: 'listing',
      target_id: LISTING,
      reason: 'copyright',
      details: 'scanned textbook',
      status: 'pending',
    });
  });

  it('refuses a reason the target does not offer and a missing target (no insert)', async () => {
    const db = makeDb(() => ({ data: null }));
    await expect(
      service(db).createReport({ reporterId: REPORTER, targetType: 'listing', targetId: LISTING, reason: 'harassment' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service(db).createReport({ reporterId: REPORTER, targetType: 'note', targetId: LISTING, reason: 'copyright' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(db.ops.some((o) => o.kind === 'insert')).toBe(false);
  });

  it('refuses self-reports of a user profile', async () => {
    const db = makeDb((op) =>
      op.table === 'profiles' ? { data: { id: REPORTER, name: 'Me', username: 'me' } } : { data: null },
    );
    await expect(
      service(db).createReport({ reporterId: REPORTER, targetType: 'user', targetId: REPORTER, reason: 'spam' }),
    ).rejects.toMatchObject({ statusCode: 400, message: /yourself/ });
  });

  it('accepts the two community targets through the SAME queue', async () => {
    const db = makeDb((op) =>
      op.table === 'messages'
        ? { data: { id: POST, text: 'Timetable is out', subject: null, sender_id: OTHER, removed_at: null } }
        : { data: { id: 'r1', status: 'pending' } },
    );
    await expect(
      service(db).createReport({
        reporterId: REPORTER,
        targetType: 'community_post',
        targetId: POST,
        reason: 'leaked_exam',
      }),
    ).resolves.toMatchObject({ status: 'pending' });
    const insert = db.ops.find((o) => o.kind === 'insert');
    expect(insert?.table).toBe('content_reports');
    expect((insert?.payload as Record<string, unknown>).target_type).toBe('community_post');
  });

  it('refuses reporting your OWN board post', async () => {
    const db = makeDb((op) =>
      op.table === 'messages'
        ? { data: { id: POST, text: 'mine', subject: null, sender_id: REPORTER, removed_at: null } }
        : { data: null },
    );
    await expect(
      service(db).createReport({
        reporterId: REPORTER,
        targetType: 'community_post',
        targetId: POST,
        reason: 'spam',
      }),
    ).rejects.toMatchObject({ statusCode: 400, message: /yourself/ });
    expect(db.ops.some((o) => o.kind === 'insert')).toBe(false);
  });
});

describe('respondReportError', () => {
  it('maps the service PublicError(+statusCode) to that status and leaves other errors alone', () => {
    const res: any = { status: jest.fn(() => res), json: jest.fn(() => res) };
    const { moderationError } = jest.requireActual('../services/moderation');
    expect(respondReportError(res, moderationError('dup', 409))).toBe(true);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(respondReportError(res, new TypeError('boom'))).toBe(false);
  });
});
