/**
 * AI Companion Routes — persistent, context-aware "Lantern" study companion
 */
import { Router, Request, Response } from 'express';
import { aiRateLimit, aiRateLimitForFeature } from '../middleware/aiRateLimit';
import { aiPostBurstRateLimit } from '../middleware/rateLimit';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { companionChat, summarizeGroupChat, CompanionContext } from '../services/aiService';
import { SupabaseService } from '../services/supabase';
import { logAIInference } from '../services/aiInferenceLog';
import { clientErrorMessage } from '../utils/safeError';
import { handleValidationErrors, validateAICompanionMessage } from '../middleware/validation';

let supabaseService: SupabaseService;

export function initializeAICompanionRoutes(svc: SupabaseService) {
  supabaseService = svc;
}

const router = Router();

router.use(authMiddleware as any);
router.use(requirePermission('ai'));

router.get('/history', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    const { data, error } = await supabaseService.getClient()
      .from('ai_companion_messages')
      .select('id, role, content, actions, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) throw error;
    res.json({ messages: data || [] });
  } catch (err: any) {
    console.error('Companion history error:', err.message);
    res.status(500).json({ error: 'Failed to fetch conversation history' });
  }
});

router.delete('/history', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    const { error } = await supabaseService.getClient()
      .from('ai_companion_messages')
      .delete()
      .eq('user_id', userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    console.error('Companion clear history error:', err.message);
    res.status(500).json({ error: 'Failed to clear conversation history' });
  }
});

router.post('/feedback', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { messageId, rating } = req.body as {
    messageId: string;
    rating: 'up' | 'down';
  };

  if (!messageId || !['up', 'down'].includes(rating)) {
    res.status(400).json({ error: 'messageId and rating (up|down) are required' });
    return;
  }

  try {
    await supabaseService.getClient()
      .from('ai_companion_messages')
      .update({ feedback: rating })
      .eq('id', messageId)
      .eq('user_id', userId);

    res.json({ success: true });
  } catch (err: any) {
    console.error('Companion feedback error:', err.message);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

router.post('/analytics', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { event, metadata } = req.body as {
    event: string;
    metadata?: Record<string, unknown>;
  };

  if (!event) {
    res.status(400).json({ error: 'event is required' });
    return;
  }

  try {
    await supabaseService.getClient()
      .from('ai_analytics')
      .insert({ user_id: userId, event, metadata: metadata || {}, created_at: new Date().toISOString() });

    res.json({ success: true });
  } catch (err: any) {
    console.warn('AI analytics insert failed (non-critical):', err.message);
    res.json({ success: false });
  }
});

router.post('/summarize-group', aiPostBurstRateLimit, aiRateLimit, async (req: Request, res: Response) => {
  const { messages, groupName } = req.body as {
    messages: string[];
    groupName: string;
  };

  if (!Array.isArray(messages) || !groupName) {
    res.status(400).json({ error: 'messages array and groupName are required' });
    return;
  }

  try {
    const { summary, provider } = await summarizeGroupChat(messages, groupName);
    const userId = (req as any).user.id;
    await logAIInference(supabaseService.getClient(), {
      userId,
      feature: 'companion-summarize-group',
      provider,
      requestId: (req as any).requestId,
    });
    res.json({ summary, provider });
  } catch (err: any) {
    console.error('Group summarize error:', err.message);
    res.status(503).json({ error: clientErrorMessage(err, 'Failed to summarize group chat') });
  }
});

router.use(aiPostBurstRateLimit);
router.use(aiRateLimitForFeature('companion'));

router.post('/message', validateAICompanionMessage, handleValidationErrors, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { message, context } = req.body as {
    message: string;
    context?: CompanionContext;
  };

  if (!message || typeof message !== 'string' || message.trim().length < 1) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  try {
    const { data: historyRows } = await supabaseService.getClient()
      .from('ai_companion_messages')
      .select('role, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    const history = (historyRows || []).reverse() as Array<{ role: 'user' | 'assistant'; content: string }>;
    const { reply, actions, provider } = await companionChat(message.trim(), history, context || {});

    await logAIInference(supabaseService.getClient(), {
      userId,
      feature: 'companion-message',
      provider,
      requestId: (req as any).requestId,
    });

    const now = new Date().toISOString();
    await supabaseService.getClient()
      .from('ai_companion_messages')
      .insert([
        { user_id: userId, role: 'user', content: message.trim(), created_at: now },
        { user_id: userId, role: 'assistant', content: reply, actions: actions.length ? actions : null, created_at: new Date(Date.now() + 1).toISOString() },
      ]);

    res.json({ reply, actions, provider });
  } catch (err: any) {
    console.error('Companion message error:', err.message);
    res.status(503).json({ error: clientErrorMessage(err, 'AI companion is temporarily unavailable') });
  }
});

router.post('/message/stream', validateAICompanionMessage, handleValidationErrors, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { message, context } = req.body as {
    message: string;
    context?: CompanionContext;
  };

  if (!message || typeof message !== 'string' || message.trim().length < 1) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data: Record<string, unknown>) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { data: historyRows } = await supabaseService.getClient()
      .from('ai_companion_messages')
      .select('role, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    const history = (historyRows || []).reverse() as Array<{ role: 'user' | 'assistant'; content: string }>;
    const { reply, actions } = await companionChat(message.trim(), history, context || {});

    const now = new Date().toISOString();
    await supabaseService.getClient()
      .from('ai_companion_messages')
      .insert([
        { user_id: userId, role: 'user', content: message.trim(), created_at: now },
        { user_id: userId, role: 'assistant', content: reply, actions: actions.length ? actions : null, created_at: new Date(Date.now() + 1).toISOString() },
      ]);

    const tokens = reply.split(/(\s+)/);
    for (const token of tokens) {
      if (res.writableEnded) break;
      sendEvent({ token });
      await new Promise<void>(r => setTimeout(r, 18));
    }

    sendEvent({ done: true, actions });
    res.end();
  } catch (err: any) {
    console.error('Companion stream error:', err.message);
    sendEvent({ error: clientErrorMessage(err, 'AI companion is temporarily unavailable') });
    res.end();
  }
});

export default router;
