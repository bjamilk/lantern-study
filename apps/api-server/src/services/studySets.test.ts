import { StudySetsService } from './studySets';
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
