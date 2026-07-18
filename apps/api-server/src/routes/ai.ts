/**
 * AI Routes — endpoints for AI-powered study features
 */
import { Router, Request, Response } from 'express';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { aiRateLimit, aiRateLimitForFeature, getAIUsage } from '../middleware/aiRateLimit';
import { aiPostBurstRateLimit } from '../middleware/rateLimit';
import { requireAuthUserId } from '../utils/requestAuth';
import { clientErrorMessage } from '../utils/safeError';
import { AuthenticatedRequest } from '../types';
import { SupabaseService } from '../services/supabase';
import { logAIInference } from '../services/aiInferenceLog';
import { runNoteAiSync } from '../queue/enqueue';
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
router.use(validateAIMessage, handleValidationErrors);

// Generate questions from notes — sync for interactive UI (same pattern as note quiz/flashcards).
router.post('/generate-questions', aiRateLimitForFeature('generate_questions'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { notes, count, difficulty, questionTypes, subject } = req.body;
    if (!notes || typeof notes !== 'string' || notes.trim().length < 50) {
      res.status(400).json({ error: 'Notes must be at least 50 characters.' });
      return;
    }
    const result = await runNoteAiSync(async () => {
      const generated = await generateQuestionsFromNotes(notes, { count, difficulty, questionTypes, subject });
      await recordInference(req, 'generate-questions', generated);
      return generated;
    });
    res.json(result);
  } catch (error: any) {
    console.error('AI generate questions error:', error.message);
    res.status(503).json({ error: clientErrorMessage(error, 'Failed to generate questions.') });
  }
});

router.post('/generate-flashcards', aiRateLimitForFeature('generate_flashcards'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { notes, count, style } = req.body;
    if (!notes || typeof notes !== 'string' || notes.trim().length < 50) {
      res.status(400).json({ error: 'Notes must be at least 50 characters.' });
      return;
    }
    const result = await runNoteAiSync(async () => {
      const generated = await generateFlashcardsFromNotes(notes, { count, style });
      await recordInference(req, 'generate-flashcards', generated);
      return generated;
    });
    res.json(result);
  } catch (error: any) {
    console.error('AI generate flashcards error:', error.message);
    res.status(503).json({ error: clientErrorMessage(error, 'Failed to generate flashcards.') });
  }
});

router.post('/explain-answer', aiRateLimitForFeature('explain'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { question, userAnswer, correctAnswer, options } = req.body;
    if (!question || !correctAnswer) {
      res.status(400).json({ error: 'Question and correct answer required.' });
      return;
    }
    const result = await runNoteAiSync(async () => {
      const explained = await explainAnswer(question, userAnswer || '', correctAnswer, options);
      await recordInference(req, 'explain-answer', explained);
      return explained;
    });
    res.json(result);
  } catch (error: any) {
    console.error('AI explain answer error:', error.message);
    res.status(503).json({ error: clientErrorMessage(error, 'Failed to explain.') });
  }
});

router.post('/study-recommendations', aiRateLimitForFeature('study_recommendations'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { performanceData } = req.body;
    if (!performanceData) {
      res.status(400).json({ error: 'Performance data required.' });
      return;
    }
    const result = await runNoteAiSync(async () => {
      const recommendations = await getStudyRecommendations(performanceData);
      await recordInference(req, 'study-recommendations', recommendations);
      return recommendations;
    });
    res.json(result);
  } catch (error: any) {
    console.error('AI recommendations error:', error.message);
    res.status(503).json({ error: clientErrorMessage(error, 'Failed to get recommendations.') });
  }
});

router.post('/ask-tutor', aiRateLimitForFeature('study_plan'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { question, context } = req.body;
    if (!question || typeof question !== 'string' || question.trim().length < 5) {
      res.status(400).json({ error: 'Question must be at least 5 characters.' });
      return;
    }
    const result = await runNoteAiSync(async () => {
      const answer = await askTutor(question, context);
      await recordInference(req, 'ask-tutor', answer);
      return answer;
    });
    res.json(result);
  } catch (error: any) {
    console.error('AI tutor error:', error.message);
    res.status(503).json({ error: clientErrorMessage(error, 'Failed to get answer.') });
  }
});

router.post('/enhance-flashcard', aiRateLimitForFeature('enhance_flashcard'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { front, back } = req.body;
    if (!front || !back) {
      res.status(400).json({ error: 'Front and back are required.' });
      return;
    }
    const result = await runNoteAiSync(async () => {
      const enhanced = await enhanceFlashcard(front, back);
      await recordInference(req, 'enhance-flashcard', enhanced);
      return enhanced;
    });
    res.json(result);
  } catch (error: any) {
    console.error('AI enhance flashcard error:', error.message);
    res.status(503).json({ error: clientErrorMessage(error, 'Failed to enhance flashcard.') });
  }
});

export default router;
