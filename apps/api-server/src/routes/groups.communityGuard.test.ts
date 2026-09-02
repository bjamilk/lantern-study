/**
 * Community membership guard on community-listed groups (Phase 1 · §2.6).
 *
 * A group with `visibility: 'community'` is a channel of that community.
 * Before this guard anyone could mint a channel into a community they were
 * not in (the discover join path checked membership, the create path did
 * not). Pins: POST /groups and PUT /groups/:id 403 a non-member, pass a
 * member, and never consult the community for a private group.
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
jest.mock('../services/supabase', () => ({
  SupabaseService: class {},
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

const isActiveMember = jest.fn<Promise<boolean>, [string, string]>();
jest.mock('../services/communities', () => ({
  getCommunitiesService: () => ({ isActiveMember }),
}));

import express from 'express';
import http from 'http';

const USER = '11111111-1111-4111-8111-111111111111';
const COMMUNITY = '33333333-3333-4333-8333-333333333333';
const GROUP = '44444444-4444-4444-8444-444444444444';

const createGroup = jest.fn(async (data: any) => ({
  id: GROUP,
  name: data.name,
  pendingInviteUserIds: [] as string[],
}));
const getGroupById = jest.fn(async () => ({
  id: GROUP,
  name: 'Exam week',
  adminIds: [USER],
  permissions: {},
  visibility: 'community',
  communityId: COMMUNITY,
}));
const updateGroup = jest.fn(async (id: string, data: any) => ({ id, ...data }));

describe('community guard on group create/update', () => {
  let server: http.Server;
  let base: string;

  async function call(method: string, path: string, body?: unknown) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  }

  beforeAll(async () => {
    const mod = require('./groups');
    mod.initializeGroupRoutes(
      { createGroup, getGroupById, updateGroup } as any,
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
    isActiveMember.mockReset();
    createGroup.mockClear();
    updateGroup.mockClear();
  });

  describe('POST /groups', () => {
    it('403s a non-member trying to list a group in a community, and never creates it', async () => {
      isActiveMember.mockResolvedValue(false);
      const res = await call('POST', '/api/v1/groups', {
        name: 'Exam week',
        visibility: 'community',
        communityId: COMMUNITY,
      });
      expect(res.status).toBe(403);
      expect(res.json).toEqual({ success: false, error: 'Join this community first' });
      expect(isActiveMember).toHaveBeenCalledWith(USER, COMMUNITY);
      expect(createGroup).not.toHaveBeenCalled();
    });

    it('201s a member', async () => {
      isActiveMember.mockResolvedValue(true);
      const res = await call('POST', '/api/v1/groups', {
        name: 'Exam week',
        visibility: 'community',
        communityId: COMMUNITY,
      });
      expect(res.status).toBe(201);
      expect(res.json.success).toBe(true);
      expect(createGroup).toHaveBeenCalledTimes(1);
      expect(createGroup.mock.calls[0][0]).toMatchObject({
        visibility: 'community',
        communityId: COMMUNITY,
      });
    });

    it('never consults the community for a private group', async () => {
      const res = await call('POST', '/api/v1/groups', {
        name: 'Just us',
        visibility: 'private',
        communityId: COMMUNITY,
      });
      expect(res.status).toBe(201);
      expect(isActiveMember).not.toHaveBeenCalled();
      expect(createGroup).toHaveBeenCalledTimes(1);
    });

    it('never consults the community when no visibility is given (defaults to private)', async () => {
      const res = await call('POST', '/api/v1/groups', { name: 'Plain group' });
      expect(res.status).toBe(201);
      expect(isActiveMember).not.toHaveBeenCalled();
    });
  });

  describe('PUT /groups/:groupId', () => {
    it('403s a non-member moving a community-visible group to another community', async () => {
      isActiveMember.mockResolvedValue(false);
      const res = await call('PUT', `/api/v1/groups/${GROUP}`, { communityId: COMMUNITY });
      expect(res.status).toBe(403);
      expect(res.json).toEqual({ success: false, error: 'Join this community first' });
      expect(updateGroup).not.toHaveBeenCalled();
    });

    it('passes a member', async () => {
      isActiveMember.mockResolvedValue(true);
      const res = await call('PUT', `/api/v1/groups/${GROUP}`, {
        visibility: 'community',
        communityId: COMMUNITY,
      });
      expect(res.status).toBe(200);
      expect(isActiveMember).toHaveBeenCalledWith(USER, COMMUNITY);
      expect(updateGroup).toHaveBeenCalledTimes(1);
    });

    it('does not consult the community when the update does not touch the listing', async () => {
      const res = await call('PUT', `/api/v1/groups/${GROUP}`, { name: 'Renamed' });
      expect(res.status).toBe(200);
      expect(isActiveMember).not.toHaveBeenCalled();
    });

    it('does not consult the community when the group is made private', async () => {
      const res = await call('PUT', `/api/v1/groups/${GROUP}`, { visibility: 'private' });
      expect(res.status).toBe(200);
      expect(isActiveMember).not.toHaveBeenCalled();
    });
  });
});
