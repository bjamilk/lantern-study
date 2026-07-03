/**
 * AI Routes — endpoints for AI-powered study features
 */
import { Router, Request, Response } from 'express';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { aiRateLimit, getAIUsage } from '../middleware/aiRateLimit';
import { aiPostBurstRateLimit } from '../middleware/rateLimit';
import { requireAuthUserId } from '../utils/requestAuth';
import { clientErrorMessage } from '../utils/safeError';
import { AuthenticatedRequest } from '../types';
import { SupabaseService } from '../services/supabase';
import { logAIInference } from '../services/aiInferenceLog';
import { runSyncOrEnqueue } from '../queue/enqueue';
import { sendAsyncJobAccepted } from '../queue/respondAsync';
import {
  generateQuestionsFromNotes,
  generateFlashcardsFromNotes,
  explainAnswer,
  getStudyRecommendations,
  askTutor,
  enhanceFlashcard,
  getProviderStatus,
} from '../services/aiService';
import { handleValidationErrors, validateAIMessage } from '../middleware/validation';

const router = Router();
let supabaseService: SupabaseService;

export function initializeAIRoutes(supabase: SupabaseService): void {
  supabaseService = supabase;
}

async function recordInference(
  req: AuthenticatedRequest,
  feature: string,
  result: { provider?: string; model?: string }
): Promise<void> {
  const userId = req.user?.id;
  if (!userId || !supabaseService) return;
  await logAIInference(supabaseService.getClient(), {
    userId,
    feature,
    provider: result.provider,
    model: result.model,
    requestId: (req as AuthenticatedRequest & { requestId?: string }).requestId,
  });
}

// Health / status — auth required in production
router.get('/health', authMiddleware, (_req: Request, res: Response) => {
  const status = getProviderStatus();
  const totalRemaining = status.reduce((sum, p) => sum + p.remainingToday, 0);
  res.json({
    status: totalRemaining > 0 ? 'operational' : 'exhausted',
    totalRemainingToday: totalRemaining,
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
router.use(aiRateLimit);
router.use(validateAIMessage, handleValidationErrors);

// Generate questions from notes
router.post('/generate-questions', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { notes, count, difficulty, questionTypes, subject } = req.body;
    if (!notes || typeof notes !== 'string' || notes.trim().length < 50) {
      res.status(400).json({ error: 'Notes must be at least 50 characters.' });
      return;
    }
    const outcome = await runSyncOrEnqueue(
      'ai.generate.questions',
      { notes, count, difficulty, questionTypes, subject },
      userId,
      async () => {
        const result = await generateQuestionsFromNotes(notes, { count, difficulty, questionTypes, subject });
        await recordInference(req, 'generate-questions', result);
        return result;
      }
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

router.post('/generate-flashcards', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { notes, count, style } = req.body;
    if (!notes || typeof notes !== 'string' || notes.trim().length < 50) {
      res.status(400).json({ error: 'Notes must be at least 50 characters.' });
      return;
    }
    const outcome = await runSyncOrEnqueue(
      'ai.generate.flashcards',
      { notes, count, style },
      userId,
      async () => {
        const result = await generateFlashcardsFromNotes(notes, { count, style });
        await recordInference(req, 'generate-flashcards', result);
        return result;
      }
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

router.post('/explain-answer', async (req: AuthenticatedRequest, res: Response) => {
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
        const result = await explainAnswer(question, userAnswer || '', correctAnswer, options);
        await recordInference(req, 'explain-answer', result);
        return result;
      }
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

router.post('/study-recommendations', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { performanceData } = req.body;
    if (!performanceData) {
      res.status(400).json({ error: 'Performance data required.' });
      return;
    }
    const outcome = await runSyncOrEnqueue(
      'ai.study.recommendations',
      { performanceData },
      userId,
      async () => {
        const result = await getStudyRecommendations(performanceData);
        await recordInference(req, 'study-recommendations', result);
        return result;
      }
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

router.post('/ask-tutor', async (req: AuthenticatedRequest, res: Response) => {
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
        const result = await askTutor(question, context);
        await recordInference(req, 'ask-tutor', result);
        return result;
      }
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

router.post('/enhance-flashcard', async (req: AuthenticatedRequest, res: Response) => {
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
        const result = await enhanceFlashcard(front, back);
        await recordInference(req, 'enhance-flashcard', result);
        return result;
      }
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

export default router;
