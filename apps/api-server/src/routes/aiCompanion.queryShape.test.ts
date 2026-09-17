/**
 * Query shapes AND responses for the companion handlers that no suite covered
 * (lane R2, PR 2a).
 *
 * `routes/aiCompanion.ts` built nine PostgREST chains inline across seven
 * `dataLayer.getClient()` escapes. Three suites already exist, but they cover
 * the STREAMING send path, the photo attachments and the image context — not
 * `GET /history`, `DELETE /history`, `POST /feedback` or `POST /analytics`,
 * which between them hold five of those chains and had never been exercised.
 *
 * Written and committed against the UNTOUCHED route, so it freezes what the
 * route did rather than describing what the extraction into
 * `services/data/aiCompanion.ts` produced. Each case pins BOTH the query trace
 * and what the client sees (status and body), on the happy path and on the
 * not-found path, because a trace-only freeze would let a rewrite keep every
 * query and still change the response.
 *
 * ## The ownership predicate
 *
 * A companion thread is private study history. The API runs as the SERVICE
 * ROLE, which BYPASSES RLS, so `eq("user_id", …)` is the only thing keeping one
 * student's conversation out of another's. Every chain frozen here carries it —
 * including the two that ALSO filter by conversation id, and including the
 * delete, which filters by BOTH `id` and `user_id` even though the route has
 * already checked ownership through `getOwnedConversation`. That belt and braces
 * is deliberate and is frozen as such. There is NO query-by-conversation-id-alone
 * in this file.
 *
 * ## The citations fallback
 *
 * `ai_companion_messages.citations` may not exist yet (migration
 * 20260912090000). Both the history read and the message insert retry without
 * the column when PostgREST answers `PGRST204`/`42703` about it. The retry is a
 * ROUTE decision and stays in the route; the data function takes the column list
 * as a parameter so the route can ask twice.
 */
jest.mock('../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../middleware/aiRateLimit', () => ({
  aiRateLimit: (_req: any, _res: any, next: any) => next(),
  aiRateLimitForFeature: () => (_req: any, _res: any, next: any) => next(),
  refundFeatureAiCredit: jest.fn(async () => {}),
  chargeAiCreditsDetailed: jest.fn(async () => ({ charged: 0 })),
  refundAiCredits: jest.fn(async () => {}),
}));
jest.mock('../services/aiService', () => ({
  companionChat: jest.fn(),
  summarizeGroupChat: jest.fn(),
}));
jest.mock('../services/companionContext', () => ({
  buildTrustedCompanionContext: jest.fn(async () => ({ noteId: 'note-1' })),
  fetchAuthorizedGroupSummaryMessages: jest.fn(async () => []),
}));
jest.mock('../services/companionConversations', () => ({
  createCompanionConversation: jest.fn(),
  ensureConversationTitle: jest.fn(async () => {}),
  findLatestConversationForNoteScope: (...a: unknown[]) => findLatestConversationForNoteScope(...a),
  getOwnedConversation: (...a: unknown[]) => getOwnedConversation(...a),
  listCompanionConversations: jest.fn(async () => []),
  parseCompanionUuid: (v: unknown) => (typeof v === 'string' ? v : null),
  resolveConversationForSend: jest.fn(async () => ({ id: 'conv-1', note_context_id: 'note-1' })),
  touchConversation: jest.fn(async () => {}),
}));

import router, { initializeAICompanionRoutes } from './aiCompanion';
import * as aiCompanionData from '../services/data/aiCompanion';

let getOwnedConversation: jest.Mock;
let findLatestConversationForNoteScope: jest.Mock;

const USER = 'user-1';
const CONV = 'conv-1';

const HISTORY_COLUMNS_WITHOUT_CITATIONS =
  'id, role, content, actions, feedback, created_at, note_context_id, conversation_id';
const HISTORY_COLUMNS = `${HISTORY_COLUMNS_WITHOUT_CITATIONS}, citations`;

/** A column-missing rejection, exactly as PostgREST reports one. */
const MISSING_CITATIONS = {
  code: 'PGRST204',
  message: "Could not find the 'citations' column of 'ai_companion_messages' in the schema cache",
};

type Call = string;
type Result = { data: unknown; error: unknown };

const CHAIN_METHODS = [
  'select',
  'eq',
  'neq',
  'is',
  'in',
  'order',
  'limit',
  'update',
  'delete',
  'upsert',
  'insert',
  'maybeSingle',
  'single',
] as const;

function recorder(resolve: Result | ((table: string, nth: number) => Result) = { data: null, error: null }) {
  const trace: Call[] = [];
  const fmt = (args: unknown[]) => args.map((a) => JSON.stringify(a)).join(', ');
  const resultFor = typeof resolve === 'function' ? resolve : () => resolve;
  let nth = 0;

  const client = {
    from: (table: string) => {
      trace.push(`from(${JSON.stringify(table)})`);
      const mine = nth++;
      const builder: any = {
        then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
          Promise.resolve(resultFor(table, mine)).then(ok, err),
      };
      for (const method of CHAIN_METHODS) {
        builder[method] = (...args: unknown[]) => {
          trace.push(`${method}(${fmt(args)})`);
          return builder;
        };
      }
      return builder;
    },
  };
  return { client, trace };
}

