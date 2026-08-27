/**
 * Study room hangout: join-or-create mints one private group, reuse keeps it,
 * and join upserts group_members.pending = false.
 */
jest.mock('./cache', () => ({
  cacheService: {
    delete: jest.fn().mockResolvedValue(undefined),
    deletePattern: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { StudyRoomsService } from './studyRooms';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const COURSE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROOM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GROUP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

type Result = { data: unknown; error?: unknown; count?: number };
type Call = {
  table: string;
  op: 'select' | 'insert' | 'upsert' | 'update' | 'delete';
  payload?: unknown;
  filters: unknown[][];
};
type Responder = Result | Result[] | ((call: Call, index: number) => Result);

function makeDb(tables: Record<string, Responder>) {
  const calls: Call[] = [];
  const perTable = new Map<string, number>();
  const queues = new Map<string, Result[]>();

  const resolve = (call: Call): Result => {
    const index = perTable.get(call.table) ?? 0;
    perTable.set(call.table, index + 1);
    const configured = tables[call.table];
    if (configured === undefined) return { data: null, error: null };
    if (typeof configured === 'function') return configured(call, index);
    if (!Array.isArray(configured)) return configured;
    if (!queues.has(call.table)) queues.set(call.table, [...configured]);
    const queue = queues.get(call.table)!;
    return queue.length > 1 ? queue.shift()! : queue[0];
  };

  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] };
    calls.push(call);
    const api: any = {};
    for (const m of ['eq', 'is', 'in', 'not', 'ilike', 'or', 'order', 'limit', 'gte', 'lte', 'head']) {
      api[m] = (...args: unknown[]) => {
        call.filters.push([m, ...args]);
        return api;
      };
    }
    api.select = () => api;
    api.insert = (payload: unknown) => {
      call.op = 'insert';
      call.payload = payload;
      return api;
    };
    api.upsert = (payload: unknown) => {
      call.op = 'upsert';
      call.payload = payload;
      return api;
    };
    api.update = (payload: unknown) => {
      call.op = 'update';
      call.payload = payload;
      return api;
    };
    api.delete = () => {
      call.op = 'delete';
      return api;
    };
    api.single = async () => resolve(call);
    api.maybeSingle = async () => resolve(call);
    api.then = (onFulfilled: (v: Result) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolve(call)).then(onFulfilled, onRejected);
    return api;
  };

  return {
    from,
    calls,
    service: new StudyRoomsService({ getClient: () => ({ from }) } as never),
  };
}

const session = (extra: Record<string, unknown> = {}) => ({
  id: ROOM,
  title: 'Studying cardiology',
  course_id: COURSE,
  community_id: null,
  topic_id: null,
  topic: 'cardiology',
  kind: 'room',
  created_by: USER,
  started_at: new Date().toISOString(),
  is_active: true,
  group_id: null,
  ...extra,
});

const roster = [
  {
    user_id: USER,
    joined_at: new Date().toISOString(),
    profiles: { name: 'Ada', avatar_url: null },
  },
];

describe('StudyRoomsService hangout group', () => {
  it('joinOrCreate mints a private group, stores group_id, and joins pending=false', async () => {
    let linked: string | null = null;
    const { service, calls } = makeDb({
      study_sessions: (call) => {
        const isList = call.filters.some((f) => f[0] === 'limit');
        if (call.op === 'insert') return { data: session() };
        if (call.op === 'update') {
          linked = (call.payload as { group_id?: string }).group_id ?? null;
          return { data: { group_id: GROUP } };
        }
        if (isList) return { data: [] };
        return { data: session({ group_id: linked }) };
      },
      study_session_participants: (call) => {
        if (call.op === 'insert') return { data: { user_id: USER } };
        const isList = call.filters.some((f) => f[0] === 'limit');
        if (isList) return { data: roster };
        return { data: null };
      },
      groups: (call) => {
        if (call.op === 'insert') return { data: { id: GROUP } };
        return { data: { id: GROUP } };
      },
      group_members: { data: null, error: null },
    });

    const room = await service.joinOrCreate(USER, { courseId: COURSE, topic: 'cardiology' });
    expect(room.id).toBe(ROOM);
    expect(room.joined).toBe(true);
    expect(room.groupId).toBe(GROUP);

    const created = calls.find((c) => c.table === 'groups' && c.op === 'insert');
    expect(created).toBeTruthy();
    expect((created?.payload as { name?: string }).name).toBe('Studying cardiology');
    expect((created?.payload as { visibility?: string }).visibility).toBe('private');
    expect((created?.payload as { course_id?: string }).course_id).toBe(COURSE);

    const link = calls.find((c) => c.table === 'study_sessions' && c.op === 'update');
    expect((link?.payload as { group_id?: string }).group_id).toBe(GROUP);

    const member = calls.find((c) => c.table === 'group_members' && c.op === 'upsert');
    expect(member?.payload).toEqual({ group_id: GROUP, user_id: USER, pending: false });
  });

  it('reusing an active room keeps the same group_id and does not insert another group', async () => {
    const existing = session({ group_id: GROUP, started_at: new Date().toISOString() });
    const { service, calls } = makeDb({
      study_sessions: (call) => {
        const isList = call.filters.some((f) => f[0] === 'limit');
        if (isList) {
          return { data: [{ id: ROOM, started_at: existing.started_at, topic: 'cardiology' }] };
        }
        return { data: existing };
      },
      study_session_participants: (call) => {
        const isList = call.filters.some((f) => f[0] === 'limit');
        if (isList) return { data: roster };
        return { data: { user_id: USER, left_at: null } };
      },
      groups: { data: { id: GROUP } },
      group_members: { data: null, error: null },
    });

    const room = await service.joinOrCreate(USER, { courseId: COURSE, topic: 'cardiology' });
    expect(room.groupId).toBe(GROUP);
    expect(calls.some((c) => c.table === 'groups' && c.op === 'insert')).toBe(false);
    expect(calls.some((c) => c.table === 'study_sessions' && c.op === 'insert')).toBe(false);
  });

  it('join adds group_members with pending false', async () => {
    const existing = session({ group_id: GROUP });
    const two = [
      ...roster,
      {
        user_id: OTHER,
        joined_at: new Date().toISOString(),
        profiles: { name: 'Bisi', avatar_url: null },
      },
    ];
    let joined = false;
    const { service, calls } = makeDb({
      study_sessions: { data: existing },
      study_session_participants: (call) => {
        if (call.op === 'insert') {
          joined = true;
          return { data: { user_id: OTHER } };
        }
        const isList = call.filters.some((f) => f[0] === 'limit');
        if (isList) return { data: joined ? two : roster };
        return { data: null };
      },
      group_members: { data: null, error: null },
    });

    const room = await service.join(OTHER, ROOM);
    expect(room.joined).toBe(true);
    expect(room.groupId).toBe(GROUP);
    const member = calls.find((c) => c.table === 'group_members' && c.op === 'upsert');
    expect(member?.payload).toEqual({ group_id: GROUP, user_id: OTHER, pending: false });
  });

  it('hides groupId from a viewer who has not joined the room', async () => {
    const { service } = makeDb({
      study_sessions: { data: session({ group_id: GROUP }) },
      study_session_participants: {
        data: roster,
      },
    });
    const room = await service.get(OTHER, ROOM);
    expect(room.joined).toBe(false);
    expect(room.groupId).toBeNull();
  });
});
