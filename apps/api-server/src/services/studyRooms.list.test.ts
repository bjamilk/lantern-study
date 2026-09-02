/**
 * Study-room list scoping (Phase 1 · §2.5).
 *
 * Inside a community the list narrows to that community's rooms — OR the
 * community's course's rooms, because course rooms started from the hub
 * carry only `course_id` and must still show under the course community
 * without a backfill. The filter has to hit BOTH queries the list runs (the
 * newest-N page and the "mine not on page" union), or a room the viewer is
 * in from another community leaks into this one's STUDY ROOMS section.
 */
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { StudyRoomsService } from './studyRooms';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const COMMUNITY = '33333333-3333-4333-8333-333333333333';
const COURSE = '55555555-5555-4555-8555-555555555555';
const PAGE_ROOM = '66666666-6666-4666-8666-666666666666';
const MINE_ROOM = '77777777-7777-4777-8777-777777777777';

type StepResult = { data?: unknown; error?: unknown };
type Step = { table: string; result: StepResult };
type Query = { table: string; filters: Array<[string, ...unknown[]]> };

/**
 * Chainable PostgREST double that records every filter call per query and
 * resolves each awaited chain from the script in order.
 */
function makeDb(script: Step[]) {
  const queries: Query[] = [];
  const db = {
    from(table: string) {
      const query: Query = { table, filters: [] };
      queries.push(query);
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
        chain[m] = (...args: unknown[]) => {
          query.filters.push([m, ...args]);
          return chain;
        };
      }
      chain.then = (resolve: any, reject: any) => Promise.resolve(pop()).then(resolve, reject);
      return chain;
    },
  };
  const service = new StudyRoomsService({ getClient: () => db } as never);
  (service as any).lastSweepAt = Date.now(); // keep the sweep out of the script
  return { service, queries };
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const roomRow = (id: string, extra: Partial<Record<string, unknown>> = {}) => ({
  id,
  title: 'Cardiology night',
  course_id: null,
  community_id: COMMUNITY,
  topic_id: null,
  topic: null,
  kind: 'room',
  created_by: OTHER,
  started_at: minutesAgo(30),
  is_active: true,
  ...extra,
});

/** A script where the viewer is in a room that is NOT on the newest page, so the union query runs. */
const twoQueryScript = (): Step[] => [
  { table: 'study_session_participants', result: { data: [{ session_id: MINE_ROOM }] } },
  { table: 'study_sessions', result: { data: [roomRow(PAGE_ROOM)] } },
  { table: 'study_sessions', result: { data: [roomRow(MINE_ROOM, { started_at: minutesAgo(90) })] } },
  {
    table: 'study_session_participants',
    result: {
      data: [
        { session_id: PAGE_ROOM, user_id: OTHER },
        { session_id: MINE_ROOM, user_id: USER },
      ],
    },
  },
];

const sessionQueries = (queries: Query[]) => queries.filter((q) => q.table === 'study_sessions');
const scopeFilters = (q: Query) =>
  q.filters.filter(([m, col]) => m === 'or' || (m === 'eq' && (col === 'community_id' || col === 'course_id')));

describe('StudyRoomsService.list scoping', () => {
  it('communityId + courseId → OR filter on BOTH the page and the union query', async () => {
    const { service, queries } = makeDb(twoQueryScript());
    const rooms = await service.list(USER, { communityId: COMMUNITY, courseId: COURSE });

    const sessions = sessionQueries(queries);
    expect(sessions).toHaveLength(2);
    for (const q of sessions) {
      expect(scopeFilters(q)).toEqual([['or', `community_id.eq.${COMMUNITY},course_id.eq.${COURSE}`]]);
    }
    // Yours first, then newest — unchanged by the scope.
    expect(rooms.map((r) => r.id)).toEqual([MINE_ROOM, PAGE_ROOM]);
    expect(rooms[0].joined).toBe(true);
  });

  it('communityId only → eq community_id on both queries', async () => {
    const { service, queries } = makeDb(twoQueryScript());
    await service.list(USER, { communityId: COMMUNITY });
    const sessions = sessionQueries(queries);
    expect(sessions).toHaveLength(2);
    for (const q of sessions) {
      expect(scopeFilters(q)).toEqual([['eq', 'community_id', COMMUNITY]]);
    }
  });

  it('courseId only → eq course_id on both queries', async () => {
    const { service, queries } = makeDb(twoQueryScript());
    await service.list(USER, { courseId: COURSE });
    const sessions = sessionQueries(queries);
    expect(sessions).toHaveLength(2);
    for (const q of sessions) {
      expect(scopeFilters(q)).toEqual([['eq', 'course_id', COURSE]]);
    }
  });

  it('no scope (the hub Room tab) → no community/course filter at all; list() stays valid', async () => {
    const { service, queries } = makeDb(twoQueryScript());
    await service.list(USER);
    const sessions = sessionQueries(queries);
    expect(sessions).toHaveLength(2);
    for (const q of sessions) expect(scopeFilters(q)).toEqual([]);
  });

  it('ignores non-uuid scope values instead of building a broken filter', async () => {
    const { service, queries } = makeDb(twoQueryScript());
    await service.list(USER, { communityId: 'not-a-uuid', courseId: '' });
    for (const q of sessionQueries(queries)) expect(scopeFilters(q)).toEqual([]);
  });
});
