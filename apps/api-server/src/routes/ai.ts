/**
 * AI Routes — endpoints for AI-powered study features
 */
import { Router, Request, Response } from 'express';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { aiRateLimit, aiRateLimitForFeature, aiRateLimitWithCost, getAIUsage } from '../middleware/aiRateLimit';
import { aiPostBurstRateLimit } from '../middleware/rateLimit';
import { requireAuthUserId } from '../utils/requestAuth';
import { clientErrorMessage } from '../utils/safeError';
import { AuthenticatedRequest } from '../types';
import { SupabaseService } from '../services/supabase';
import { logAIInference } from '../services/aiInferenceLog';
import { runSyncOrEnqueue } from '../queue/enqueue';
import { sendAsyncJobAccepted, stampAiChargeOnJob, aiChargeFromRes } from '../queue/respondAsync';
import { PublicError } from '../utils/safeError';
import {
  getStudyPackFactoryService,
  STUDY_PACK_DRAFT_CREDIT_COST,
} from '../services/studyPackFactory';
import {
  generateQuestionsFromNotes,
  generateFlashcardsFromNotes,
  explainAnswer,
  getStudyRecommendations,
  askTutor,
  enhanceFlashcard,
  generateListingDescription,
  getProviderStatus,
  isTranscriptionConfigured,
} from '../services/aiService';
import { handleValidationErrors, validateAIMessage } from '../middleware/validation';
import { normalizeStudyPerformanceData } from '../services/aiStudyRecommendationInput';
import { recordLearningEvent, surfaceFromRequest } from '../services/learningEvents';

const router = Router();
let supabaseService: SupabaseService;

export function initializeAIRoutes(supabase: SupabaseService): void {
  supabaseService = supabase;
}

async function recordInference(
  req: AuthenticatedRequest,
  feature: string,
  result: {
    provider?: string;
    model?: string;
    usage?: { promptTokens: number; completionTokens: number; cachedTokens: number };
  }
): Promise<void> {
  const userId = req.user?.id;
  if (!userId || !supabaseService) return;
  await logAIInference(supabaseService.getClient(), {
    userId,
    feature,
    provider: result.provider,
    model: result.model,
    // Cache replays arrive with no usage, so their rows record null tokens —
    // which is the truth: nothing was spent.
    usage: result.usage,
    requestId: (req as AuthenticatedRequest & { requestId?: string }).requestId,
  });
}

// Health / status — auth required in production
router.get('/health', authMiddleware, (_req: Request, res: Response) => {
  const status = getProviderStatus();
  const totalRemaining = status.reduce((sum, p) => sum + p.remainingToday, 0);
  const gemini = process.env.GEMINI_API_KEY ? 'on' : 'off';
  res.json({
    status: totalRemaining > 0 ? 'operational' : 'exhausted',
    totalRemainingToday: totalRemaining,
    // Boolean only — never leak key material.
    transcriptionConfigured: isTranscriptionConfigured(),
    gemini,
    handwritingOcr: gemini,
    providers: status,
  });
});

// Get user's AI usage — auth required
router.get('/usage', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const usage = await getAIUsage(userId);
  res.json(usage);
});

// All other routes require auth + per-user AI burst + daily AI quota
router.use(authMiddleware);
router.use(requirePermission('ai'));
router.use(aiPostBurstRateLimit);
router.use(validateAIMessage, handleValidationErrors);

// Generate questions — queue when BullMQ is on so the web process is not blocked (CONC-01).
router.post('/generate-questions', aiRateLimitForFeature('generate_questions'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { notes, count, difficulty, questionTypes, subject } = req.body;
    if (!notes || typeof notes !== 'string' || notes.trim().length < 50) {
      res.status(400).json({ error: 'Notes must be at least 50 characters.' });
      return;
    }
    const surface = surfaceFromRequest(req);
    const outcome = await runSyncOrEnqueue(
      'ai.generate.questions',
      // surface rides on the payload so the queued (async) path can emit the
      // same learning event from the worker.
      { notes, count, difficulty, questionTypes, subject, surface },
      userId,
      async () => {
        const generated = await generateQuestionsFromNotes(notes, { count, difficulty, questionTypes, subject });
        await recordInference(req, 'generate-questions', generated);
        if (userId && supabaseService) {
          await recordLearningEvent(supabaseService, {
            userId,
            eventType: 'question_generated',
            count: Array.isArray(generated.questions) ? generated.questions.length : 0,
            surface,
          });
        }
        return generated;
      }
    ,
      aiChargeFromRes(res)
    );
    if (outcome.mode === 'async') {
      sendAsyncJobAccepted(res, outcome.jobId);
      return;
    }
    res.json(outcome.result);
  } catch (error: any) {
    console.error('AI generate questions error:', error.message);
    res.status(503).json({ error: clientErrorMessage(error, 'Failed to generate questions.') });
  }
});