const tablesIn = (trace: Call[]) => trace.filter((c) => c.startsWith('from('));

/**
 * These handlers are plain `async (req, res)` — no asyncHandler — so an
 * unhandled rejection would hang rather than reject. The timeout below is the
 * guard; every case here is expected to answer.
 */
async function runRoute(
  method: 'get' | 'post' | 'delete',
  path: string,
  req: Record<string, unknown>,
) {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  const handlers = layer.route.stack.map((s: any) => s.handle);
  const handler = handlers[handlers.length - 1] as (req: any, res: any, next: any) => void;

  const res: any = { statusCode: 200, body: undefined };
  await new Promise<void>((resolve, reject) => {
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: unknown) => {
      res.body = body;
      resolve();
      return res;
    };
    handler({ user: { id: USER }, params: {}, query: {}, body: {}, headers: {}, ...req }, res, reject);
    setTimeout(() => reject(new Error('route never responded')), 2000).unref?.();
  });
  return res;
}

/**
 * Init the family with an `aiCompanion` namespace bound to the recording
 * client, exactly the way `data/index.ts` binds it to the real one: the route
 * calls `dataLayer.aiCompanion.<fn>(…)`, the REAL data module builds the chain,
 * the recorder captures it. The trace is still the query the database would
 * see, end to end, so a change in either half shows up here.
 */
function initWith(
  result?: Result | ((table: string, nth: number) => Result),
  overrides: Record<string, unknown> = {},
) {
  const rec = recorder(result);
  const bound = Object.fromEntries(
    Object.entries(aiCompanionData)
      .filter(([, fn]) => typeof fn === 'function')
      .map(([name, fn]) => [name, (...args: unknown[]) => (fn as any)(rec.client, ...args)]),
  );
  initializeAICompanionRoutes({
    getClient: () => rec.client,
    aiCompanion: { ...bound, ...overrides },
  } as any);
  return rec;
}

beforeEach(() => {
  getOwnedConversation = jest.fn(async () => ({ id: CONV, note_context_id: 'note-1' }));
  findLatestConversationForNoteScope = jest.fn(async () => null);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('GET /history', () => {
  it('reads the thread scoped to BOTH the caller and the conversation, oldest first', async () => {
    const messages = [{ id: 'm1', role: 'user', content: 'hi' }];
    const rec = initWith({ data: messages, error: null });

    const res = await runRoute('get', '/history', { query: { conversationId: CONV } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      messages,
      conversationId: CONV,
      noteContextId: 'note-1',
    });
    expect(rec.trace).toEqual([
      'from("ai_companion_messages")',
      `select("${HISTORY_COLUMNS}")`,
      `eq("user_id", "${USER}")`,
      `eq("conversation_id", "${CONV}")`,
      'order("created_at", {"ascending":true})',
      'limit(50)',
    ]);
  });

  it('retries without the citations column on a database that lacks it', async () => {
    const rec = initWith((_t, nth) =>
      nth === 0 ? { data: null, error: MISSING_CITATIONS } : { data: [], error: null },
    );

    const res = await runRoute('get', '/history', { query: { conversationId: CONV } });

    expect(res.statusCode).toBe(200);
    expect(res.body.messages).toEqual([]);
    expect(rec.trace).toEqual([
      'from("ai_companion_messages")',
      `select("${HISTORY_COLUMNS}")`,
      `eq("user_id", "${USER}")`,
      `eq("conversation_id", "${CONV}")`,
      'order("created_at", {"ascending":true})',
      'limit(50)',
      'from("ai_companion_messages")',
      `select("${HISTORY_COLUMNS_WITHOUT_CITATIONS}")`,
      `eq("user_id", "${USER}")`,
      `eq("conversation_id", "${CONV}")`,
      'order("created_at", {"ascending":true})',
      'limit(50)',
    ]);
  });

  it('answers 404 and reads no messages for a conversation the caller does not own', async () => {
    getOwnedConversation.mockResolvedValue(null);
    const rec = initWith();

    const res = await runRoute('get', '/history', { query: { conversationId: CONV } });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Conversation not found' });
    expect(tablesIn(rec.trace)).toEqual([]);
  });

  it('answers an empty thread, and reads nothing, when the caller has no conversation yet', async () => {
    const rec = initWith();

    const res = await runRoute('get', '/history', {});

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ messages: [], conversationId: null, noteContextId: null });
    expect(tablesIn(rec.trace)).toEqual([]);
  });

  it('answers 500 without leaking the database error when the read fails', async () => {
    initWith({ data: null, error: { code: '42P01', message: 'relation does not exist' } });

    const res = await runRoute('get', '/history', { query: { conversationId: CONV } });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch conversation history' });
  });
});

