/**
 * PUT /messages/:messageId/update — similarity-flag writes (hotfix H3,
 * finding 8).
 *
 * The route authorised with getAuthorizedGroupMessage alone, which proves
 * only that the caller is IN the group. So any member of a group could
 * rewrite the `flagged_as_similar_user_ids` on any OTHER member's message —
 * a write on someone else's content, and one that drives who gets shown as a
 * duplicate poster. It now holds to the same author-or-group-admin rule the
 * sibling /status route uses.
 */
jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: currentUserId, permissions: [], credentialType: 'jwt' };
    next();
  },
}));
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../middleware/rateLimit', () => ({
  uploadBurstRateLimit: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../services/learningEvents', () => ({
  recordLearningEvent: jest.fn(async () => undefined),
  surfaceFromRequest: () => 'web',
}));
jest.mock('../services/activityFeed', () => ({
  getActivityFeedService: () => ({ record: jest.fn(async () => undefined) }),
}));
jest.mock('../services/learningConnections', () => ({
  getLearningConnectionsService: () => ({ record: jest.fn(async () => undefined) }),
}));

import express from 'express';
import http from 'http';

const AUTHOR = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const BYSTANDER = '33333333-3333-4333-8333-333333333333';
const GROUP = '44444444-4444-4444-8444-444444444444';
const MESSAGE = '66666666-6666-4666-8666-666666666666';

let currentUserId = AUTHOR;

const getAuthorizedGroupMessage = jest.fn(
  async () => ({ id: MESSAGE, group_id: GROUP, sender_id: AUTHOR, type: 'TEXT' }) as any
);
const isGroupAdmin = jest.fn(async () => false);
const updateMessageFlagged = jest.fn(async () => ({ id: MESSAGE }) as any);

describe('PUT /messages/:messageId/update — similarity flags', () => {
  let server: http.Server;
  let base: string;

  async function flag(flagIds: unknown) {
    const res = await fetch(`${base}/api/v1/messages/${MESSAGE}/update`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flagged_as_similar_user_ids: flagIds }),
    });
    return { status: res.status, json: (await res.json()) as any };
  }

  beforeAll(async () => {
    const mod = require('./messages');
    mod.initializeMessageRoutes(
      {
        groups: { getAuthorizedGroupMessage, isGroupAdmin },
        groupMessages: { updateMessageFlagged },
        getClient: () => {
          throw new Error('routes must not touch the database directly');
        },
      } as any,
      {
        get: async () => null,
        set: async () => undefined,
        delete: async () => undefined,
        deletePattern: async () => undefined,
      } as any
    );
    const app = express();
    app.use(express.json());
    app.use('/api/v1/messages', mod.default);
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
    currentUserId = AUTHOR;
    getAuthorizedGroupMessage
      .mockClear()
      .mockResolvedValue({ id: MESSAGE, group_id: GROUP, sender_id: AUTHOR, type: 'TEXT' });
    isGroupAdmin.mockClear().mockResolvedValue(false);
    updateMessageFlagged.mockClear().mockResolvedValue({ id: MESSAGE });
  });

  it('refuses a plain group member who is not the author with 403', async () => {
    currentUserId = BYSTANDER;

    const res = await flag([BYSTANDER]);

    expect(res.status).toBe(403);
    expect(updateMessageFlagged).not.toHaveBeenCalled();
  });

  it('lets the author flag their own message', async () => {
    const res = await flag([BYSTANDER]);

    expect(res.status).toBe(200);
    expect(updateMessageFlagged).toHaveBeenCalledWith(MESSAGE, [BYSTANDER]);
  });

  it('lets a group admin flag another member’s message', async () => {
    currentUserId = ADMIN;
    isGroupAdmin.mockResolvedValue(true);

    const res = await flag([BYSTANDER]);

    expect(res.status).toBe(200);
    expect(updateMessageFlagged).toHaveBeenCalledWith(MESSAGE, [BYSTANDER]);
  });

  it('still rejects a non-array body before any authorisation work is wasted', async () => {
    const res = await flag('not-an-array');

    expect(res.status).toBe(400);
    expect(updateMessageFlagged).not.toHaveBeenCalled();
  });

  it('still 404s when the caller is not in the group at all', async () => {
    currentUserId = BYSTANDER;
    getAuthorizedGroupMessage.mockResolvedValue(null);

    const res = await flag([AUTHOR]);

    expect(res.status).toBe(404);
    expect(updateMessageFlagged).not.toHaveBeenCalled();
  });
});
