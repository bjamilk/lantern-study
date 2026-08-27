/**
 * Study presence (Phase 3 · M) — the privacy boundary.
 *
 * The invariant under test: a user who has switched off study activity or
 * online status is NEVER WRITTEN into study_presence. Not written-and-filtered
 * on read — not written at all. A filtered-on-read design leaks the moment any
 * future query forgets the filter, which is exactly the class of bug the
 * Phase 2 review found on profile_follows.
 */
import { StudyPresenceService, PRESENCE_TTL_MINUTES } from './studyPresence';

const USER = '11111111-1111-4111-8111-111111111111';
const COURSE = '33333333-3333-4333-8333-333333333333';

function makeService(
  settings: unknown,
  institutionId: string | null = null,
  presenceRows: unknown[] = [],
) {
  const ops: Array<{ table: string; op: string; payload?: unknown }> = [];
  const db: any = {
    from: (table: string) => {
      const api: any = {};
      const self = () => api;
      api.select = self;
      api.eq = self;
      api.gt = self;
      api.neq = self;
      api.limit = self;
      api.maybeSingle = () =>
        Promise.resolve({ data: { settings, institution_id: institutionId }, error: null });
      api.upsert = (payload: unknown) => {
        ops.push({ table, op: 'upsert', payload });
        return Promise.resolve({ error: null });
      };
      api.delete = () => {
        ops.push({ table, op: 'delete' });
        return api;
      };
      api.then = (resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) =>
        Promise.resolve({
          data: table === 'study_presence' ? presenceRows : [],
          error: null,
        }).then(resolve, reject);
      return api;
    },
  };
  const service = new StudyPresenceService({ getClient: () => db } as any);
  return { service, ops };
}

describe('StudyPresenceService.heartbeat', () => {
  it('writes presence when the user shares study activity', async () => {
    const { service, ops } = makeService({ privacy: {} });
    const result = await service.heartbeat(USER, { context: 'reviewing', courseId: COURSE });
    expect(result).toEqual({ shared: true });
    const write = ops.find((o) => o.op === 'upsert');
    expect(write?.payload).toMatchObject({
      user_id: USER,
      context: 'reviewing',
      course_id: COURSE,
    });
  });

  it('does NOT write when showStudyActivity is off, and clears any stale row', async () => {
    const { service, ops } = makeService({ privacy: { showStudyActivity: false } });
    const result = await service.heartbeat(USER, { courseId: COURSE });
    expect(result).toEqual({ shared: false });
    expect(ops.some((o) => o.op === 'upsert')).toBe(false);
    // The stale row matters: without the delete, a user who switches the
    // setting off keeps appearing in "studying now" until their row expires.
    expect(ops.some((o) => o.op === 'delete')).toBe(true);
  });

  it('does NOT write when showOnlineStatus is off', async () => {
    const { service, ops } = makeService({ privacy: { showOnlineStatus: false } });
    await expect(service.heartbeat(USER)).resolves.toEqual({ shared: false });
    expect(ops.some((o) => o.op === 'upsert')).toBe(false);
  });

  it('treats an absent setting as opted IN (product default), not opted out', async () => {
    const { service } = makeService({});
    await expect(service.heartbeat(USER)).resolves.toEqual({ shared: true });
  });

  it('falls back to a safe context and drops a non-uuid courseId', async () => {
    const { service, ops } = makeService({ privacy: {} });
    // 'null' is the STRING the mobile course filter uses for "unfiled" — it is
    // truthy and would 400 the insert if it reached the column.
    await service.heartbeat(USER, { context: 'hacking', courseId: 'null' });
    expect(ops.find((o) => o.op === 'upsert')?.payload).toMatchObject({
      context: 'studying',
      course_id: null,
    });
  });

  it('truncates an oversized topic rather than violating the column CHECK', async () => {
    const { service, ops } = makeService({ privacy: {} });
    await service.heartbeat(USER, { topic: 'x'.repeat(500) });
    const payload = ops.find((o) => o.op === 'upsert')?.payload as Record<string, string>;
    expect(payload.topic).toHaveLength(80);
  });

  it('stamps an expiry so a crashed client stops counting without a sweeper', async () => {
    const { service, ops } = makeService({ privacy: {} });
    const before = Date.now();
    await service.heartbeat(USER, { context: 'studying' });
    const payload = ops.find((o) => o.op === 'upsert')?.payload as Record<string, string>;
    const expiry = new Date(payload.expires_at).getTime();
    expect(expiry).toBeGreaterThanOrEqual(before + PRESENCE_TTL_MINUTES * 60_000 - 1000);
  });
});

describe('StudyPresenceService.now', () => {
  it('returns an empty snapshot when there is no course or institution scope', async () => {
    const { service } = makeService({ privacy: {} }, null);
    const snapshot = await service.now(USER);
    expect(snapshot).toEqual({
      total: 0,
      byContext: {},
      topics: [],
      sharing: true,
      joinCourseId: null,
      joinTopic: null,
    });
  });

  it('points Join room at the busiest course and topic', async () => {
    const otherCourse = '44444444-4444-4444-8444-444444444444';
    const { service } = makeService({ privacy: {} }, '55555555-5555-4555-8555-555555555555', [
      { user_id: 'a', context: 'studying', topic: 'cardiology', course_id: COURSE },
      { user_id: 'b', context: 'studying', topic: 'cardiology', course_id: COURSE },
      { user_id: 'c', context: 'reviewing', topic: 'anatomy', course_id: otherCourse },
    ]);
    const snapshot = await service.now(USER);
    expect(snapshot.total).toBe(3);
    expect(snapshot.joinCourseId).toBe(COURSE);
    expect(snapshot.joinTopic).toBe('cardiology');
  });
});
