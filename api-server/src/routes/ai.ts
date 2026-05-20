/**
 * AI Routes — endpoints for AI-powered study features
 */
import { Router, Request, Response } from 'express';
import { aiRateLimit, getAIUsage } from '../middleware/aiRateLimit';
import {
  generateQuestionsFromNotes,
  generateFlashcardsFromNotes,
  explainAnswer,
  getStudyRecommendations,
  askTutor,
  enhanceFlashcard,
  getProviderStatus,
} from '../services/aiService';

const router = Router();

// Health / status — no auth required
router.get('/health', (_req: Request, res: Response) => {
  const status = getProviderStatus();
  const totalRemaining = status.reduce((sum, p) => sum + p.remainingToday, 0);
  res.json({
    status: totalRemaining > 0 ? 'operational' : 'exhausted',
    totalRemainingToday: totalRemaining,
    providers: status,
  });
});

// Get user's AI usage (no rate limit needed for this read-only endpoint)
router.get('/usage', (req: Request, res: Response) => {
  const userId = (req.query.userId as string) || 'anonymous';
  const usage = getAIUsage(userId);
  res.json(usage);
});

// All other routes require AI rate limit (userId passed in body/query)
router.use(aiRateLimit);

// Generate questions from notes
router.post('/generate-questions', async (req: Request, res: Response) => {
  try {
    const { notes, count, difficulty, questionTypes, subject } = req.body;
    if (!notes || typeof notes !== 'string' || notes.trim().length < 50) {
      res.status(400).json({ error: 'Notes must be at least 50 characters.' });
      return;
    }
    const result = await generateQuestionsFromNotes(notes, { count, difficulty, questionTypes, subject });
    res.json(result);
  } catch (error: any) {
    console.error('AI generate questions error:', error.message);
    res.status(503).json({ error: error.message || 'Failed to generate questions.' });
  }
});

// Generate flashcards from notes
router.post('/generate-flashcards', async (req: Request, res: Response) => {
  try {
    const { notes, count, style } = req.body;
    if (!notes || typeof notes !== 'string' || notes.trim().length < 50) {
      res.status(400).json({ error: 'Notes must be at least 50 characters.' });
      return;
    }
    const result = await generateFlashcardsFromNotes(notes, { count, style });
    res.json(result);
  } catch (error: any) {
    console.error('AI generate flashcards error:', error.message);
    res.status(503).json({ error: error.message || 'Failed to generate flashcards.' });
  }
});

// Explain an answer
router.post('/explain-answer', async (req: Request, res: Response) => {
  try {
    const { question, userAnswer, correctAnswer, options } = req.body;
    if (!question || !correctAnswer) {
      res.status(400).json({ error: 'Question and correct answer required.' });
      return;
    }
    const result = await explainAnswer(question, userAnswer || '', correctAnswer, options);
    res.json(result);
  } catch (error: any) {
    console.error('AI explain answer error:', error.message);
    res.status(503).json({ error: error.message || 'Failed to explain.' });
  }
});

// Study recommendations
router.post('/study-recommendations', async (req: Request, res: Response) => {
  try {
    const { performanceData } = req.body;
    if (!performanceData) {
      res.status(400).json({ error: 'Performance data required.' });
      return;
    }
    const result = await getStudyRecommendations(performanceData);
    res.json(result);
  } catch (error: any) {
    console.error('AI recommendations error:', error.message);
    res.status(503).json({ error: error.message || 'Failed to get recommendations.' });
  }
});

// AI tutor chat
router.post('/ask-tutor', async (req: Request, res: Response) => {
  try {
    const { question, context } = req.body;
    if (!question || typeof question !== 'string' || question.trim().length < 5) {
      res.status(400).json({ error: 'Question must be at least 5 characters.' });
      return;
    }
    const result = await askTutor(question, context);
    res.json(result);
  } catch (error: any) {
    console.error('AI tutor error:', error.message);
    res.status(503).json({ error: error.message || 'Failed to get answer.' });
  }
});

// Enhance a flashcard
router.post('/enhance-flashcard', async (req: Request, res: Response) => {
  try {
    const { front, back } = req.body;
    if (!front || !back) {
      res.status(400).json({ error: 'Front and back are required.' });
      return;
    }
    const result = await enhanceFlashcard(front, back);
    res.json(result);
  } catch (error: any) {
    console.error('AI enhance flashcard error:', error.message);
    res.status(503).json({ error: error.message || 'Failed to enhance flashcard.' });
  }
});

export default router;
