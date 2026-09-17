/**
 * POST /groups/:groupId/members/batch had two F10 defects.
 *
 * It caught every failure, marked all ids failed and still answered 200
 * `{ success: true, message: "0 invite(s) sent" }` — so a Supabase outage and
 * "nobody needed inviting" were the same response, and no client could tell it
 * had to retry. And `userIds[*]` was never UUID-validated: only the array shape
 * and its length were checked, so arbitrary strings went straight to the
 * service and the `.in()` filter behind it.
 */
jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: '11111111-1111-4111-8111-111111111111', permissions: [], credentialType: 'jwt' };
    next();
  },
  optionalAuthMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: '11111111-1111-4111-8111-111111111111', permissions: [], credentialType: 'jwt' };
    next();
  },
}));
jest.mock('../services/cache', () => ({
  CacheService: class {},
  cacheService: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    deletePattern: jest.fn(async () => undefined),
  },
}));
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../services/communities', () => ({
  getCommunitiesService: () => ({ isActiveMember: jest.fn(async () => true) }),
}));
jest.mock('../services/schemaCapabilities', () => ({
  hasGroupCommunitySurface: jest.fn(async () => true),
}));

import express from 'express';
import http from 'http';
import { errorHandler } from '../middleware/errorHandler';

const USER = '11111111-1111-4111-8111-111111111111';
const GROUP = '44444444-4444-4444-8444-444444444444';
const MEMBER_A = '55555555-5555-4555-8555-555555555555';
const MEMBER_B = '66666666-6666-4666-8666-666666666666';

const addGroupMembersBatch = jest.fn();
const getGroupById = jest.fn();

describe('POST /groups/:groupId/members/batch', () => {
  let server: http.Server;
  let base: string;

  async function call(body: unknown) {
    const res = await fetch(`${base}/api/v1/groups/${GROUP}/members/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  }

  beforeAll(async () => {
    const mod = require('./groups');
    mod.initializeGroupRoutes(
      {
        // The route family is injected with the DATA LAYER now, not the
        // `SupabaseService` facade: the same stubs, regrouped under the domain
        // namespace that owns each one (`docs/data-layer-wiring.md`).
        groups: { getGroupById, addGroupMembersBatch },
        users: {
          getUserById: jest.fn(async () => ({ id: USER, name: 'Ada', username: 'ada' })),
        },
        notifications: { createNotification: jest.fn(async () => undefined) },
        getClient: () => ({}),
        legacyService: {},
      } as any,
      {
        get: async () => null,
        set: async () => undefined,
        delete: async () => undefined,
        deletePattern: async () => undefined,
      } as any,
    );
    const app = express();
    app.use(express.json());
    app.use('/api/v1/groups', mod.default);
    app.use(errorHandler);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        base = `http://127.0.0.1:${(server.address() as any).port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    addGroupMembersBatch.mockReset();
    getGroupById.mockReset().mockResolvedValue({
      id: GROUP,
      name: 'Exam week',
      adminIds: [USER],
      permissions: {},
      visibility: 'private',
    });
  });

  it('invites a valid batch', async () => {
    addGroupMembersBatch.mockResolvedValue({
      invited: [MEMBER_A, MEMBER_B],
      alreadyMembers: [],
      alreadyPending: [],
    });
    const res = await call({ userIds: [MEMBER_A, MEMBER_B] });
    expect(res.status).toBe(200);
    expect(res.json.data.invited).toEqual([MEMBER_A, MEMBER_B]);
    // Back-compat field older clients still read.
    expect(res.json.data.added).toEqual([MEMBER_A, MEMBER_B]);
  });

  it('answers 5xx when the service fails, instead of a cheerful "0 invite(s) sent"', async () => {
    addGroupMembersBatch.mockRejectedValue(new Error('supabase is down'));
    const res = await call({ userIds: [MEMBER_A] });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.json.success).not.toBe(true);
  });

  it('rejects a non-UUID id before the service is ever called', async () => {
    const res = await call({ userIds: [MEMBER_A, 'not-a-uuid'] });
    expect(res.status).toBe(400);
    expect(addGroupMembersBatch).not.toHaveBeenCalled();
  });

  it('rejects the whole request rather than quietly inviting the valid ids', async () => {
    const res = await call({ userIds: ['%27%20OR%201=1', MEMBER_A, MEMBER_B] });
    expect(res.status).toBe(400);
    expect(addGroupMembersBatch).not.toHaveBeenCalled();
  });

  it('rejects a non-string element', async () => {
    const res = await call({ userIds: [{ id: MEMBER_A }] });
    expect(res.status).toBe(400);
    expect(addGroupMembersBatch).not.toHaveBeenCalled();
  });

  it('still refuses an empty array and an over-long one with its own worded 400s', async () => {
    expect((await call({ userIds: [] })).status).toBe(400);
    const tooMany = Array.from({ length: 51 }, () => MEMBER_A);
    const res = await call({ userIds: tooMany });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/more than 50/);
  });
});
