/**
 * The board action endpoints (spec §4, §6, §7, §8) at the HTTP layer.
 *
 * What only a route test can prove:
 *
 *  - every repost refusal keeps its OWN status code. 409 "already", 400
 *    "not this board" / "not a repost of a repost" / "not your own, yet", 429
 *    "too many" and 404 "no access" must not collapse into one opaque failure,
 *    because the client shows a different sentence for each;
 *  - a missing 20260904120000 answers 503 on a WRITE and 200 with
 *    `serverBacked: false` on a READ — a hidden control, never a broken screen;
 *  - `GET /messages/bookmarks` is reachable at all. It is registered above
 *    `GET /messages/:messageId`, and Express matches in registration order, so
 *    getting that wrong turns "Saved posts" into a malformed-id 400;
 *  - FAVORITE needs no new route: the board uses POST/DELETE
 *    /messages/:messageId/reactions with the emoji pinned, and the emoji is
 *    already in the shipped validator's set;
 *  - a board photo whose storage path is not the caller's own board prefix is
 *    rejected with 400 invalid_image BEFORE the row is written.
 */
jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = {
      id: '11111111-1111-4111-8111-111111111111',
      permissions: [],
      credentialType: 'jwt',
    };
    next();
  },
}));
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
// `uploadBurstRateLimit` is the only export this router takes from the module,
// and a real limiter would make the upload assertions order-dependent.
jest.mock('../middleware/rateLimit', () => ({
  uploadBurstRateLimit: (_req: any, _res: any, next: any) => next(),
}));
const recordLearningEvent = jest.fn(async (..._args: any[]) => undefined);
jest.mock('../services/learningEvents', () => ({
  recordLearningEvent: (...args: unknown[]) => (recordLearningEvent as any)(...args),
  surfaceFromRequest: () => 'web',
}));

import express from 'express';
import http from 'http';
import {
  BOARD_BOOKMARK_IMPORT_MAX,
  BOARD_FAVORITE_EMOJI,
  BOARD_GIF_MAX_BYTES,
  COMMUNITY_BOARD_COPY,
} from '@lantern/shared/network';
import { CHAT_REACTION_EMOJI } from '@lantern/shared/chat';

const VIEWER = '11111111-1111-4111-8111-111111111111';
const GROUP = '44444444-4444-4444-8444-444444444444';
const POST = '66666666-6666-4666-8666-666666666666';

const getGroupById = jest.fn(async () => ({ id: GROUP, name: 'exam-week', adminIds: [] }) as any);
const getAuthorizedGroupMessage = jest.fn(
  async () => ({ id: POST, group_id: GROUP, sender_id: VIEWER, type: 'TEXT' }) as any
);
const createBoardRepost = jest.fn(async (..._a: any[]) => ({ status: 'ok', message: { id: 'r1' } }) as any);
const undoBoardRepost = jest.fn(
  async (..._a: any[]) => ({ status: 'ok', groupId: GROUP, repostId: 'r1' }) as any
);
const setMessageBookmark = jest.fn(async (..._a: any[]) => ({ status: 'ok', bookmarked: true }) as any);
const getBookmarkedMessageIdsForGroup = jest.fn(
  async () => ({ messageIds: [POST], serverBacked: true }) as any
);
const listBookmarkedPosts = jest.fn(
  async (..._a: any[]) => ({ entries: [], nextCursor: null, serverBacked: true }) as any
);
const importMessageBookmarks = jest.fn(
  async (..._a: any[]) => ({ imported: 2, serverBacked: true }) as any
);
const isGroupMember = jest.fn(async () => true);
const sendMessage = jest.fn(async (..._a: any[]) => ({ id: POST, type: 'TEXT' }) as any);
const uploadChatImage = jest.fn(async (..._a: any[]) => ({ url: 'https://x/y.gif' }) as any);

