/**
 * Study rooms: community access guard (hotfix H3, finding 7).
 *
 * `list`, `get`, `join` and `joinOrCreate` used to trust the ids the caller
 * sent. Any signed-in user could pass a stranger community's id and read its
 * rooms and rosters, or pass a room id and take a seat in it. Membership is
 * now resolved through communityModeration.resolveActor before any scoping,
 * and a community that is not 'public' requires it.
 */
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const resolveActor = jest.fn();
jest.mock('./communityModeration', () => ({
  getCommunityModerationService: () => ({ resolveActor }),
}));

import { StudyRoomsService } from './studyRooms';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const COMMUNITY = '33333333-3333-4333-8333-333333333333';
const ROOM = '66666666-6666-4666-8666-666666666666';

type StepResult = { data?: unknown; error?: unknown };
type Step = { table: string; result: StepResult };

function makeService(script: Step[]) {
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
      chain.maybeSingle = () => Promise.resolve(pop());
      chain.single = () => Promise.resolve(pop());
      chain.then = (resolve: any, reject: any) => Promise.resolve(pop()).then(resolve, reject);
      return chain;
    },
  };
  const service = new StudyRoomsService({ getClient: () => db } as never);
  (service as any).lastSweepAt = Date.now();
  return service;
}

const member = (isMember: boolean, isPlatformAdmin = false) => ({
  userId: USER,
  communityId: COMMUNITY,
  isMember,
  role: isMember ? 'member' : null,
  isPlatformAdmin,
  mutedUntil: null,
  createdBy: null,
});

const roomRow = {
  id: ROOM,
  title: 'Cardiology night',
  course_id: null,
  community_id: COMMUNITY,
  topic_id: null,
  topic: null,
  kind: 'room',
  created_by: OTHER,
  started_at: new Date(Date.now() - 30 * 60_000).toISOString(),
  is_active: true,
};

beforeEach(() => {
  resolveActor.mockReset();
});

describe('study room community access', () => {
  it('refuses list for a non-member of a non-public community', async () => {
    resolveActor.mockResolvedValue(member(false));
    const service = makeService([{ table: 'communities', result: { data: { visibility: 'community' } } }]);

    await expect(service.list(USER, { communityId: COMMUNITY })).rejects.toThrow(
      /Join this community/
    );
    expect(resolveActor).toHaveBeenCalledWith(USER, COMMUNITY);
  });

  it('allows a non-member when the community is public', async () => {
    resolveActor.mockResolvedValue(member(false));
    const service = makeService([
      { table: 'communities', result: { data: { visibility: 'public' } } },
      { table: 'study_session_participants', result: { data: [] } },
      { table: 'study_sessions', result: { data: [] } },
    ]);

    await expect(service.list(USER, { communityId: COMMUNITY })).resolves.toEqual([]);
  });

  it('refuses get on a community room for an outsider who is not in the room', async () => {
    resolveActor.mockResolvedValue(member(false));
    const service = makeService([
      { table: 'study_sessions', result: { data: roomRow } },
      { table: 'study_session_participants', result: { data: [{ user_id: OTHER, joined_at: null, left_at: null }] } },
      { table: 'communities', result: { data: { visibility: 'community' } } },
    ]);

    await expect(service.get(USER, ROOM)).rejects.toThrow(/Join this community/);
  });

  it('keeps the seat of someone already in the room even if they left the community', async () => {
    resolveActor.mockResolvedValue(member(false));
    const service = makeService([
      { table: 'study_sessions', result: { data: roomRow } },
      { table: 'study_session_participants', result: { data: [{ user_id: USER, joined_at: null, left_at: null }] } },
    ]);

    const room = await service.get(USER, ROOM);
    expect(room.joined).toBe(true);
    // The guard never ran: no `communities` query was scripted, and the
    // strict double would have thrown had one been issued.
    expect(resolveActor).not.toHaveBeenCalled();
  });

  it('lets a platform admin through without membership', async () => {
    resolveActor.mockResolvedValue(member(false, true));
    const service = makeService([
      { table: 'study_session_participants', result: { data: [] } },
      { table: 'study_sessions', result: { data: [] } },
    ]);

    await expect(service.list(USER, { communityId: COMMUNITY })).resolves.toEqual([]);
  });
});
