/**
 * The board's three message routes (spec §3.3, §3.5, §3.6).
 *
 * Pins the parts a client cannot recover from if they are wrong:
 *
 *  - `rootsOnly` reaches the service, so a board page is roots only and its
 *    cached page can never be served to a chat asking for the same page;
 *  - a post title over 120 characters is rejected server-side with the same
 *    limit the client enforces — the acceptance criterion is "rejected client-
 *    AND server-side";
 *  - GET .../pinned needs group access (404 otherwise) and answers
 *    { message: null } rather than 500ing when the migration is not applied;
 *  - PUT /:messageId/pin maps each refusal to its own status code, so 503
 *    ("not migrated yet"), 400 ("not a board"), 403 ("not a moderator") and
 *    404 never collapse into one opaque failure.
 */
jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: '11111111-1111-4111-8111-111111111111', permissions: [], credentialType: 'jwt' };
    next();
  },
}));
jest.mock('../services/supabase', () => ({
  SupabaseService: class {},
}));
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
const recordLearningEvent = jest.fn(async (..._args: any[]) => undefined);
jest.mock('../services/learningEvents', () => ({
  recordLearningEvent: (...args: unknown[]) => (recordLearningEvent as any)(...args),
  surfaceFromRequest: () => 'web',
}));

import express from 'express';
import http from 'http';
import { COMMUNITY_BOARD_COPY } from '@lantern/shared/network';

const GROUP = '44444444-4444-4444-8444-444444444444';
const MESSAGE = '66666666-6666-4666-8666-666666666666';

const getGroupById = jest.fn(async () => ({ id: GROUP, name: 'exam-week', adminIds: [] }) as any);
const getGroupMessages = jest.fn(async (..._args: any[]) => [] as any[]);
const getPinnedMessage = jest.fn(async () => null as any);
const setMessagePin = jest.fn(async () => ({ status: 'ok', message: { id: MESSAGE } }) as any);
const sendMessage = jest.fn(async (..._args: any[]) => ({ id: MESSAGE, type: 'TEXT' }) as any);

