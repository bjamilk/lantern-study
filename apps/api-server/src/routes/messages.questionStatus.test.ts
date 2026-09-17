/**
 * PUT /messages/:messageId/status at the HTTP layer.
 *
 * What only a route test can prove:
 *
 *  - VERIFIED is refused below the peer threshold with 409 and the SHARED copy,
 *    plus the count the card needs to render "1 of 2 peer votes". A 403 would be
 *    wrong (the caller is allowed to ask) and a 200 would be a lie;
 *  - the author's own upvote does not count. The route hands the author id to
 *    the counter, so a question whose only upvote is the author's stays at 0;
 *  - a GROUP ADMIN is refused on exactly the same evidence. Verification is a
 *    peer signal, not a permission — this is the assertion that keeps the rule
 *    from drifting back into "whoever is trusted may declare it";
 *  - an admin may still REJECT (and set PENDING) with no votes at all: pulling a
 *    bad question needs no quorum, and gating it would make moderation harder;
 *  - at the threshold the write goes through and the feed / north-star writers
 *    still run.
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
const recordActivity = jest.fn(async (..._args: any[]) => undefined);
jest.mock('../services/activityFeed', () => ({
  getActivityFeedService: () => ({ record: recordActivity }),
}));
const recordConnection = jest.fn(async (..._args: any[]) => undefined);
jest.mock('../services/learningConnections', () => ({
  getLearningConnectionsService: () => ({ record: recordConnection }),
}));

import express from 'express';
import http from 'http';
import {
  QUESTION_VERIFY_COPY,
  VERIFY_PEER_UPVOTES,
} from '@lantern/shared/utils/questionVerification';

const AUTHOR = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const GROUP = '44444444-4444-4444-8444-444444444444';
const QUESTION = '66666666-6666-4666-8666-666666666666';

let currentUserId = AUTHOR;

const getAuthorizedGroupMessage = jest.fn(
  async () => ({ id: QUESTION, group_id: GROUP, sender_id: AUTHOR, type: 'QUESTION' }) as any
);
const isGroupAdmin = jest.fn(async () => false);
const countPeerUpvotesForMessage = jest.fn(async (..._a: any[]) => 0);
const updateQuestionStatus = jest.fn(
  async (_id: string, status: string) => ({ id: QUESTION, questionStatus: status }) as any
);

describe('PUT /messages/:messageId/status — peer verification', () => {
  let server: http.Server;
  let base: string;

  async function setStatus(questionStatus: string) {
    const res = await fetch(`${base}/api/v1/messages/${QUESTION}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionStatus }),
    });
    return { status: res.status, json: (await res.json()) as any };
  }

  beforeAll(async () => {
    const mod = require('./messages');
    mod.initializeMessageRoutes(
      {
        groups: { getAuthorizedGroupMessage, isGroupAdmin },
        groupMessages: { countPeerUpvotesForMessage, updateQuestionStatus },
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
      .mockResolvedValue({ id: QUESTION, group_id: GROUP, sender_id: AUTHOR, type: 'QUESTION' });
    isGroupAdmin.mockClear().mockResolvedValue(false);
    countPeerUpvotesForMessage.mockClear().mockResolvedValue(0);
    updateQuestionStatus
      .mockClear()
      .mockImplementation(async (_id: string, status: string) => ({
        id: QUESTION,
        questionStatus: status,
      }));
    recordActivity.mockClear();
    recordConnection.mockClear();
  });

  it('refuses the AUTHOR below the threshold with 409, the shared copy and the count', async () => {
    countPeerUpvotesForMessage.mockResolvedValue(VERIFY_PEER_UPVOTES - 1);

    const res = await setStatus('VERIFIED');

    expect(res.status).toBe(409);
    expect(res.json.error).toBe(QUESTION_VERIFY_COPY.blocked(VERIFY_PEER_UPVOTES - 1));
    expect(res.json.data).toEqual({
      peerUpvotes: VERIFY_PEER_UPVOTES - 1,
      requiredPeerUpvotes: VERIFY_PEER_UPVOTES,
    });
    expect(updateQuestionStatus).not.toHaveBeenCalled();
    expect(recordActivity).not.toHaveBeenCalled();
    expect(recordConnection).not.toHaveBeenCalled();
  });

  it('excludes the author from the count by passing the author id to the counter', async () => {
    await setStatus('VERIFIED');
    expect(countPeerUpvotesForMessage).toHaveBeenCalledWith(QUESTION, AUTHOR);
  });

  it('refuses a GROUP ADMIN on the same evidence — verification is not a permission', async () => {
    currentUserId = ADMIN;
    isGroupAdmin.mockResolvedValue(true);
    countPeerUpvotesForMessage.mockResolvedValue(VERIFY_PEER_UPVOTES - 1);

    const res = await setStatus('VERIFIED');

    expect(res.status).toBe(409);
    expect(res.json.error).toBe(QUESTION_VERIFY_COPY.blocked(VERIFY_PEER_UPVOTES - 1));
    expect(updateQuestionStatus).not.toHaveBeenCalled();
  });

  it('lets an admin REJECT with no peer votes at all', async () => {
    currentUserId = ADMIN;
    isGroupAdmin.mockResolvedValue(true);

    const res = await setStatus('REJECTED');

    expect(res.status).toBe(200);
    expect(updateQuestionStatus).toHaveBeenCalledWith(QUESTION, 'REJECTED');
    expect(countPeerUpvotesForMessage).not.toHaveBeenCalled();
  });

  it('lets an admin send a question back to PENDING with no peer votes', async () => {
    currentUserId = ADMIN;
    isGroupAdmin.mockResolvedValue(true);

    const res = await setStatus('PENDING');

    expect(res.status).toBe(200);
    expect(updateQuestionStatus).toHaveBeenCalledWith(QUESTION, 'PENDING');
  });

  it('allows VERIFIED at the threshold and reports the count back', async () => {
    countPeerUpvotesForMessage.mockResolvedValue(VERIFY_PEER_UPVOTES);

    const res = await setStatus('VERIFIED');

    expect(res.status).toBe(200);
    expect(updateQuestionStatus).toHaveBeenCalledWith(QUESTION, 'VERIFIED');
    expect(res.json.peerUpvotes).toBe(VERIFY_PEER_UPVOTES);
    expect(res.json.requiredPeerUpvotes).toBe(VERIFY_PEER_UPVOTES);
    expect(recordActivity).toHaveBeenCalled();
    expect(recordConnection).toHaveBeenCalled();
  });

  it('still refuses a non-member before any counting happens', async () => {
    getAuthorizedGroupMessage.mockResolvedValue(null as any);

    const res = await setStatus('VERIFIED');

    expect(res.status).toBe(404);
    expect(countPeerUpvotesForMessage).not.toHaveBeenCalled();
  });

  it('still 403s a member who is neither the author nor an admin', async () => {
    currentUserId = ADMIN;
    isGroupAdmin.mockResolvedValue(false);

    const res = await setStatus('VERIFIED');

    expect(res.status).toBe(403);
    expect(countPeerUpvotesForMessage).not.toHaveBeenCalled();
  });
});
