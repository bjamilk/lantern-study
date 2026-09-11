/**
 * GET /ai/usage is what the Usage & limits screen reads.
 *
 * Two things have to hold, or the screen lies. It must keep answering with the
 * global counter the badge already depends on (older clients read nothing
 * else), and it must additionally say what each per-feature cap is — because a
 * student refused by a feature cap while the badge still shows credits left has
 * no way to find out why.
 *
 * Reading usage must also cost nothing: the screen fetches on open.
 */
jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'usage-probe', permissions: ['ai'], isAdmin: false, credentialType: 'jwt' };
    next();
  },
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../services/supabase', () => ({ SupabaseService: class {} }));
jest.mock('../services/aiService', () => ({
  generateQuestionsFromNotes: jest.fn(),
  generateFlashcardsFromNotes: jest.fn(),
  generateLessonFromNotes: jest.fn(),
  explainAnswer: jest.fn(),
  getStudyRecommendations: jest.fn(),
  askTutor: jest.fn(),
  enhanceFlashcard: jest.fn(),
  generateListingDescription: jest.fn(),
  getProviderStatus: jest.fn(() => []),
  isTranscriptionConfigured: jest.fn(() => false),
}));

import express from 'express';
import http from 'http';
import { DEFAULT_AI_FEATURE_LIMITS } from '@lantern/shared/utils/aiUsage';
import { REFERRAL_BONUS_AI_USES_CAP } from '@lantern/shared/utils/aiCredits';
import { getAIUsage, resetAIUsageForUser } from '../middleware/aiRateLimit';

describe('GET /ai/usage', () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    const aiRoutes = require('./ai').default;
    const app = express();
    app.use(express.json());
    app.use('/api/v1/ai', aiRoutes);
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
    await resetAIUsageForUser('usage-probe');
  });

  async function readUsage() {
    const res = await fetch(`${base}/api/v1/ai/usage`);
    expect(res.status).toBe(200);
    return res.json() as Promise<{
      used: number;
      limit: number;
      resetsAt: string;
      bonusRemaining: number;
      bonusCap: number;
      features: Array<{ feature: string; used: number; limit: number }>;
    }>;
  }

  it('still answers with the global counter the badge reads', async () => {
    const body = await readUsage();
    expect(body.used).toBe(0);
    expect(body.limit).toBeGreaterThan(0);
    expect(typeof body.resetsAt).toBe('string');
  });

  it('reading usage does not itself spend a credit', async () => {
    await readUsage();
    expect((await getAIUsage('usage-probe')).used).toBe(0);
  });

  // Bonus uses are banked, earned by referral, and do not reset at midnight.
  // They are reported ALONGSIDE the daily counter rather than folded into
  // `limit`, because folding them in would make the reset countdown a lie:
  // the screen would promise that a banked use expires tonight.
  it('reports the banked bonus pool separately from the daily allowance', async () => {
    const body = await readUsage();
    expect(body.bonusRemaining).toBe(0);
    expect(body.bonusCap).toBe(REFERRAL_BONUS_AI_USES_CAP);
    // The daily counter is untouched by the bonus fields.
    expect(body.limit).toBeGreaterThan(0);
    expect(body.used).toBe(0);
  });

  it('answers 0 bonus — not an error — before the ledger migration is applied', async () => {
    // This suite runs with no supabase wired, which is the same shape the
    // server is in until 20260907140000 is hand-applied. The screen must load.
    const body = await readUsage();
    expect(body.bonusRemaining).toBe(0);
  });

  it('reports every per-feature cap, and never the global row twice', async () => {
    const body = await readUsage();
    const keys = body.features.map((f) => f.feature).sort();
    expect(keys).toEqual(Object.keys(DEFAULT_AI_FEATURE_LIMITS).sort());
    expect(keys).not.toContain('global');
    for (const row of body.features) {
      expect(row.limit).toBeGreaterThan(0);
      expect(row.used).toBe(0);
    }
  });
});
