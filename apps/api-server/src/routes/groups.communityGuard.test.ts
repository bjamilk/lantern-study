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
const hasGroupCommunitySurface = jest.fn(async () => true);
jest.mock('../services/schemaCapabilities', () => ({
  hasGroupCommunitySurface: (...args: unknown[]) => (hasGroupCommunitySurface as any)(...args),
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
const getGroupById = jest.fn(async (..._args: any[]): Promise<any> => ({
  id: GROUP,
  name: 'Exam week',
  adminIds: [USER],
  permissions: {},
  visibility: 'community',
  communityId: COMMUNITY,
  communitySurface: 'study_group',
}));
const updateGroup = jest.fn(async (id: string, data: any) => ({ id, ...data }));
const addGroupMember = jest.fn(async () => undefined);
const addGroupMembersBatch = jest.fn(async (_g: string, ids: string[]) => ({
  invited: ids,
  alreadyMembers: [] as string[],
  alreadyPending: [] as string[],
}));
const getUserById = jest.fn(async () => ({ id: USER, name: 'Ada', username: 'ada' }));
const createNotification = jest.fn(async () => undefined);

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
      {
        // The data layer, not the `SupabaseService` facade: the same stubs,
        // regrouped under the domain that owns each one.
        groups: {
          createGroup,
          getGroupById,
          updateGroup,
          addGroupMember,
          addGroupMembersBatch,
        },
        users: { getUserById },
        notifications: { createNotification },
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
    addGroupMember.mockClear();
    addGroupMembersBatch.mockClear();
    hasGroupCommunitySurface.mockClear().mockResolvedValue(true);
    getGroupById.mockClear().mockResolvedValue({
      id: GROUP,
      name: 'Exam week',
      adminIds: [USER],
      permissions: {},
      visibility: 'community',
      communityId: COMMUNITY,
      communitySurface: 'study_group',
    } as any);
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

  /**
   * Spec §3.7. `communitySurface` decides board vs study group, and it is the
   * ONLY thing that does — never which screen created the group. Phase 1 does
   * not gate 'board' on a role: community_members.role is display-only, there
   * is no promote/demote endpoint, and auto-derived campus communities have
   * created_by = NULL, so a role gate would make board creation impossible
   * there.
   */
  describe('POST /groups communitySurface', () => {
    it('defaults to board when a communityId is present', async () => {
      isActiveMember.mockResolvedValue(true);
      const res = await call('POST', '/api/v1/groups', {
        name: 'Exam week',
        visibility: 'community',
        communityId: COMMUNITY,
      });
      expect(res.status).toBe(201);
      expect(createGroup.mock.calls[0][0]).toMatchObject({ communitySurface: 'board' });
    });

    it('passes study_group through, and any member may create either', async () => {
      isActiveMember.mockResolvedValue(true);
      const res = await call('POST', '/api/v1/groups', {
        name: 'Pharmacology crew',
        visibility: 'community',
        communityId: COMMUNITY,
        communitySurface: 'study_group',
      });
      expect(res.status).toBe(201);
      expect(createGroup.mock.calls[0][0]).toMatchObject({ communitySurface: 'study_group' });
    });

    it('ignores the surface entirely without a communityId', async () => {
      const res = await call('POST', '/api/v1/groups', {
        name: 'Just us',
        communitySurface: 'study_group',
      });
      expect(res.status).toBe(201);
      expect(createGroup.mock.calls[0][0].communitySurface).toBeUndefined();
      expect(hasGroupCommunitySurface).not.toHaveBeenCalled();
    });

    it('rejects an unknown surface', async () => {
      const res = await call('POST', '/api/v1/groups', {
        name: 'Exam week',
        communityId: COMMUNITY,
        communitySurface: 'lounge_chat',
      });
      expect(res.status).toBe(400);
      expect(createGroup).not.toHaveBeenCalled();
    });

    it('503s study_group pre-migration rather than silently creating a board', async () => {
      isActiveMember.mockResolvedValue(true);
      hasGroupCommunitySurface.mockResolvedValue(false);
      const res = await call('POST', '/api/v1/groups', {
        name: 'Pharmacology crew',
        visibility: 'community',
        communityId: COMMUNITY,
        communitySurface: 'study_group',
      });
      expect(res.status).toBe(503);
      expect(res.json).toEqual({ success: false, error: 'Study groups are not available yet' });
      expect(createGroup).not.toHaveBeenCalled();
    });

    it('still creates a board pre-migration — NULL already means board', async () => {
      isActiveMember.mockResolvedValue(true);
      hasGroupCommunitySurface.mockResolvedValue(false);
      const res = await call('POST', '/api/v1/groups', {
        name: 'Exam week',
        visibility: 'community',
        communityId: COMMUNITY,
      });
      expect(res.status).toBe(201);
      expect(createGroup).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Spec §3.8 — a live hole, not a new rule. Both member-add endpoints checked
   * GROUP admin only, so a channel admin could pull people who are not in the
   * community straight into one of its channels.
   */
  describe('adding members to a community group', () => {
    const OUTSIDER = '99999999-9999-4999-8999-999999999999';

    it('batch: 403s a target who is not in the community, and adds nobody', async () => {
      isActiveMember.mockResolvedValue(false);
      const res = await call('POST', `/api/v1/groups/${GROUP}/members/batch`, {
        userIds: [OUTSIDER],
      });
      expect(res.status).toBe(403);
      expect(res.json).toEqual({
        success: false,
        error: 'They need to join this community first',
      });
      expect(isActiveMember).toHaveBeenCalledWith(OUTSIDER, COMMUNITY);
      expect(addGroupMembersBatch).not.toHaveBeenCalled();
    });

    it('batch: 403s ANY add into a board, even for a community member', async () => {
      isActiveMember.mockResolvedValue(true);
      getGroupById.mockResolvedValue({
        id: GROUP,
        name: 'exam-week',
        adminIds: [USER],
        permissions: {},
        visibility: 'community',
        communityId: COMMUNITY,
        communitySurface: 'board',
      });
      const res = await call('POST', `/api/v1/groups/${GROUP}/members/batch`, {
        userIds: [OUTSIDER],
      });
      expect(res.status).toBe(403);
      expect(res.json).toEqual({
        success: false,
        error: 'Members join the community, then the board',
      });
      expect(addGroupMembersBatch).not.toHaveBeenCalled();
    });

    it('batch: a legacy community group with a NULL surface is a board too', async () => {
      isActiveMember.mockResolvedValue(true);
      getGroupById.mockResolvedValue({
        id: GROUP,
        name: 'exam-week',
        adminIds: [USER],
        permissions: {},
        visibility: 'community',
        communityId: COMMUNITY,
        communitySurface: null,
      });
      const res = await call('POST', `/api/v1/groups/${GROUP}/members/batch`, {
        userIds: [OUTSIDER],
      });
      expect(res.status).toBe(403);
      expect(res.json.error).toBe('Members join the community, then the board');
    });

    it('batch: a study group takes members who are already in the community', async () => {
      isActiveMember.mockResolvedValue(true);
      const res = await call('POST', `/api/v1/groups/${GROUP}/members/batch`, {
        userIds: [OUTSIDER],
      });
      expect(res.status).toBe(200);
      expect(addGroupMembersBatch).toHaveBeenCalledWith(GROUP, [OUTSIDER]);
    });

    it('batch: a private group is unaffected and never consults the community', async () => {
      getGroupById.mockResolvedValue({
        id: GROUP,
        name: 'Just us',
        adminIds: [USER],
        permissions: {},
        visibility: 'private',
        communityId: null,
        communitySurface: null,
      });
      const res = await call('POST', `/api/v1/groups/${GROUP}/members/batch`, {
        userIds: [OUTSIDER],
      });
      expect(res.status).toBe(200);
      expect(isActiveMember).not.toHaveBeenCalled();
      expect(addGroupMembersBatch).toHaveBeenCalledTimes(1);
    });

    it('single add: the same two rules apply', async () => {
      isActiveMember.mockResolvedValue(false);
      const barred = await call('POST', `/api/v1/groups/${GROUP}/members`, { userId: OUTSIDER });
      expect(barred.status).toBe(403);
      expect(barred.json.error).toBe('They need to join this community first');

      isActiveMember.mockResolvedValue(true);
      getGroupById.mockResolvedValue({
        id: GROUP,
        name: 'exam-week',
        adminIds: [USER],
        permissions: {},
        visibility: 'community',
        communityId: COMMUNITY,
        communitySurface: 'board',
      });
      const board = await call('POST', `/api/v1/groups/${GROUP}/members`, { userId: OUTSIDER });
      expect(board.status).toBe(403);
      expect(board.json.error).toBe('Members join the community, then the board');
      expect(addGroupMember).not.toHaveBeenCalled();
    });
  });
});