describe('DELETE /history', () => {
  it('deletes the conversation by id AND owner, after the ownership check', async () => {
    const rec = initWith({ data: null, error: null });

    const res = await runRoute('delete', '/history', { query: { conversationId: CONV } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, conversationId: CONV, noteContextId: 'note-1' });
    expect(getOwnedConversation).toHaveBeenCalledWith(expect.anything(), USER, CONV);
    expect(rec.trace).toEqual([
      'from("ai_companion_conversations")',
      'delete()',
      `eq("id", "${CONV}")`,
      `eq("user_id", "${USER}")`,
    ]);
  });

  it('answers 404 and deletes NOTHING for a conversation the caller does not own', async () => {
    getOwnedConversation.mockResolvedValue(null);
    const rec = initWith();

    const res = await runRoute('delete', '/history', { query: { conversationId: CONV } });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Conversation not found' });
    expect(tablesIn(rec.trace)).toEqual([]);
  });

  it('falls back to the latest note-scoped conversation when no id is given', async () => {
    findLatestConversationForNoteScope.mockResolvedValue({ id: 'conv-9', note_context_id: 'note-2' });
    const rec = initWith({ data: null, error: null });

    const res = await runRoute('delete', '/history', {});

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, conversationId: 'conv-9', noteContextId: null });
    expect(rec.trace).toEqual([
      'from("ai_companion_conversations")',
      'delete()',
      'eq("id", "conv-9")',
      `eq("user_id", "${USER}")`,
    ]);
  });

  it('succeeds with nothing to do when the caller has no conversation at all', async () => {
    const rec = initWith();

    const res = await runRoute('delete', '/history', {});

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, conversationId: null, noteContextId: null });
    expect(tablesIn(rec.trace)).toEqual([]);
  });
});

describe('POST /feedback', () => {
  it('rates an ASSISTANT message the caller owns', async () => {
    const rec = initWith({ data: { id: 'msg-1' }, error: null });

    const res = await runRoute('post', '/feedback', { body: { messageId: 'msg-1', rating: 'up' } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, feedback: 'up' });
    expect(rec.trace).toEqual([
      'from("ai_companion_messages")',
      'update({"feedback":"up"})',
      'eq("id", "msg-1")',
      `eq("user_id", "${USER}")`,
      // The model's turn only: a student cannot rate their own message.
      'eq("role", "assistant")',
      'select("id")',
      'maybeSingle()',
    ]);
  });

  it('clears a rating with an explicit null', async () => {
    const rec = initWith({ data: { id: 'msg-1' }, error: null });

    const res = await runRoute('post', '/feedback', { body: { messageId: 'msg-1', rating: null } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, feedback: null });
    expect(rec.trace[1]).toBe('update({"feedback":null})');
  });

  it('answers 404 when the message is not the caller own assistant message', async () => {
    const rec = initWith({ data: null, error: null });

    const res = await runRoute('post', '/feedback', { body: { messageId: 'msg-1', rating: 'down' } });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Message not found' });
    expect(tablesIn(rec.trace)).toEqual(['from("ai_companion_messages")']);
  });

  it('rejects a bad rating with 400 before touching the database', async () => {
    const rec = initWith();

    const res = await runRoute('post', '/feedback', { body: { messageId: 'msg-1', rating: 'sideways' } });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'messageId and rating (up|down|null) are required' });
    expect(tablesIn(rec.trace)).toEqual([]);
  });
});

describe('POST /analytics', () => {
  it('stamps the caller id on the event row', async () => {
    const rec = initWith({ data: null, error: null });

    const res = await runRoute('post', '/analytics', {
      body: { event: 'rail_opened', metadata: { from: 'note' } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(rec.trace[0]).toBe('from("ai_analytics")');
    const row = JSON.parse(rec.trace[1].slice('insert('.length, -1));
    expect(row).toMatchObject({ user_id: USER, event: 'rail_opened', metadata: { from: 'note' } });
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('defaults absent metadata to an empty object', async () => {
    const rec = initWith({ data: null, error: null });

    await runRoute('post', '/analytics', { body: { event: 'rail_closed' } });

    expect(JSON.parse(rec.trace[1].slice('insert('.length, -1)).metadata).toEqual({});
  });

  it('rejects a missing event with 400 before touching the database', async () => {
    const rec = initWith();

    const res = await runRoute('post', '/analytics', { body: {} });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'event is required' });
    expect(tablesIn(rec.trace)).toEqual([]);
  });

  it('answers success:false at 200, and logs, when the insert RESOLVES with an error (#107)', async () => {
    // PostgREST resolves with `{error}` on a failed write rather than throwing.
    // Until #107 the route never read it, so a dropped row was answered
    // `{success: true}` and nothing was logged. Telemetry must not fail the
    // student's request, so this stays a 200 — but an honest one.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      initWith({ data: null, error: { code: '42P01', message: 'relation does not exist' } });

      const res = await runRoute('post', '/analytics', { body: { event: 'rail_opened' } });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ success: false });
      expect(warn).toHaveBeenCalledWith(
        'AI analytics insert failed (non-critical):',
        'relation does not exist'
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('does not log or report failure when the insert succeeds', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      initWith({ data: null, error: null });

      const res = await runRoute('post', '/analytics', { body: { event: 'rail_opened' } });

      expect(res.body).toEqual({ success: true });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