router.post('/generate-flashcards', aiRateLimitForFeature('generate_flashcards'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { notes, count, style } = req.body;
    if (!notes || typeof notes !== 'string' || notes.trim().length < 50) {
      res.status(400).json({ error: 'Notes must be at least 50 characters.' });
      return;
    }
    const surface = surfaceFromRequest(req);
    const outcome = await runSyncOrEnqueue(
      'ai.generate.flashcards',
      { notes, count, style, surface },
      userId,
      async () => {
        const generated = await generateFlashcardsFromNotes(notes, { count, style });
        await recordInference(req, 'generate-flashcards', generated);
        if (userId && supabaseService) {
          await recordLearningEvent(supabaseService, {
            userId,
            eventType: 'card_generated',
            count: Array.isArray(generated.flashcards) ? generated.flashcards.length : 0,
            surface,
          });
        }
        return generated;
      }
    ,
      aiChargeFromRes(res)
    );
    if (outcome.mode === 'async') {
      sendAsyncJobAccepted(res, outcome.jobId);
      return;
    }
    res.json(outcome.result);
  } catch (error: any) {
    console.error('AI generate flashcards error:', error.message);
    res.status(503).json({ error: clientErrorMessage(error, 'Failed to generate flashcards.') });
  }
});

router.post('/explain-answer', aiRateLimitForFeature('explain'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { question, userAnswer, correctAnswer, options } = req.body;
    if (!question || !correctAnswer) {
      res.status(400).json({ error: 'Question and correct answer required.' });
      return;
    }
    const outcome = await runSyncOrEnqueue(
      'ai.explain.answer',
      { question, userAnswer, correctAnswer, options },
      userId,
      async () => {
        const explained = await explainAnswer(question, userAnswer || '', correctAnswer, options);
        await recordInference(req, 'explain-answer', explained);
        return explained;
      }
    ,
      aiChargeFromRes(res)
    );
    if (outcome.mode === 'async') {
      sendAsyncJobAccepted(res, outcome.jobId);
      return;
    }
    res.json(outcome.result);
  } catch (error: any) {
    console.error('AI explain answer error:', error.message);
    res.status(503).json({ error: clientErrorMessage(error, 'Failed to explain.') });
  }
});

router.post('/study-recommendations', aiRateLimitForFeature('study_recommendations'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    // Normalise here so the sync path, the queued job payload and the cache key
    // all see the same honest shape (studyDaysThisWeek preferred, legacy
    // studyHoursThisWeek accepted for one release, flashcardAccuracy optional).
    const normalized = normalizeStudyPerformanceData(req.body?.performanceData);
    if (!normalized.ok) {
      res.status(400).json({ error: normalized.error });
      return;
    }
    const performanceData = normalized.data;
    const outcome = await runSyncOrEnqueue(
      'ai.study.recommendations',
      { performanceData },
      userId,
      async () => {
        const recommendations = await getStudyRecommendations(performanceData);
        await recordInference(req, 'study-recommendations', recommendations);
        return recommendations;
      }
    ,
      aiChargeFromRes(res)
    );
    if (outcome.mode === 'async') {
      sendAsyncJobAccepted(res, outcome.jobId);
      return;
    }
    res.json(outcome.result);
  } catch (error: any) {
    console.error('AI recommendations error:', error.message);
    res.status(503).json({ error: clientErrorMessage(error, 'Failed to get recommendations.') });
  }
});

router.post('/ask-tutor', aiRateLimitForFeature('study_plan'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { question, context } = req.body;
    if (!question || typeof question !== 'string' || question.trim().length < 5) {
      res.status(400).json({ error: 'Question must be at least 5 characters.' });
      return;
    }
    const outcome = await runSyncOrEnqueue(
      'ai.ask.tutor',
      { question, context },
      userId,
      async () => {
        const answer = await askTutor(question, context);
        await recordInference(req, 'ask-tutor', answer);
        return answer;
      }
    ,
      aiChargeFromRes(res)
    );
    if (outcome.mode === 'async') {
      sendAsyncJobAccepted(res, outcome.jobId);
      return;
    }
    res.json(outcome.result);
  } catch (error: any) {
    console.error('AI tutor error:', error.message);
    res.status(503).json({ error: clientErrorMessage(error, 'Failed to get answer.') });
  }
});

router.post('/enhance-flashcard', aiRateLimitForFeature('enhance_flashcard'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { front, back } = req.body;
    if (!front || !back) {
      res.status(400).json({ error: 'Front and back are required.' });
      return;
    }
    const outcome = await runSyncOrEnqueue(
      'ai.enhance.flashcard',
      { front, back },
      userId,
      async () => {
        const enhanced = await enhanceFlashcard(front, back);
        await recordInference(req, 'enhance-flashcard', enhanced);
        return enhanced;
      }
    ,
      aiChargeFromRes(res)
    );
    if (outcome.mode === 'async') {
      sendAsyncJobAccepted(res, outcome.jobId);
      return;
    }
    res.json(outcome.result);
  } catch (error: any) {
    console.error('AI enhance flashcard error:', error.message);
    res.status(503).json({ error: clientErrorMessage(error, 'Failed to enhance flashcard.') });
  }
});

