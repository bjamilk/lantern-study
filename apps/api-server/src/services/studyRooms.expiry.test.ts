/**
 * Study-room auto-delete lifecycle (founder decision 2026-08-29: rooms are
 * temporary). Pins:
 *   - a room past STUDY_ROOM_MAX_AGE_MS reads CLOSED even while is_active is
 *     still true in the row (the sweep is best-effort, the read is the truth);
 *   - join refuses a closed room;
 *   - the sweep closes overdue rooms (and their roster rows) and hard-deletes
 *     long-closed ones, and is debounced so room traffic cannot stampede it.
 */
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { StudyRoomsService } from './studyRooms';
import { STUDY_ROOM_MAX_AGE_MS } from '@lantern/shared/network';

const USER = '11111111-1111-4111-8111-111111111111';
const ROOM = '66666666-6666-4666-8666-666666666666';

type StepResult = { data?: unknown; error?: unknown; count?: number | null };
type Step = { table: string; result: StepResult };

function makeDb(script: Step[]) {
  const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
  const db = {
    from(table: string) {
      const pop = (): StepResult => {
        const next = script.shift();
        if (!next) throw new Error(`script exhausted (query on ${table})`);
        if (next.table !== table) {
          throw new Error(`expected query on ${next.table}, got ${table}`);
        }
        return { data: null, error: null, ...next.result };
      };
      const chain: any = {};
      for (const m of ['select', 'eq', 'is', 'in', 'or', 'order', 'limit', 'lt', 'gt', 'neq']) {
        chain[m] = () => chain;
      }
      chain.insert = (payload: unknown) => {
        calls.push({ table, op: 'insert', payload });
        return chain;
      };
      chain.update = (payload: unknown) => {
        calls.push({ table, op: 'update', payload });
        return chain;
      };
      chain.delete = () => {
        calls.push({ table, op: 'delete' });
        return chain;
      };
      chain.maybeSingle = () => Promise.resolve(pop());
      chain.single = () => Promise.resolve(pop());
      chain.then = (resolve: any, reject: any) => Promise.resolve(pop()).then(resolve, reject);
      return chain;
    },
  };
  const service = new StudyRoomsService({ getClient: () => db } as never);
  return { service, calls, script };
}

/** The sweep runs as a detached async task — let its microtasks drain. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

const roomRow = (startedAt: string, isActive = true) => ({
  id: ROOM,
  title: 'Cardiology night',
  course_id: null,
  community_id: null,
  topic_id: null,
  topic: null,
  kind: 'room',
  created_by: USER,
  started_at: startedAt,
  is_active: isActive,
});

describe('room expiry', () => {
  it('a room past the max age reads closed even when is_active is stale', async () => {
    const { service } = makeDb([
      { table: 'study_sessions', result: { data: roomRow(hoursAgo(7), true) } },
      { table: 'study_session_participants', result: { data: [] } },
    ]);
    (service as any).lastSweepAt = Date.now(); // debounce the sweep out of the way
    const room = await service.get(USER, ROOM);
    expect(room.isActive).toBe(false);
  });

  it('a fresh room reads open', async () => {
    const { service } = makeDb([
      { table: 'study_sessions', result: { data: roomRow(hoursAgo(1), true) } },
      { table: 'study_session_participants', result: { data: [] } },
    ]);
    (service as any).lastSweepAt = Date.now();
    const room = await service.get(USER, ROOM);
    expect(room.isActive).toBe(true);
  });

  it('join refuses a closed room', async () => {
    const { service } = makeDb([
      { table: 'study_sessions', result: { data: roomRow(hoursAgo(7), true) } },
      { table: 'study_session_participants', result: { data: [] } },
    ]);
    (service as any).lastSweepAt = Date.now();
    await expect(service.join(USER, ROOM)).rejects.toThrow('This study room has closed');
  });

  it('uses the documented 6-hour lifetime', () => {
    expect(STUDY_ROOM_MAX_AGE_MS).toBe(6 * 60 * 60 * 1000);
  });
});

describe('sweepExpired', () => {
  it('closes overdue rooms, marks their roster left, and purges old closed rooms', async () => {
    const { service, calls, script } = makeDb([
      { table: 'study_sessions', result: { data: [{ id: ROOM }] } }, // close pass
      { table: 'study_session_participants', result: { data: null } }, // roster left_at
      { table: 'study_sessions', result: { data: null } }, // purge pass
    ]);
    (service as any).sweepExpired();
    await flush();

    expect(script).toHaveLength(0);
    const close = calls.find((c) => c.op === 'update' && c.table === 'study_sessions');
    expect(close?.payload).toMatchObject({ is_active: false });
    const roster = calls.find((c) => c.op === 'update' && c.table === 'study_session_participants');
    expect(roster?.payload).toMatchObject({ left_at: expect.any(String) });
    expect(calls.some((c) => c.op === 'delete' && c.table === 'study_sessions')).toBe(true);
  });

  it('skips the roster pass when nothing closed, and debounces back-to-back calls', async () => {
    const { service, calls } = makeDb([
      { table: 'study_sessions', result: { data: [] } },
      { table: 'study_sessions', result: { data: null } },
    ]);
    (service as any).sweepExpired();
    await flush();
    expect(calls.filter((c) => c.table === 'study_session_participants')).toHaveLength(0);

    const before = calls.length;
    (service as any).sweepExpired(); // inside the 10-minute debounce window
    await flush();
    expect(calls.length).toBe(before);
  });
});
