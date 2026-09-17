/**
 * Query shapes AND responses for the two invite-preview handlers in
 * `routes/groups.ts` (lane R2, PR 2b).
 *
 * They held three inline chains — the only `.from()` calls left in a 2,000-line
 * route file that otherwise goes through `data/groups.ts` — and neither handler
 * had a suite. Lane R2 moves them into `services/data/groups.ts`.
 *
 * Written and committed against the UNTOUCHED routes.
 *
 * ## What these filters decide
 *
 * `eq("pending", false)` is the one that matters twice over. On the count it is
 * the difference between "8 members" and "8 members, three of whom asked to
 * join and were never let in" on a public invite page. On the membership read
 * the route keeps the pending flag and answers `alreadyMember: false,
 * pending: true`, which is what stops an invite offering "Open" to somebody
 * still waiting. Both are asserted literally.
 *
 * `select("user_id", { count: "exact", head: true })` is a COUNT, not a read:
 * `head: true` means no rows come back. Dropping it turns a member count into a
 * full roster fetch on an unauthenticated endpoint.
 */
jest.mock('../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  optionalAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import router, { initializeGroupRoutes } from './groups';
import { createQueryRecorder, runRouteHandler, type QueryResult, type ResolveResult } from '../testSupport/queryRecorder';

const GROUP = {
  id: 'group-1',
  name: 'Anatomy 201',
  description: 'Bones',
  avatarUrl: null,
  isArchived: false,
};

function initWith(resolve?: ResolveResult, groups: Record<string, unknown> = {}) {
  const rec = createQueryRecorder(resolve);
  initializeGroupRoutes(
    {
      getClient: () => rec.client,
      groups: { getGroupByInviteId: jest.fn(async () => GROUP), ...groups },
      users: {},
      notifications: {},
    } as any,
    { get: jest.fn(async () => null), set: jest.fn(async () => {}), delete: jest.fn(async () => {}) } as any,
  );
  return rec;
}

const counted = (n: number): QueryResult => ({ data: null, error: null, count: n });

describe('GET /invite/:inviteId/preview (unauthenticated)', () => {
  it('counts only ACCEPTED members, as a head count', async () => {
    const rec = initWith(counted(8));

    const res = await runRouteHandler(router, 'get', '/invite/:inviteId/preview', {
      params: { inviteId: 'inv-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: { name: 'Anatomy 201', memberCount: 8 } });

    expect(rec.trace).toEqual([
      'from("group_members")',
      'select("user_id", {"count":"exact","head":true})',
      'eq("group_id", "group-1")',
      'eq("pending", false)',
    ]);
  });

  it('reports zero rather than null when the count comes back empty', async () => {
    initWith({ data: null, error: null });

    const res = await runRouteHandler(router, 'get', '/invite/:inviteId/preview', {
      params: { inviteId: 'inv-1' },
    });

    expect(res.body.data.memberCount).toBe(0);
  });

  it('answers 404 and counts nothing for an archived or unknown invite', async () => {
    const rec = initWith(counted(3), { getGroupByInviteId: jest.fn(async () => ({ ...GROUP, isArchived: true })) });

    const res = await runRouteHandler(router, 'get', '/invite/:inviteId/preview', {
      params: { inviteId: 'inv-1' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Invalid or expired invite link' });
    expect(rec.tables()).toEqual([]);
  });
});

describe('GET /invite/:inviteId (authenticated)', () => {
  /** nth 0 = the head count, nth 1 = this caller's membership row. */
  const flow = (membership: unknown) => (_t: string, nth: number): QueryResult =>
    nth === 0 ? counted(8) : { data: membership, error: null };

  it('counts accepted members, then reads THIS caller membership row', async () => {
    const rec = initWith(flow({ user_id: 'user-1', pending: false }));

    const res = await runRouteHandler(router, 'get', '/invite/:inviteId', {
      params: { inviteId: 'inv-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        id: 'group-1',
        name: 'Anatomy 201',
        description: 'Bones',
        avatarUrl: null,
        memberCount: 8,
        alreadyMember: true,
        pending: false,
      },
    });

    expect(rec.trace).toEqual([
      'from("group_members")',
      'select("user_id", {"count":"exact","head":true})',
      'eq("group_id", "group-1")',
      'eq("pending", false)',
      'from("group_members")',
      'select("user_id, pending")',
      'eq("group_id", "group-1")',
      // The caller's own row, and only theirs.
      'eq("user_id", "user-1")',
      'maybeSingle()',
    ]);
  });

  it('reports a pending request as pending, NOT as membership', async () => {
    initWith(flow({ user_id: 'user-1', pending: true }));

    const res = await runRouteHandler(router, 'get', '/invite/:inviteId', {
      params: { inviteId: 'inv-1' },
    });

    expect(res.body.data).toMatchObject({ alreadyMember: false, pending: true });
  });

  it('reports a non-member as neither', async () => {
    initWith(flow(null));

    const res = await runRouteHandler(router, 'get', '/invite/:inviteId', {
      params: { inviteId: 'inv-1' },
    });

    expect(res.body.data).toMatchObject({ alreadyMember: false, pending: false });
  });

  it('answers 400 for an archived group, before either query', async () => {
    const rec = initWith(flow(null), {
      getGroupByInviteId: jest.fn(async () => ({ ...GROUP, isArchived: true })),
    });

    const res = await runRouteHandler(router, 'get', '/invite/:inviteId', {
      params: { inviteId: 'inv-1' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'This group has been archived' });
    expect(rec.tables()).toEqual([]);
  });

  it('answers 404 for an unknown invite, before either query', async () => {
    const rec = initWith(flow(null), { getGroupByInviteId: jest.fn(async () => null) });

    const res = await runRouteHandler(router, 'get', '/invite/:inviteId', {
      params: { inviteId: 'inv-1' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Invalid or expired invite link' });
    expect(rec.tables()).toEqual([]);
  });
});