describe('board action routes', () => {
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
        groups: { getGroupById, getAuthorizedGroupMessage, isGroupMember },
        boardActions: {
          createBoardRepost,
          undoBoardRepost,
          setMessageBookmark,
          getBookmarkedMessageIdsForGroup,
          listBookmarkedPosts,
          importMessageBookmarks,
        },
        chatSend: { sendMessage },
        uploads: { uploadChatImage },
        groupMessages: { getGroupMessages: jest.fn(async () => []) },
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
    // The GIF-cap assertions post a multi-megabyte base64 body on purpose.
    app.use(express.json({ limit: '20mb' }));
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
    getGroupById.mockClear().mockResolvedValue({ id: GROUP, name: 'exam-week', adminIds: [] });
    getAuthorizedGroupMessage
      .mockClear()
      .mockResolvedValue({ id: POST, group_id: GROUP, sender_id: VIEWER, type: 'TEXT' });
    createBoardRepost.mockClear().mockResolvedValue({ status: 'ok', message: { id: 'r1' } });
    undoBoardRepost.mockClear().mockResolvedValue({ status: 'ok', groupId: GROUP, repostId: 'r1' });
    setMessageBookmark.mockClear().mockResolvedValue({ status: 'ok', bookmarked: true });
    getBookmarkedMessageIdsForGroup
      .mockClear()
      .mockResolvedValue({ messageIds: [POST], serverBacked: true });
    listBookmarkedPosts
      .mockClear()
      .mockResolvedValue({ entries: [], nextCursor: null, serverBacked: true });
    importMessageBookmarks.mockClear().mockResolvedValue({ imported: 2, serverBacked: true });
    isGroupMember.mockClear().mockResolvedValue(true);
    sendMessage.mockClear().mockResolvedValue({ id: POST, type: 'TEXT' });
    uploadChatImage.mockClear().mockResolvedValue({ url: 'https://x/y.gif' });
  });

  describe('POST /:messageId/repost', () => {
    it('creates the repost on the ORIGINAL‘s board, resolved server-side', async () => {
      const res = await call('POST', `/api/v1/messages/${POST}/repost`, { quote: 'still the one' });
      expect(res.status).toBe(201);
      expect(createBoardRepost).toHaveBeenCalledWith(GROUP, VIEWER, POST, 'still the one');
    });

    it('404s a caller with no access to the post', async () => {
      getAuthorizedGroupMessage.mockResolvedValue(null as any);
      const res = await call('POST', `/api/v1/messages/${POST}/repost`);
      expect(res.status).toBe(404);
      expect(createBoardRepost).not.toHaveBeenCalled();
    });

    it('gives every refusal its own status code and its own words', async () => {
      const cases: Array<[string, number, string]> = [
        ['already', 409, COMMUNITY_BOARD_COPY.repostAlready],
        ['not_same_board', 400, COMMUNITY_BOARD_COPY.repostNotSameBoard],
        ['repost_of_repost', 400, COMMUNITY_BOARD_COPY.repostOfRepost],
        ['own_too_soon', 400, COMMUNITY_BOARD_COPY.repostOwnTooSoon],
        ['removed', 400, COMMUNITY_BOARD_COPY.repostRemoved],
        ['not_a_post', 400, COMMUNITY_BOARD_COPY.repostNotAPost],
        ['not_board', 400, COMMUNITY_BOARD_COPY.repostUnavailable],
        ['too_many', 429, COMMUNITY_BOARD_COPY.repostTooMany],
        ['quote_too_long', 400, COMMUNITY_BOARD_COPY.repostQuoteTooLong],
        ['not_found', 404, 'Post not found or access denied'],
      ];
      for (const [status, expectedStatus, expectedError] of cases) {
        createBoardRepost.mockResolvedValue({ status } as any);
        const res = await call('POST', `/api/v1/messages/${POST}/repost`);
        expect([status, res.status]).toEqual([status, expectedStatus]);
        expect(res.json.error).toBe(expectedError);
      }
    });

    it('refuses an absurd quote before it reaches the service', async () => {
      const res = await call('POST', `/api/v1/messages/${POST}/repost`, {
        quote: 'x'.repeat(5000),
      });
      expect(res.status).toBe(400);
      expect(createBoardRepost).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /:messageId/repost', () => {
    it('undoes by the ORIGINAL‘s id, so the client never holds the repost row id', async () => {
      const res = await call('DELETE', `/api/v1/messages/${POST}/repost`);
      expect(res.status).toBe(200);
      expect(undoBoardRepost).toHaveBeenCalledWith(POST, VIEWER);
      expect(res.json.data).toMatchObject({ removed: true });
    });

    it('404s when the viewer has no repost of that post', async () => {
      undoBoardRepost.mockResolvedValue({ status: 'not_found' } as any);
      const res = await call('DELETE', `/api/v1/messages/${POST}/repost`);
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /:messageId/bookmark', () => {
    it('saves and unsaves', async () => {
      expect((await call('PUT', `/api/v1/messages/${POST}/bookmark`, { bookmarked: true })).status).toBe(200);
      expect(setMessageBookmark).toHaveBeenCalledWith(POST, VIEWER, true);
      setMessageBookmark.mockResolvedValue({ status: 'ok', bookmarked: false });
      const off = await call('PUT', `/api/v1/messages/${POST}/bookmark`, { bookmarked: false });
      expect(off.json.data).toEqual({ bookmarked: false });
    });

    it('503s with the shared copy before the migration is applied', async () => {
      setMessageBookmark.mockResolvedValue({ status: 'unavailable' } as any);
      const res = await call('PUT', `/api/v1/messages/${POST}/bookmark`, { bookmarked: true });
      expect(res.status).toBe(503);
      expect(res.json.error).toBe(COMMUNITY_BOARD_COPY.bookmarksUnavailable);
    });

    it('400s a DM message id and 404s a message the viewer cannot reach', async () => {
      setMessageBookmark.mockResolvedValue({ status: 'not_a_board_post' } as any);
      expect((await call('PUT', `/api/v1/messages/${POST}/bookmark`, { bookmarked: true })).status).toBe(400);
      setMessageBookmark.mockResolvedValue({ status: 'not_found' } as any);
      expect((await call('PUT', `/api/v1/messages/${POST}/bookmark`, { bookmarked: true })).status).toBe(404);
    });
  });

  describe('GET /group/:groupId/bookmarks', () => {
    it('answers the viewer‘s saved ids on that board', async () => {
      const res = await call('GET', `/api/v1/messages/group/${GROUP}/bookmarks`);
      expect(res.status).toBe(200);
      expect(res.json.data).toEqual({ messageIds: [POST], serverBacked: true });
    });

    it('404s a non-member', async () => {
      isGroupMember.mockResolvedValue(false);
      const res = await call('GET', `/api/v1/messages/group/${GROUP}/bookmarks`);
      expect(res.status).toBe(404);
      expect(getBookmarkedMessageIdsForGroup).not.toHaveBeenCalled();
    });
  });

  describe('GET /bookmarks', () => {
    it('is reachable — it is registered above GET /:messageId', async () => {
      const res = await call('GET', '/api/v1/messages/bookmarks');
      expect(res.status).toBe(200);
      expect(listBookmarkedPosts).toHaveBeenCalled();
    });

    it('passes limit and the keyset cursor through', async () => {
      await call('GET', '/api/v1/messages/bookmarks?limit=5&before=2026-09-03T10:00:00.000Z');
      expect(listBookmarkedPosts).toHaveBeenCalledWith(VIEWER, {
        limit: 5,
        before: '2026-09-03T10:00:00.000Z',
      });
    });

    it('stays a 200 with serverBacked:false before the migration', async () => {
      listBookmarkedPosts.mockResolvedValue({
        entries: [],
        nextCursor: null,
        serverBacked: false,
      } as any);
      const res = await call('GET', '/api/v1/messages/bookmarks');
      expect(res.status).toBe(200);
      expect(res.json.data.serverBacked).toBe(false);
    });
  });

  describe('PUT /bookmarks/import', () => {
    it('imports the device-local ids', async () => {
      const res = await call('PUT', '/api/v1/messages/bookmarks/import', {
        messageIds: [POST, 'not-a-real-id'],
      });
      expect(res.status).toBe(200);
      expect(res.json.data).toEqual({ imported: 2 });
    });

    it('refuses a non-array and an oversized batch', async () => {
      expect((await call('PUT', '/api/v1/messages/bookmarks/import', { messageIds: 'x' })).status).toBe(400);
      const tooMany = Array.from({ length: BOARD_BOOKMARK_IMPORT_MAX + 1 }, (_, i) => `id-${i}`);
      expect(
        (await call('PUT', '/api/v1/messages/bookmarks/import', { messageIds: tooMany })).status
      ).toBe(400);
      expect(importMessageBookmarks).not.toHaveBeenCalled();
    });

    it('503s before the migration, so the client keeps its local key', async () => {
      importMessageBookmarks.mockResolvedValue({ imported: 0, serverBacked: false } as any);
      const res = await call('PUT', '/api/v1/messages/bookmarks/import', { messageIds: [POST] });
      expect(res.status).toBe(503);
      expect(res.json.error).toBe(COMMUNITY_BOARD_COPY.bookmarksUnavailable);
    });
  });

  describe('POST /group/:groupId with a photo', () => {
    const SUPABASE = 'https://project.supabase.co';
    const mine = `${SUPABASE}/storage/v1/object/sign/note-files/${VIEWER}/chat/${GROUP}/1-a.webp?token=abc`;

    it('threads a valid imageUrl into the service', async () => {
      const res = await call('POST', `/api/v1/messages/group/${GROUP}`, {
        content: 'Timetable is out',
        subject: 'Exam week',
        imageUrl: mine,
      });
      expect(res.status).toBe(201);
      expect(sendMessage.mock.calls[0]![4]).toMatchObject({ imageUrl: mine, subject: 'Exam week' });
    });

    it('400s invalid_image for another user‘s or another board‘s object', async () => {
      for (const bad of [
        `${SUPABASE}/storage/v1/object/sign/note-files/someone-else/chat/${GROUP}/1-a.webp`,
        `${SUPABASE}/storage/v1/object/sign/note-files/${VIEWER}/chat/other-group/1-a.webp`,
        `${SUPABASE}/storage/v1/object/sign/question-images/${VIEWER}/chat/${GROUP}/1-a.webp`,
        'https://evil.test/a.webp',
      ]) {
        sendMessage.mockClear();
        const res = await call('POST', `/api/v1/messages/group/${GROUP}`, {
          content: 'hi',
          imageUrl: bad,
        });
        expect([bad, res.status]).toEqual([bad, 400]);
        expect(res.json.error).toBe('invalid_image');
        expect(sendMessage).not.toHaveBeenCalled();
      }
    });

    it('still posts text with no attachment', async () => {
      const res = await call('POST', `/api/v1/messages/group/${GROUP}`, { content: 'just words' });
      expect(res.status).toBe(201);
      expect(sendMessage.mock.calls[0]![4].imageUrl).toBeUndefined();
    });
  });

  describe('favorite reuses the shipped reaction routes', () => {
    it('needs no validator change, because the emoji is already in the set', () => {
      expect(CHAT_REACTION_EMOJI as readonly string[]).toContain(BOARD_FAVORITE_EMOJI);
    });

    it('has no route of its own', () => {
      const paths = (require('./messages').default as any).stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => layer.route.path as string);
      expect(paths).not.toContain('/:messageId/favorite');
      expect(paths).toContain('/:messageId/reactions');
      expect(paths).toContain('/group/:groupId/user-reactions');
    });

    it('registers GET /bookmarks before GET /:messageId', () => {
      const stack = (require('./messages').default as any).stack.filter((l: any) => l.route);
      const index = (path: string, method: string) =>
        stack.findIndex((l: any) => l.route.path === path && l.route.methods[method]);
      expect(index('/bookmarks', 'get')).toBeGreaterThan(-1);
      expect(index('/bookmarks', 'get')).toBeLessThan(index('/:messageId', 'get'));
    });
  });

  /**
   * The GIF cap has to exist HERE or it does not exist.
   *
   * `normalizeImageForStorage` passes an animated GIF through byte-for-byte, so
   * nothing downstream shrinks it and every reader pays the whole file. Both
   * composers refuse an over-cap pick, but the `note-files` bucket declares no
   * `file_size_limit`, so a stale build or a direct call reaches this route with
   * the client-side check skipped entirely — which is what "the limit lives only
   * in the UI" means in practice.
   */
  describe('POST /upload-image enforces the GIF cap server-side', () => {
    /** base64 chars needed to decode to `bytes`. */
    const base64Of = (bytes: number) => 'A'.repeat(Math.ceil(bytes / 3) * 4);

    it('refuses a GIF over BOARD_GIF_MAX_BYTES with the shared words', async () => {
      const res = await call('POST', '/api/v1/messages/upload-image', {
        fileName: 'party.gif',
        contentType: 'image/gif',
        base64Data: base64Of(BOARD_GIF_MAX_BYTES + 64 * 1024),
        groupId: GROUP,
      });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe(COMMUNITY_BOARD_COPY.gifTooLarge);
      expect(uploadChatImage).not.toHaveBeenCalled();
    });

    it('accepts a GIF under the cap', async () => {
      const res = await call('POST', '/api/v1/messages/upload-image', {
        fileName: 'party.gif',
        contentType: 'image/gif',
        base64Data: base64Of(BOARD_GIF_MAX_BYTES - 512 * 1024),
        groupId: GROUP,
      });
      expect(res.status).toBe(200);
      expect(uploadChatImage).toHaveBeenCalled();
    });

    it('leaves a PHOTO on the larger 10 MB cap — the GIF rule is GIF-only', async () => {
      const res = await call('POST', '/api/v1/messages/upload-image', {
        fileName: 'timetable.jpg',
        contentType: 'image/jpeg',
        base64Data: base64Of(BOARD_GIF_MAX_BYTES + 64 * 1024),
        groupId: GROUP,
      });
      expect(res.status).toBe(200);
      expect(uploadChatImage).toHaveBeenCalled();
    });
  });
});