// Generate marketplace listing description from listing details
router.post('/generate-listing-description', aiRateLimitForFeature('listing_description'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, category, subcategory, price, condition, courseCode, isbn, edition, bedrooms, furnished, distanceToCampus } = req.body;
    if (!title || typeof title !== 'string' || title.trim().length < 3) {
      res.status(400).json({ error: 'Title must be at least 3 characters.' });
      return;
    }
    const toStr = (value: unknown): string | undefined =>
      typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 200) : undefined;
    const result = await generateListingDescription({
      title: title.trim().slice(0, 200),
      category: toStr(category),
      subcategory: toStr(subcategory),
      price: toStr(price),
      condition: toStr(condition),
      courseCode: toStr(courseCode),
      isbn: toStr(isbn),
      edition: toStr(edition),
      bedrooms: toStr(bedrooms),
      furnished: toStr(furnished),
      distanceToCampus: toStr(distanceToCampus),
    });
    await recordInference(req, 'generate-listing-description', result);
    res.json(result);
  } catch (error: any) {
    console.error('AI listing description error:', error.message);
    res.status(503).json({ error: clientErrorMessage(error, 'Failed to generate description.') });
  }
});

// ============================================================
// STUDY PRODUCT FACTORY (Phase 2 · H) — turn notes into a sellable study pack
// ============================================================

// POST /api/v1/ai/study-pack/draft - one credit charge; generates a draft (async)
router.post(
  '/study-pack/draft',
  requirePermission('ai'),
  aiPostBurstRateLimit,
  aiRateLimitWithCost(() => STUDY_PACK_DRAFT_CREDIT_COST, { label: 'Turn into a Study Product' }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      const factory = getStudyPackFactoryService(supabaseService);
      const { noteIds, folderId, courseId, title } = req.body || {};
      const { draftId } = await factory.createDraft(userId, {
        noteIds: Array.isArray(noteIds) ? noteIds.map(String) : undefined,
        folderId: folderId ?? null,
        courseId: courseId ?? null,
        title: typeof title === 'string' ? title : undefined,
      });

      const outcome = await runSyncOrEnqueue(
        'ai.studyPack.generate',
        { draftId },
        userId,
        async () => factory.generate(draftId),
        aiChargeFromRes(res),
      );

      if (outcome.mode === 'async') {
        await factory.attachJobId(draftId, outcome.jobId);
        // 202 with the draftId so the client can poll either the job or the draft.
        stampAiChargeOnJob(res, outcome.jobId);
        res.status(202).json({
          success: true,
          draftId,
          jobId: outcome.jobId,
          status: 'queued',
          pollUrl: `/api/v1/jobs/${outcome.jobId}`,
        });
        return;
      }
      // Sync fallback (BullMQ disabled): the draft is already ready.
      const draft = await factory.getDraft(userId, draftId);
      res.status(201).json({ success: true, draftId, draft });
    } catch (error: any) {
      if (error instanceof PublicError) {
        res.status(400).json({ error: error.message });
        return;
      }
      console.error('Study pack draft error:', error?.message);
      res.status(503).json({ error: clientErrorMessage(error, 'Could not start the study pack.') });
    }
  },
);

// GET /api/v1/ai/study-pack/semester-proposals — Phase 4 · S. Does not charge.
router.get('/study-pack/semester-proposals', async (req: AuthenticatedRequest, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const academicYear =
    typeof req.query.academicYear === 'string' ? req.query.academicYear : undefined;
  const { academicYear: year, proposals } = await getStudyPackFactoryService(supabaseService).proposeSemester(
    userId,
    academicYear,
  );
  const usage = await getAIUsage(userId);
  const creditsRemaining = Math.max(0, usage.limit - usage.used);
  const maxSelectable = Math.floor(creditsRemaining / STUDY_PACK_DRAFT_CREDIT_COST);
  res.json({
    success: true,
    data: {
      academicYear: year,
      creditCostPerPack: STUDY_PACK_DRAFT_CREDIT_COST,
      creditsUsed: usage.used,
      creditsLimit: usage.limit,
      creditsRemaining,
      maxSelectable,
      proposals,
    },
  });
});

// GET /api/v1/ai/study-pack/drafts - the caller's drafts (excludes published)
router.get('/study-pack/drafts', async (req: AuthenticatedRequest, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  const data = await getStudyPackFactoryService(supabaseService).listDrafts(userId);
  res.json({ success: true, data });
});

// GET /api/v1/ai/study-pack/drafts/:id - one draft with full content
router.get('/study-pack/drafts/:id', async (req: AuthenticatedRequest, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  try {
    const draft = await getStudyPackFactoryService(supabaseService).getDraft(userId, req.params.id);
    res.json({ success: true, data: draft });
  } catch (error: any) {
    if (error instanceof PublicError) {
      res.status(404).json({ error: error.message });
      return;
    }
    throw error;
  }
});

// DELETE /api/v1/ai/study-pack/drafts/:id
router.delete('/study-pack/drafts/:id', async (req: AuthenticatedRequest, res: Response) => {
  const userId = requireAuthUserId(req, res);
  if (!userId) return;
  await getStudyPackFactoryService(supabaseService).deleteDraft(userId, req.params.id);
  res.json({ success: true });
});

export default router;
