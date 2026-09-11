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
});
