/**
 * POST /ai/study-recommendations request contract.
 *
 * The coach used to forward `performanceData` untouched, and both clients
 * filled `studyHoursThisWeek` with a DAY STREAK and `flashcardAccuracy` with
 * TEST accuracy. The route now normalises the body: it prefers the honest
 * `studyDaysThisWeek`, still accepts the legacy `studyHoursThisWeek` from old
 * mobile builds (read as days, capped at 7), and passes `flashcardAccuracy`
 * through only when the client actually had reviewed cards.
 */
jest.mock('../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../middleware/aiRateLimit', () => ({
  aiRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  aiRateLimitForFeature: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  aiRateLimitWithCost: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAIUsage: jest.fn(),
}));
jest.mock('../middleware/rateLimit', () => ({
  aiPostBurstRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../middleware/validation', () => ({
  handleValidationErrors: (_req: unknown, _res: unknown, next: () => void) => next(),
  validateAIMessage: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../queue/enqueue', () => ({
  runSyncOrEnqueue: jest.fn(
    async (_name: string, _payload: unknown, _userId: string | undefined, syncFn: () => Promise<unknown>) => ({
      mode: 'sync',
      result: await syncFn(),
    })
  ),
}));
jest.mock('../queue/respondAsync', () => ({
  aiChargeFromRes: jest.fn(() => undefined),
  sendAsyncJobAccepted: jest.fn(),
}));
jest.mock('../services/aiInferenceLog', () => ({ logAIInference: jest.fn(async () => {}) }));
jest.mock('../services/aiService', () => ({
  generateQuestionsFromNotes: jest.fn(),
  generateFlashcardsFromNotes: jest.fn(),
  explainAnswer: jest.fn(),
  getStudyRecommendations: jest.fn(),
  askTutor: jest.fn(),
  enhanceFlashcard: jest.fn(),
  generateListingDescription: jest.fn(),
  getProviderStatus: jest.fn(() => ({ providers: [] })),
  isTranscriptionConfigured: jest.fn(() => false),
}));

import router from './ai';
import { getStudyRecommendations } from '../services/aiService';
import { runSyncOrEnqueue } from '../queue/enqueue';

type Handler = (req: any, res: any) => Promise<void>;

function findStudyRecommendationsHandler(): Handler {
  const layer = (router as any).stack.find(
    (l: any) => l.route && l.route.path === '/study-recommendations' && l.route.methods.post
  );
  if (!layer) throw new Error('study-recommendations route not mounted');
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle as Handler;
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

const RECOMMENDATION = {
  recommendations: {
    weakTopics: ['Anatomy'],
    suggestedCards: [],
    suggestedQuestions: [],
    studyTip: 'Review Anatomy.',
    estimatedMinutes: 20,
  },
  provider: 'test',
};

const scores = [{ topic: 'Anatomy', score: 45, date: '2026-08-22T00:00:00.000Z' }];

beforeEach(() => {
  jest.clearAllMocks();
  (getStudyRecommendations as jest.Mock).mockResolvedValue(RECOMMENDATION);
});

describe('POST /ai/study-recommendations', () => {
  const handler = findStudyRecommendationsHandler();

  it('accepts studyDaysThisWeek and forwards flashcardAccuracy when present', async () => {
    const res = mockRes();
    await handler(
      {
        user: { id: 'u1' },
        body: {
          performanceData: {
            recentScores: scores,
            flashcardAccuracy: [{ topic: 'Anatomy deck', correctRate: 0.4 }],
            studyDaysThisWeek: 3,
          },
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(RECOMMENDATION);
    expect(getStudyRecommendations).toHaveBeenCalledTimes(1);
    expect((getStudyRecommendations as jest.Mock).mock.calls[0][0]).toStrictEqual({
      recentScores: scores,
      flashcardAccuracy: [{ topic: 'Anatomy deck', correctRate: 0.4 }],
      studyDaysThisWeek: 3,
    });
    // The async job payload carries the same normalised shape.
    expect((runSyncOrEnqueue as jest.Mock).mock.calls[0][1]).toStrictEqual({
      performanceData: {
        recentScores: scores,
        flashcardAccuracy: [{ topic: 'Anatomy deck', correctRate: 0.4 }],
        studyDaysThisWeek: 3,
      },
    });
  });

  it('still accepts the legacy studyHoursThisWeek from old builds, read as days capped at 7', async () => {
    const res = mockRes();
    await handler(
      {
        user: { id: 'u1' },
        body: { performanceData: { recentScores: scores, flashcardAccuracy: [], studyHoursThisWeek: 9 } },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    const forwarded = (getStudyRecommendations as jest.Mock).mock.calls[0][0];
    expect(forwarded).toStrictEqual({ recentScores: scores, studyDaysThisWeek: 7 });
    expect(forwarded).not.toHaveProperty('studyHoursThisWeek');
  });

  it('omits flashcardAccuracy entirely when the client had no reviewed cards', async () => {
    const res = mockRes();
    await handler(
      { user: { id: 'u1' }, body: { performanceData: { recentScores: scores, studyDaysThisWeek: 0 } } },
      res
    );

    expect(res.statusCode).toBe(200);
    const forwarded = (getStudyRecommendations as jest.Mock).mock.calls[0][0];
    expect(forwarded).toStrictEqual({ recentScores: scores, studyDaysThisWeek: 0 });
    expect(forwarded).not.toHaveProperty('flashcardAccuracy');
  });

  it('rejects a body with neither day field, and a missing performanceData', async () => {
    const noDays = mockRes();
    await handler({ user: { id: 'u1' }, body: { performanceData: { recentScores: scores } } }, noDays);
    expect(noDays.statusCode).toBe(400);
    expect(noDays.body).toEqual({ error: 'performanceData.studyDaysThisWeek is required.' });

    const missing = mockRes();
    await handler({ user: { id: 'u1' }, body: {} }, missing);
    expect(missing.statusCode).toBe(400);
    expect(missing.body).toEqual({ error: 'Performance data required.' });

    expect(getStudyRecommendations).not.toHaveBeenCalled();
    expect(runSyncOrEnqueue).not.toHaveBeenCalled();
  });
});
