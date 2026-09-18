/**
 * `tutorStyle` reaches the prompt builder, and is logged — never the fragment.
 *
 * Two separate claims, and they fail differently. If the route stopped passing
 * the field through, the picker would go quiet: every answer would come back in
 * the default voice and nothing would look broken. If the log line carried the
 * fragment instead of the id, a prompt would end up in the log store, which is
 * the one thing this feature must not put there.
 *
 * Driven through `POST /message/stream` rather than `/message`: the blocking
 * path goes through `runSyncOrEnqueue`, and the queue is not the subject here.
 * The blocking path's own logging is asserted through the shape of
 * `logAIInference`'s entry, whose `tutorStyle` field is typed and covered by
 * `aiService.tutorStyles.test.ts` on the producing side.
 */
const companionChat = jest.fn();
const loggerInfo = jest.fn();

jest.mock('../services/aiService', () => ({
  companionChat: (...args: unknown[]) => companionChat(...args),
  summarizeGroupChat: jest.fn(),
}));
// The real builder is covered by `companionContext.tutorStyle.test.ts`; here it
// stands in for it, passing the request's style through exactly as it does.
jest.mock('../services/companionContext', () => ({
  buildTrustedCompanionContext: jest.fn(async (_layer: unknown, _user: unknown, ctx: any) => ({
    noteId: 'note-1',
    tutorStyle: ctx?.tutorStyle ?? 'default',
  })),
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
jest.mock('../utils/logger', () => ({
  logger: {
    info: (...args: unknown[]) => loggerInfo(...args),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { TUTOR_STYLES } from '@lantern/shared/ai';
import router, { initializeAICompanionRoutes } from './aiCompanion';
import * as aiCompanionData from '../services/data/aiCompanion';
import { bindDataModule } from '../services/data/testStub';

function makeClient() {
  const client = {
    from() {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: async () => ({ data: [], error: null }),
        insert(rows: any[]) {
          const result = {
            data: rows.map((row, i) => ({ id: `m${i}`, role: row.role })),
            error: null,
          };
          return { select: async () => result, then: (resolve: any) => resolve(result) };
        },
      };
      return builder;
    },
  };
  return client;
}

function streamHandler() {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === '/message/stream' && l.route?.methods?.post
  );
  if (!layer) throw new Error('route POST /message/stream not found');
  const handlers = layer.route.stack.map((s: any) => s.handle);
  return handlers[handlers.length - 1] as (req: any, res: any) => Promise<void>;
}

async function send(context: Record<string, unknown>) {
  initializeAICompanionRoutes({
    getClient: () => makeClient(),
    aiCompanion: bindDataModule(aiCompanionData, makeClient()),
  } as any);

  const res: any = {
    statusCode: 200,
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
    write() {
      return true;
    },
    end() {
      res.writableEnded = true;
    },
  };

  await streamHandler()({ user: { id: 'u1' }, body: { message: 'Explain this', context } }, res);
}

/** The context object `companionChat` was called with on the last turn. */
const lastChatContext = () =>
  companionChat.mock.calls[companionChat.mock.calls.length - 1]?.[2];

beforeEach(() => {
  companionChat.mockReset();
  companionChat.mockResolvedValue({
    reply: 'An answer.',
    actions: [],
    citations: null,
    guidedStep: null,
    tutorStyle: 'coach',
  });
  loggerInfo.mockClear();
});

describe('the style reaches the prompt builder', () => {
  it.each(TUTOR_STYLES.map((style) => [style.id] as const))('carries %s through', async (id) => {
    await send({ tutorStyle: id });
    expect(lastChatContext().tutorStyle).toBe(id);
  });

  it('carries the account default through when the turn names none', async () => {
    await send({});
    expect(lastChatContext().tutorStyle).toBe('default');
  });
});

describe('what is logged', () => {
  it('logs the id the reply was actually written in', async () => {
    await send({ tutorStyle: 'coach' });

    const call = loggerInfo.mock.calls.find(
      ([message]) => message === 'AI inference tutor style'
    );
    expect(call).toBeDefined();
    expect((call as any[])[1]).toEqual(
      expect.objectContaining({ tutorStyle: 'coach' })
    );
  });

  it('never logs the fragment text', async () => {
    await send({ tutorStyle: 'coach' });

    const logged = JSON.stringify(loggerInfo.mock.calls);
    for (const style of TUTOR_STYLES) {
      expect(logged).not.toContain(style.prompt);
    }
  });
});
