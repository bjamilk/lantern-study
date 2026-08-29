/**
 * Opening the Lantern AI chat must not spend an AI credit.
 *
 * Only /message and /message/stream are billable. The reads the panel fires on
 * open — history, the conversation list, and creating an empty conversation —
 * are registered ABOVE `router.use(aiRateLimitForFeature('companion'))`, and
 * they have to stay there. This mounts both routers exactly as server.ts does
 * (`/api/v1/ai` swallows `/api/v1/ai/companion/*` first) so a re-order or a new
 * route added below the middleware fails here instead of on a user's quota.
 */
jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'probe-user', permissions: ['ai'], isAdmin: false, credentialType: 'jwt' };
    next();
  },
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../services/companionConversations', () => ({
  createCompanionConversation: jest.fn(async () => ({ id: 'c1', title: 'New chat', note_context_id: null, created_at: '', updated_at: '' })),
  ensureConversationTitle: jest.fn(),
  findLatestConversationForNoteScope: jest.fn(async () => null),
  getOwnedConversation: jest.fn(async () => null),
  listCompanionConversations: jest.fn(async () => []),
  parseCompanionUuid: (v: any) => (typeof v === 'string' && v ? v : null),
  resolveConversationForSend: jest.fn(),
  touchConversation: jest.fn(),
}));

jest.mock('../services/supabase', () => ({
  SupabaseService: class {},
}));

jest.mock('../services/aiService', () => ({
  companionChat: jest.fn(),
  summarizeGroupChat: jest.fn(),
}));

import express from 'express';
import { getAIUsage, resetAIUsageForUser } from '../middleware/aiRateLimit';

import http from 'http';

describe('opening the companion must not consume credits', () => {
  let app: express.Express;
  let server: http.Server;
  let base: string;

  async function call(method: string, path: string, body?: unknown) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return { status: res.status, headers, text: await res.text() };
  }

  beforeAll(() => {
    const aiRoutes = require('./ai').default;
    const companionRoutes = require('./aiCompanion');
    companionRoutes.initializeAICompanionRoutes({
      getClient: () => ({
        from: () => ({
          select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
        }),
      }),
    } as any);
    app = express();
    app.use(express.json());
    // Exact mounting order from server.ts:439-440
    app.use('/api/v1/ai', aiRoutes);
    app.use('/api/v1/ai/companion', companionRoutes.default);
  });

  beforeAll(async () => {
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

  beforeEach(async () => {
    await resetAIUsageForUser('probe-user');
  });

  it('GET /companion/history does not charge', async () => {
    expect((await call('GET', '/api/v1/ai/companion/history')).status).toBe(200);
    const usage = await getAIUsage('probe-user');
    expect(usage.used).toBe(0);
  });

  it('GET /companion/conversations does not charge', async () => {
    expect((await call('GET', '/api/v1/ai/companion/conversations')).status).toBe(200);
    const usage = await getAIUsage('probe-user');
    expect(usage.used).toBe(0);
  });

  it('POST /companion/conversations does not charge', async () => {
    expect((await call('POST', '/api/v1/ai/companion/conversations', {})).status).toBe(201);
    const usage = await getAIUsage('probe-user');
    expect(usage.used).toBe(0);
  });
});
