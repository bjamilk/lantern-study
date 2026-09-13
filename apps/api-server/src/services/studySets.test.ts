import {
  SET_TILE_MIGRATION,
  SetTileColumnMissingError,
  StudySetsService,
} from './studySets';
import { SET_TILE_UNSUPPORTED_MESSAGE } from '@lantern/shared/study/setTileSave';
import { PublicError } from '../utils/safeError';

const SAMPLE = {
  id: '11111111-1111-1111-1111-111111111111',
  user_id: 'u1',
  title: 'Midterm review',
  course_id: null,
  created_at: '2026-09-11T00:00:00.000Z',
  updated_at: '2026-09-11T00:00:00.000Z',
};

/**
 * A db whose write leg can answer 42703 for `exam_date` (the hand-applied
 * 20260911140000 migration) and whose reads echo the columns asked for.
 */
function makeExamDb(options: { examColumn: boolean }) {
  const calls: Array<{ op: string; columns?: string; payload?: unknown }> = [];
  const row = () => ({
    ...SAMPLE,
    ...(options.examColumn ? { exam_date: '2026-10-09' } : {}),
  });
  const from = () => {
    const api: Record<string, any> = {};
    let columns = '';
    let payload: unknown;
    api.select = (cols: string) => {
      columns = cols;
      return api;
    };
    api.eq = () => api;
    api.update = (next: unknown) => {
      payload = next;
      return api;
    };
    api.order = async () => ({ data: [row()], error: null });
    api.single = async () => {
      const wantsExam = columns.includes('exam_date');
      calls.push({ op: 'single', columns, payload });
      if (wantsExam && !options.examColumn) {
        return { data: null, error: { code: '42703', message: 'column study_sets.exam_date does not exist' } };
      }
      return { data: row(), error: null };
    };
    return api;
  };
  return { calls, supabase: { from } };
}

function makeDb() {
  const calls: Array<{ op: string; payload?: unknown }> = [];
  const from = () => {
    const api: Record<string, any> = {};
    api.select = () => api;
    api.eq = () => api;
    api.order = async () => ({ data: [], error: null });
    api.insert = (payload: unknown) => {
      calls.push({ op: 'insert', payload });
      return api;
    };
    api.single = async () => ({ data: SAMPLE, error: null });
    return api;
  };
  return { calls, supabase: { from } };
}

describe('StudySetsService', () => {
  it('creates a set without a course', async () => {
    const db = makeDb();
    const svc = new StudySetsService({ getClient: () => db.supabase } as never);
    const created = await svc.create('u1', { title: '  Midterm   review ' });
    expect(created.title).toBe('Midterm review');
    expect(created.courseId).toBeNull();
    expect(db.calls[0]?.payload).toMatchObject({ user_id: 'u1', title: 'Midterm review', course_id: null });
  });

  it('rejects an empty title', async () => {
    const db = makeDb();
    const svc = new StudySetsService({ getClient: () => db.supabase } as never);
    await expect(svc.create('u1', { title: '   ' })).rejects.toBeInstanceOf(PublicError);
  });

  it('round-trips examDate through the mapper', async () => {
    const db = makeExamDb({ examColumn: true });
    const svc = new StudySetsService({ getClient: () => db.supabase } as never);
    const updated = await svc.update('u1', SAMPLE.id, { examDate: '2026-10-09' });
    expect(updated.examDate).toBe('2026-10-09');
    expect(updated.examDateUnsupported).toBeUndefined();
    expect(db.calls.some((call) => (call.payload as any)?.exam_date === '2026-10-09')).toBe(true);
  });

  it('rejects a badly formatted examDate', async () => {
    const db = makeExamDb({ examColumn: true });
    const svc = new StudySetsService({ getClient: () => db.supabase } as never);
    await expect(svc.update('u1', SAMPLE.id, { examDate: '09/10/2026' })).rejects.toBeInstanceOf(PublicError);
  });

  it('degrades to examDateUnsupported instead of throwing when the column is absent', async () => {
    const db = makeExamDb({ examColumn: false });
    const svc = new StudySetsService({ getClient: () => db.supabase } as never);
    const updated = await svc.update('u1', SAMPLE.id, { title: 'Renamed', examDate: '2026-10-09' });
    expect(updated.examDateUnsupported).toBe(true);
    expect(updated.examDate).toBeNull();
    expect(updated.title).toBe('Midterm review');
  });
});

/**
 * A db whose `tile_hue` column may be absent (20260913150000 is hand-applied
 * like the other two), echoing back whichever projection succeeded.
 */
function makeTileDb(options: { tileColumns: boolean }) {
  const calls: Array<{ op: string; columns?: string; payload?: unknown }> = [];
  const row = () => ({
    ...SAMPLE,
    ...(options.tileColumns ? { tile_hue: 'peach', tile_glyph: 'monitor' } : {}),
  });
  const from = () => {
    const api: Record<string, any> = {};
    let columns = '';
    let payload: unknown;
    api.select = (cols: string) => {
      columns = cols;
      return api;
    };
    api.eq = () => api;
    api.update = (next: unknown) => {
      payload = next;
      return api;
    };
    const answer = async (op: string) => {
      calls.push({ op, columns, payload });
      if (columns.includes('tile_hue') && !options.tileColumns) {
        return {
          data: null,
          error: { code: '42703', message: 'column study_sets.tile_hue does not exist' },
        };
      }
      return { data: row(), error: null };
    };
    api.order = async () => {
      const result = await answer('order');
      return { data: result.data ? [result.data] : null, error: result.error };
    };
    api.single = () => answer('single');
    return api;
  };
  return { calls, supabase: { from } };
}

