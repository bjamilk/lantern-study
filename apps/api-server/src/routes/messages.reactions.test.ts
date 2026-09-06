/**
 * `POST/DELETE /messages/:messageId/reactions` at the HTTP layer, driven with
 * the EXACT payload both clients send for Favorite.
 *
 * Why this file exists
 * --------------------
 * Favorite on a board post answered 500 "Something went wrong" while Bookmark
 * on the same row worked. Every existing check passed while it was broken:
 * `messages.boardActions.test.ts` proves the emoji is in the validator's set
 * and that the route is registered, but nothing ever sent a request to it, so
 * the write itself was never exercised. The failure was one layer below —
 * `.upsert(..., { onConflict: 'group_message_id,user_id,emoji' })` against a
 * table whose only matching unique index is PARTIAL (`WHERE group_message_id
 * IS NOT NULL`, migration 20260830120000). Postgres cannot infer a partial
 * index for `ON CONFLICT` unless the statement repeats the index predicate,
 * which PostgREST cannot send, so every write raised 42P10.
 *
 * So the assertions here are deliberately about BEHAVIOUR at the boundary:
 *
 *  - the favorite payload gets a 200 with the authoritative counts;
 *  - the write is a plain INSERT — the fake client fails the test if the route
 *    ever reaches for an ON-CONFLICT upsert again;
 *  - a duplicate (23505, the partial index doing its job) is still a 200, so a
 *    double tap or an offline retry is a no-op rather than a red toast;
 *  - a write that genuinely fails says so in words ("Couldn't save your
 *    reaction"), never the generic 500 string that told the student nothing;
 *  - the pre-migration state degrades to 503 with its own copy.
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
jest.mock('../services/supabase', () => ({
  SupabaseService: class {},
}));
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../middleware/rateLimit', () => ({
  uploadBurstRateLimit: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../services/learningEvents', () => ({
  recordLearningEvent: async () => undefined,
  surfaceFromRequest: () => 'web',
}));

import express from 'express';
import http from 'http';
import { BOARD_FAVORITE_EMOJI } from '@lantern/shared/network';
import {
  REACTION_REMOVE_FAILED,
  REACTION_SAVE_FAILED,
  REACTIONS_UNAVAILABLE,
} from '../services/messageReactions';

const VIEWER = '11111111-1111-4111-8111-111111111111';
const GROUP = '44444444-4444-4444-8444-444444444444';
const POST = '66666666-6666-4666-8666-666666666666';

/** Rows handed to `.insert(...)`, so the payload that reaches the DB is checked. */
let insertedRows: any[] = [];
/** Filters handed to `.delete().eq(...)`, same reason. */
let deleteFilters: Array<[string, unknown]> = [];
let insertError: any = null;
let deleteError: any = null;

/**
 * A Supabase client stub that ACCEPTS `insert` and REFUSES `upsert`.
 *
 * The refusal is the regression guard: `message_reactions` has no unique
 * constraint an ON CONFLICT target can be inferred from, so any future upsert
 * here is 42P10 in production. Failing loudly in a test beats a 500 on a
 * student's phone.
 */
function fakeClient() {
  return {
    from(table: string) {
      if (table !== 'message_reactions') {
        throw new Error(`unexpected table: ${table}`);
      }
      const deleteChain: any = {
        eq: (column: string, value: unknown) => {
          deleteFilters.push([column, value]);
          return deleteChain;
        },
        then: (resolve: any, reject: any) =>
          Promise.resolve({ error: deleteError }).then(resolve, reject),
      };
      return {
        insert: (row: any) => {
          insertedRows.push(row);
          return Promise.resolve({ error: insertError });
        },
        upsert: () => {
          throw new Error(
            'upsert on message_reactions needs ON CONFLICT inference that the partial unique index cannot satisfy (42P10)'
          );
        },
        delete: () => deleteChain,
      };
    },
  };
}

const getAuthorizedGroupMessage = jest.fn(
  async () => ({ id: POST, group_id: GROUP, sender_id: VIEWER, type: 'TEXT' }) as any
);
const getAuthorizedDmMessage = jest.fn(async () => null as any);
const readMessageReactions = jest.fn(
  async (): Promise<{ reactions: Record<string, number> }> => ({
    reactions: { [BOARD_FAVORITE_EMOJI]: 1 },
  })
);
const countDistinctReactionEmoji = jest.fn(async () => 1);

