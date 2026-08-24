/**
 * Reorder is the one outline mutation that writes many rows, and it writes them
 * concurrently. supabase-js RESOLVES on a Postgres error, so the failure mode
 * worth locking is a HALF-APPLIED reorder reported to the student as a success.
 */
import { CourseTopicsService } from './courseTopics';

const COURSE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
const T2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';
const T3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccc03';

type UpdateOutcome = { error: unknown } | { error: null };

/** Minimal supabase double: `updates` decides what each concurrent write returns. */
function makeService(updates: UpdateOutcome[]) {
  const seen: Array<{ id?: string; position?: number; courseId?: string }> = [];
  let updateIndex = 0;

  const client = {
    from() {
      const call: { op: 'select' | 'update'; payload?: any; filters: Record<string, unknown> } = {
        op: 'select',
        filters: {},
      };
      const api: any = {};
      api.select = () => api;
      api.update = (payload: any) => {
        call.op = 'update';
        call.payload = payload;
        return api;
      };
      api.eq = (column: string, value: unknown) => {
        call.filters[column] = value;
        return api;
      };
      api.order = () => api;
      api.limit = () =>
        Promise.resolve({
          data: [
            { id: T1, course_id: COURSE, title: 'Gas exchange', position: 10 },
            { id: T2, course_id: COURSE, title: 'Renal clearance', position: 20 },
            { id: T3, course_id: COURSE, title: 'Acid-base', position: 30 },
          ],
          error: null,
        });
      api.then = (onOk: any, onErr?: any) => {
        if (call.op === 'update') {
          seen.push({
            id: call.filters.id as string,
            position: call.payload?.position,
            courseId: call.filters.course_id as string,
          });
          const outcome = updates[updateIndex++] ?? { error: null };
          return Promise.resolve(outcome).then(onOk, onErr);
        }
        return Promise.resolve({ data: null, error: null }).then(onOk, onErr);
      };
      return api;
    },
  };

  const supabaseService = { getClient: () => client } as any;
  return { service: new CourseTopicsService(supabaseService), seen };
}

describe('CourseTopicsService.reorder', () => {
  it('scopes every write to the course so a guessed id cannot reposition another syllabus', async () => {
    const { service, seen } = makeService([{ error: null }, { error: null }, { error: null }]);

    await service.reorder(COURSE, [T3, T1, T2]);

    expect(seen).toHaveLength(3);
    expect(seen.every((w) => w.courseId === COURSE)).toBe(true);
    // Sparse positions rewritten from the given order.
    expect(seen.map((w) => w.position)).toEqual([10, 20, 30]);
    expect(seen.map((w) => w.id)).toEqual([T3, T1, T2]);
  });

  it('throws when any single write fails, rather than reporting a half-applied reorder as success', async () => {
    // The middle write is refused. Without an { error } check the caller is told
    // the shared outline was rearranged when one topic kept its old position —
    // and nothing constrains (course_id, position) to be unique, so two topics
    // then share a slot and the tiebreak picks between them arbitrarily.
    const { service } = makeService([
      { error: null },
      { error: { code: '57014', message: 'canceling statement due to statement timeout' } },
      { error: null },
    ]);

    await expect(service.reorder(COURSE, [T1, T2, T3])).rejects.toMatchObject({ code: '57014' });
  });

  it('refuses an empty order rather than silently doing nothing', async () => {
    const { service } = makeService([]);
    await expect(service.reorder(COURSE, [])).rejects.toThrow('No topics to reorder');
  });
});