describe('board message routes', () => {
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
    const mod = require('./messages');
    mod.initializeMessageRoutes(
      {
        getGroupById,
        getGroupMessages,
        getPinnedMessage,
        setMessagePin,
        sendMessage,
        getClient: () => {
          throw new Error('routes must not touch the database directly');
        },
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
    getGroupById.mockClear().mockResolvedValue({ id: GROUP, name: 'exam-week', adminIds: [] } as any);
    getGroupMessages.mockClear();
    getPinnedMessage.mockClear().mockResolvedValue(null);
    setMessagePin.mockClear().mockResolvedValue({ status: 'ok', message: { id: MESSAGE } });
    sendMessage.mockClear();
  });

  describe('GET /group/:groupId', () => {
    it('passes rootsOnly through for 1 and true, and defaults to false', async () => {
      for (const [query, expected] of [
        ['?rootsOnly=1', true],
        ['?rootsOnly=true', true],
        ['', false],
        ['?rootsOnly=0', false],
      ] as Array<[string, boolean]>) {
        getGroupMessages.mockClear();
        const res = await call('GET', `/api/v1/messages/group/${GROUP}${query}`);
        expect(res.status).toBe(200);
        expect(getGroupMessages.mock.calls[0][1]).toMatchObject({ rootsOnly: expected });
      }
    });

    it('404s when the caller is not in the group', async () => {
      getGroupById.mockResolvedValue(null as any);
      const res = await call('GET', `/api/v1/messages/group/${GROUP}?rootsOnly=1`);
      expect(res.status).toBe(404);
      expect(getGroupMessages).not.toHaveBeenCalled();
    });
  });

  describe('POST /group/:groupId', () => {
    it('forwards a post title', async () => {
      const res = await call('POST', `/api/v1/messages/group/${GROUP}`, {
        content: 'Body',
        subject: 'Exam week plan',
      });
      expect(res.status).toBe(201);
      expect(sendMessage.mock.calls[0][4]).toMatchObject({ subject: 'Exam week plan' });
    });

    it('rejects a title over 120 characters server-side', async () => {
      const res = await call('POST', `/api/v1/messages/group/${GROUP}`, {
        content: 'Body',
        subject: 'x'.repeat(121),
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.json)).toContain('Title must be 120 characters or fewer');
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('accepts exactly 120 characters', async () => {
      const res = await call('POST', `/api/v1/messages/group/${GROUP}`, {
        content: 'Body',
        subject: 'x'.repeat(120),
      });
      expect(res.status).toBe(201);
    });

    it('writes no learning event for a board post — the branch tests the type', async () => {
      recordLearningEvent.mockClear();
      // sendMessage returns TEXT for a board even when the body looks like a
      // question, which is what keeps group_question_posted unwritten.
      sendMessage.mockResolvedValue({ id: MESSAGE, type: 'TEXT' });
      const res = await call('POST', `/api/v1/messages/group/${GROUP}`, {
        content: JSON.stringify({ type: 'QUESTION', questionStem: 'Which drug?' }),
      });
      expect(res.status).toBe(201);
      expect(recordLearningEvent).not.toHaveBeenCalled();

      // A study group still records one (regression).
      sendMessage.mockResolvedValue({ id: MESSAGE, type: 'QUESTION' });
      await call('POST', `/api/v1/messages/group/${GROUP}`, { content: '{}' });
      expect(recordLearningEvent).toHaveBeenCalledTimes(1);
      expect(recordLearningEvent.mock.calls[0][1]).toMatchObject({
        eventType: 'group_question_posted',
      });
    });
  });

  describe('GET /group/:groupId/pinned', () => {
    it('answers { message: null } when nothing is pinned or the migration is unapplied', async () => {
      const res = await call('GET', `/api/v1/messages/group/${GROUP}/pinned`);
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ success: true, data: { message: null } });
    });

    it('returns the pinned post', async () => {
      getPinnedMessage.mockResolvedValue({ id: MESSAGE, subject: 'Read this' } as any);
      const res = await call('GET', `/api/v1/messages/group/${GROUP}/pinned`);
      expect(res.json.data.message).toMatchObject({ id: MESSAGE, subject: 'Read this' });
    });

    it('404s without group access, before reading the pin', async () => {
      getGroupById.mockResolvedValue(null as any);
      const res = await call('GET', `/api/v1/messages/group/${GROUP}/pinned`);
      expect(res.status).toBe(404);
      expect(getPinnedMessage).not.toHaveBeenCalled();
    });
  });

  describe('PUT /:messageId/pin', () => {
    it('200s and returns the updated message', async () => {
      const res = await call('PUT', `/api/v1/messages/${MESSAGE}/pin`, { pinned: true });
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ success: true, data: { id: MESSAGE } });
      expect(setMessagePin).toHaveBeenCalledWith(
        MESSAGE,
        '11111111-1111-4111-8111-111111111111',
        true,
      );
    });

    it('requires a boolean `pinned`', async () => {
      const res = await call('PUT', `/api/v1/messages/${MESSAGE}/pin`, {});
      expect(res.status).toBe(400);
      expect(setMessagePin).not.toHaveBeenCalled();
    });

    it('maps every refusal to its own status and message', async () => {
      const cases: Array<[string, number, string]> = [
        ['unavailable', 503, COMMUNITY_BOARD_COPY.pinUnavailable],
        ['not_board', 400, 'Only community boards support pinning'],
        ['forbidden', 403, 'Only community moderators can pin'],
        ['not_found', 404, 'Message not found or access denied'],
      ];
      for (const [status, code, error] of cases) {
        setMessagePin.mockResolvedValue({ status } as any);
        const res = await call('PUT', `/api/v1/messages/${MESSAGE}/pin`, { pinned: true });
        expect([status, res.status]).toEqual([status, code]);
        expect(res.json).toEqual({ success: false, error });
      }
    });

    it('the pre-migration refusal is the copy both clients show', async () => {
      setMessagePin.mockResolvedValue({ status: 'unavailable' } as any);
      const res = await call('PUT', `/api/v1/messages/${MESSAGE}/pin`, { pinned: false });
      expect(res.json.error).toBe('Pinning is not available yet');
    });
  });
});