describe('reaction routes (the Favorite payload)', () => {
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
        getAuthorizedGroupMessage,
        getAuthorizedDmMessage,
        readMessageReactions,
        countDistinctReactionEmoji,
        getClient: () => fakeClient(),
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
    insertedRows = [];
    deleteFilters = [];
    insertError = null;
    deleteError = null;
    getAuthorizedGroupMessage
      .mockClear()
      .mockResolvedValue({ id: POST, group_id: GROUP, sender_id: VIEWER, type: 'TEXT' });
    getAuthorizedDmMessage.mockClear().mockResolvedValue(null as any);
    readMessageReactions
      .mockClear()
      .mockResolvedValue({ reactions: { [BOARD_FAVORITE_EMOJI]: 1 } });
    countDistinctReactionEmoji.mockClear().mockResolvedValue(1);
  });

  it('answers 200 to the exact body both clients send for Favorite', async () => {
    const res = await call('POST', `/api/v1/messages/${POST}/reactions`, {
      emoji: BOARD_FAVORITE_EMOJI,
    });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.data.reactions[BOARD_FAVORITE_EMOJI]).toBe(1);
  });

  it('writes a plain INSERT of (group_message_id, user_id, emoji)', async () => {
    await call('POST', `/api/v1/messages/${POST}/reactions`, { emoji: BOARD_FAVORITE_EMOJI });
    expect(insertedRows).toEqual([
      { group_message_id: POST, user_id: VIEWER, emoji: BOARD_FAVORITE_EMOJI },
    ]);
  });

  it('treats the duplicate (23505) as the state the caller asked for', async () => {
    // Second tap, or an offline retry of the first. The partial unique index
    // refuses the row; the row it refuses is the row the caller wanted.
    insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    const res = await call('POST', `/api/v1/messages/${POST}/reactions`, {
      emoji: BOARD_FAVORITE_EMOJI,
    });
    expect(res.status).toBe(200);
    expect(res.json.data.reactions[BOARD_FAVORITE_EMOJI]).toBe(1);
  });

  it('names the failure instead of collapsing into the generic 500 copy', async () => {
    insertError = { code: '42P10', message: 'no unique or exclusion constraint matching' };
    const res = await call('POST', `/api/v1/messages/${POST}/reactions`, {
      emoji: BOARD_FAVORITE_EMOJI,
    });
    expect(res.status).toBe(500);
    expect(res.json.error).toBe(REACTION_SAVE_FAILED);
    expect(res.json.error).not.toBe('Something went wrong');
  });

  it('degrades to 503 with its own words before the migration is applied', async () => {
    insertError = { code: '42P01', message: 'relation "message_reactions" does not exist' };
    const res = await call('POST', `/api/v1/messages/${POST}/reactions`, {
      emoji: BOARD_FAVORITE_EMOJI,
    });
    expect(res.status).toBe(503);
    expect(res.json.error).toBe(REACTIONS_UNAVAILABLE);
  });

  it('still refuses an emoji outside the shipped set', async () => {
    const res = await call('POST', `/api/v1/messages/${POST}/reactions`, { emoji: '🦄' });
    expect(res.status).toBe(400);
    expect(insertedRows).toHaveLength(0);
  });

  it('404s a caller with no access to the post, and writes nothing', async () => {
    getAuthorizedGroupMessage.mockResolvedValue(null as any);
    const res = await call('POST', `/api/v1/messages/${POST}/reactions`, {
      emoji: BOARD_FAVORITE_EMOJI,
    });
    expect(res.status).toBe(404);
    expect(insertedRows).toHaveLength(0);
  });

  it('un-favorites with the same payload on DELETE', async () => {
    readMessageReactions.mockResolvedValue({ reactions: {} as Record<string, number> });
    const res = await call('DELETE', `/api/v1/messages/${POST}/reactions`, {
      emoji: BOARD_FAVORITE_EMOJI,
    });
    expect(res.status).toBe(200);
    expect(res.json.data.reactions).toEqual({});
    expect(deleteFilters).toEqual([
      ['group_message_id', POST],
      ['user_id', VIEWER],
      ['emoji', BOARD_FAVORITE_EMOJI],
    ]);
  });

  it('names a failed un-favorite too', async () => {
    deleteError = { code: '23503', message: 'boom' };
    const res = await call('DELETE', `/api/v1/messages/${POST}/reactions`, {
      emoji: BOARD_FAVORITE_EMOJI,
    });
    expect(res.status).toBe(500);
    expect(res.json.error).toBe(REACTION_REMOVE_FAILED);
  });
});