describe('study set tile art', () => {
  it('round-trips a tile pick through the mapper', async () => {
    const db = makeTileDb({ tileColumns: true });
    const svc = new StudySetsService({ getClient: () => db.supabase } as never);
    const updated = await svc.update('u1', SAMPLE.id, { tileHue: 'peach', tileGlyph: 'monitor' });
    expect(updated.tileHue).toBe('peach');
    expect(updated.tileGlyph).toBe('monitor');
    expect(
      db.calls.some(
        (call) =>
          (call.payload as any)?.tile_hue === 'peach' &&
          (call.payload as any)?.tile_glyph === 'monitor'
      )
    ).toBe(true);
  });

  it('writes null for a reset rather than freezing the derived art into the row', async () => {
    const db = makeTileDb({ tileColumns: true });
    const svc = new StudySetsService({ getClient: () => db.supabase } as never);
    await svc.update('u1', SAMPLE.id, { tileHue: null, tileGlyph: null });
    const write = db.calls.find((call) => (call.payload as any)?.tile_hue !== undefined);
    expect((write?.payload as any)?.tile_hue).toBeNull();
    expect((write?.payload as any)?.tile_glyph).toBeNull();
  });

  it('refuses a hue outside the six', async () => {
    const db = makeTileDb({ tileColumns: true });
    const svc = new StudySetsService({ getClient: () => db.supabase } as never);
    await expect(svc.update('u1', SAMPLE.id, { tileHue: 'chartreuse' })).rejects.toBeInstanceOf(
      PublicError
    );
    await expect(svc.update('u1', SAMPLE.id, { tileGlyph: 'rocket' })).rejects.toBeInstanceOf(
      PublicError
    );
  });

  it('reads a set as null-tiled instead of 500-ing when the migration is unapplied', async () => {
    // The whole point of the ladder: an unapplied migration must degrade to
    // the derived art, never to a failed set list.
    const db = makeTileDb({ tileColumns: false });
    const svc = new StudySetsService({ getClient: () => db.supabase } as never);
    const sets = await svc.list('u1');
    expect(sets[0]?.tileHue).toBeNull();
    expect(sets[0]?.tileGlyph).toBeNull();
    // It asked for the tile columns first and only then stepped down.
    expect(db.calls[0]?.columns).toContain('tile_hue');
    expect(db.calls.some((call) => !String(call.columns).includes('tile_hue'))).toBe(true);
  });

  it('refuses a tile write the projection cannot name, rather than 200-ing over it', async () => {
    // The device-pass defect, pinned. This used to walk down to a rung with no
    // tile columns, write the rest of the patch and answer a cheerful 200 —
    // the client showed `Study set updated.` and the pick was gone on the next
    // open. The read ladder still degrades (the test above); the WRITE says so.
    const db = makeTileDb({ tileColumns: false });
    const svc = new StudySetsService({ getClient: () => db.supabase } as never);
    await expect(
      svc.update('u1', SAMPLE.id, { title: 'Renamed', tileHue: 'lilac' })
    ).rejects.toBeInstanceOf(SetTileColumnMissingError);
    // It still asked for the tile columns first, and the body it finally sent
    // could not name them — which is exactly why the answer is not a success.
    const landed = db.calls.filter((call) => call.payload !== undefined).pop();
    expect((landed?.payload as any)?.tile_hue).toBeUndefined();
  });

  it('names the sentence and the migration a student and an operator each need', async () => {
    const db = makeTileDb({ tileColumns: false });
    const svc = new StudySetsService({ getClient: () => db.supabase } as never);
    const err = await svc.update('u1', SAMPLE.id, { tileGlyph: 'monitor' }).catch((e) => e);
    expect(err).toBeInstanceOf(SetTileColumnMissingError);
    expect(err.message).toBe(SET_TILE_UNSUPPORTED_MESSAGE);
    expect(err.migration).toBe(SET_TILE_MIGRATION);
  });

  it('leaves a patch that names no tile alone when the column is missing', async () => {
    // A rename must still work on a pre-migration database: the 503 is for a
    // student who CHOSE a tile, not for everyone who opened the settings form.
    const db = makeTileDb({ tileColumns: false });
    const svc = new StudySetsService({ getClient: () => db.supabase } as never);
    const updated = await svc.update('u1', SAMPLE.id, { title: 'Renamed' });
    expect(updated.tileHue).toBeNull();
  });

  it('saves normally once the migration is applied', async () => {
    const db = makeTileDb({ tileColumns: true });
    const svc = new StudySetsService({ getClient: () => db.supabase } as never);
    const updated = await svc.update('u1', SAMPLE.id, { tileHue: 'peach', tileGlyph: 'monitor' });
    expect(updated.tileHue).toBe('peach');
    expect(updated.tileGlyph).toBe('monitor');
  });
});
