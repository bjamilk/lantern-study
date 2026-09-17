/**
 * The streaming companion must both SEND its citations and STORE them.
 *
 * Live, source chips never appeared: the answer rendered "(Excerpt 1)" as
 * prose and the DOM held no chip at all. The SSE `done` frame did carry
 * `citations` — what it did not do was persist them, because
 * `ai_companion_messages` had no column for it, so the rail lost every chip
 * the moment it reloaded its thread (which it does on mount). Both halves are
 * pinned here, plus the pre-migration path: a database without the column must
 * still save the exchange rather than fail the whole answer.
 */
const companionChat = jest.fn();

jest.mock('../services/aiService', () => ({
  companionChat: (...args: unknown[]) => companionChat(...args),
  summarizeGroupChat: jest.fn(),
}));
jest.mock('../services/companionContext', () => ({
  buildTrustedCompanionContext: jest.fn(async () => ({ noteId: 'note-1' })),
  fetchAuthorizedGroupSummaryMessages: jest.fn(async () => []),
}));
jest.mock('../services/companionConversations', () => ({
  createCompanionConversation: jest.fn(),
  ensureConversationTitle: jest.fn(async () => {}),
  findLatestConversationForNoteScope: jest.fn(),
  getOwnedConversation: jest.fn(),
  listCompanionConversations: jest.fn(async () => []),
  parseCompanionUuid: (v: unknown) => (typeof v === 'string' ? v : null),
  resolveConversationForSend: jest.fn(async () => ({ id: 'conv-1', note_context_id: 'note-1' })),
  touchConversation: jest.fn(async () => {}),
}));
jest.mock('../middleware/aiRateLimit', () => ({
  aiRateLimit: (_req: any, _res: any, next: any) => next(),
  aiRateLimitForFeature: () => (_req: any, _res: any, next: any) => next(),
  refundFeatureAiCredit: jest.fn(async () => {}),
}));

import router, { initializeAICompanionRoutes } from './aiCompanion';
import * as aiCompanionData from '../services/data/aiCompanion';
import { bindDataModule } from '../services/data/testStub';

/**
 * The companion's message queries moved into `services/data/aiCompanion.ts`
 * (lane R2), so the route reaches them through the layer. This suite drives a
 * FAKE POSTGREST CLIENT rather than stubbing those functions, so it binds the
 * real module to that client — the chain this suite asserts on is unchanged.
 */
const initRoutes = (client: unknown) =>
  initializeAICompanionRoutes({
    getClient: () => client,
    aiCompanion: bindDataModule(aiCompanionData, client),
  } as any);

const CITATION = {
  noteId: '99999999-8888-4777-8666-555555555555',
  noteTitle: 'Pancreatitis PPT Student',
  excerpts: [1, 3],
};

/** A column-missing rejection, exactly as PostgREST reports one. */
const MISSING_COLUMN = {
  code: 'PGRST204',
  message: "Could not find the 'citations' column of 'ai_companion_messages' in the schema cache",
};

/**
 * A Supabase stub thin enough to drive the route and honest about what it was
 * asked to write. `insertFails` lets one test play a database that has not had
 * the citations migration applied yet.
 */
function makeClient(opts: { insertFailsOnCitations?: boolean } = {}) {
  const inserted: any[][] = [];
  const client = {
    from() {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: async () => ({ data: [], error: null }),
        insert(rows: any[]) {
          inserted.push(rows);
          const hasCitations = rows.some((row) => 'citations' in row);
          const fail = opts.insertFailsOnCitations && hasCitations;
          const result = fail
            ? { data: null, error: MISSING_COLUMN }
            : { data: rows.map((row, i) => ({ id: `m${i}`, role: row.role })), error: null };
          return {
            select: async () => result,
            then: (resolve: any) => resolve(result),
          };
        },
      };
      return builder;
    },
  };
  return { client, inserted };
}

/** The route body — the last handler on the layer, after the validators. */
function streamHandler() {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === '/message/stream' && l.route?.methods?.post,
  );
  if (!layer) throw new Error('route POST /message/stream not found');
  const handlers = layer.route.stack.map((s: any) => s.handle);
  return handlers[handlers.length - 1] as (req: any, res: any) => Promise<void>;
}

/** Drive one stream and return every SSE frame it wrote. */
async function runStream() {
  const frames: any[] = [];
  const res: any = {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    setHeader() {},
    flushHeaders() {},
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json() {
      return res;
    },
    write(chunk: string) {
      const body = String(chunk).replace(/^data: /, '').trim();
      if (body) frames.push(JSON.parse(body));
      return true;
    },
    end() {
      res.writableEnded = true;
    },
  };

  await streamHandler()(
    { user: { id: 'u1' }, body: { message: 'Summarise this material', context: {} } },
    res,
  );
  return frames;
}

describe('companion stream citations', () => {
  beforeEach(() => {
    companionChat.mockReset();
    companionChat.mockResolvedValue({
      reply: 'Pancreatitis is pancreatic inflammation. (Excerpt 1)',
      actions: [],
      citations: CITATION,
    });
  });

  it('sends citations on the done frame', async () => {
    const { client } = makeClient();
    initRoutes(client);

    const done = (await runStream()).find((frame) => frame.done);
    expect(done).toBeDefined();
    expect(done.citations).toEqual(CITATION);
    expect(done.conversationId).toBe('conv-1');
  });

  it('stores the citations on the assistant row, so a reloaded thread keeps its chips', async () => {
    const { client, inserted } = makeClient();
    initRoutes(client);

    await runStream();

    const rows = inserted[inserted.length - 1];
    const assistant = rows.find((row: any) => row.role === 'assistant');
    expect(assistant.citations).toEqual(CITATION);
    // The question was not read out of anything; only the answer is cited.
    expect(rows.find((row: any) => row.role === 'user').citations ?? null).toBeNull();
  });

  it('sends null rather than an empty citation when the answer is ungrounded', async () => {
    companionChat.mockResolvedValue({ reply: 'A general answer', actions: [], citations: null });
    const { client, inserted } = makeClient();
    initRoutes(client);

    const done = (await runStream()).find((frame) => frame.done);
    expect(done.citations).toBeNull();
    expect(
      inserted[inserted.length - 1].find((row: any) => row.role === 'assistant').citations,
    ).toBeNull();
  });

  it('still saves the exchange on a database without the citations column', async () => {
    const { client, inserted } = makeClient({ insertFailsOnCitations: true });
    initRoutes(client);

    const frames = await runStream();

    // The retry drops the column rather than losing the answer...
    expect(inserted).toHaveLength(2);
    expect('citations' in inserted[0].find((row: any) => row.role === 'assistant')).toBe(true);
    expect('citations' in inserted[1].find((row: any) => row.role === 'assistant')).toBe(false);
    // ...and the student still gets the reply, with its live chips.
    expect(frames.some((frame) => frame.error)).toBe(false);
    expect(frames.find((frame) => frame.done).citations).toEqual(CITATION);
  });
});
