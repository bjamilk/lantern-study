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
import { runSyncOrEnqueue } from '../queue/enqueue';
import { sendAsyncJobAccepted } from '../queue/respondAsync';
import {
  buildTrustedCompanionContext,
  fetchAuthorizedGroupSummaryMessages,
} from '../services/companionContext';

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
      .select('id, role, content, actions, feedback, created_at')
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
    messageId?: string;
    rating?: 'up' | 'down' | null;
  };

  const cleared = rating === null;
  if (!messageId || (!cleared && rating !== 'up' && rating !== 'down')) {
    res.status(400).json({ error: 'messageId and rating (up|down|null) are required' });
    return;
  }

  try {
    const { data, error } = await supabaseService.getClient()
      .from('ai_companion_messages')
      .update({ feedback: cleared ? null : rating })
      .eq('id', messageId)
      .eq('user_id', userId)
      .eq('role', 'assistant')
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    res.json({ success: true, feedback: cleared ? null : rating });
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
  const userId = (req as any).user.id;
  const { groupId, groupName: clientGroupName } = req.body as {
    groupId?: string;
    groupName?: string;
    messages?: string[];
  };

  if (!groupId || typeof groupId !== 'string') {
    res.status(400).json({ error: 'groupId is required' });
    return;
  }

  try {
    const { groupName, messages } = await fetchAuthorizedGroupSummaryMessages(
      supabaseService,
      groupId,
      userId,
      50
    );

    if (messages.length === 0) {
      res.status(400).json({ error: 'No messages to summarize in this group' });
      return;
    }

    const displayName = groupName || clientGroupName || 'Group';
    const { summary, provider } = await summarizeGroupChat(messages, displayName);
    await logAIInference(supabaseService.getClient(), {
      userId,
      feature: 'companion-summarize-group',
      provider,
      requestId: (req as any).requestId,
    });
    res.json({ summary, provider });
  } catch (err: any) {
    const status = err?.statusCode === 403 ? 403 : 503;
    if (status === 403) {
      res.status(403).json({ error: 'You are not a member of this group' });
      return;
    }
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
    const outcome = await runSyncOrEnqueue(
      'ai.companion.message',
      { message: message.trim(), context: context || {} },
      userId,
      async () => {
        const { data: historyRows } = await supabaseService.getClient()
          .from('ai_companion_messages')
          .select('role, content')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(20);

        const history = (historyRows || []).reverse() as Array<{ role: 'user' | 'assistant'; content: string }>;
        const trustedContext = await buildTrustedCompanionContext(
          supabaseService,
          userId,
          context || {}
        );
        const { reply, actions, provider } = await companionChat(message.trim(), history, trustedContext);

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

        return { reply, actions, provider };
      }
    );

    if (outcome.mode === 'async') {
      sendAsyncJobAccepted(res, outcome.jobId);
      return;
    }

    res.json(outcome.result);
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
    const trustedContext = await buildTrustedCompanionContext(
      supabaseService,
      userId,
      context || {}
    );
    const { reply, actions } = await companionChat(message.trim(), history, trustedContext);

    const now = new Date().toISOString();
    const { data: inserted, error: insertError } = await supabaseService.getClient()
      .from('ai_companion_messages')
      .insert([
        { user_id: userId, role: 'user', content: message.trim(), created_at: now },
        { user_id: userId, role: 'assistant', content: reply, actions: actions.length ? actions : null, created_at: new Date(Date.now() + 1).toISOString() },
      ])
      .select('id, role');

    if (insertError) throw insertError;
    const assistantMessageId = inserted?.find((row) => row.role === 'assistant')?.id as string | undefined;
    const userMessageId = inserted?.find((row) => row.role === 'user')?.id as string | undefined;

    const tokens = reply.split(/(\s+)/);
    for (const token of tokens) {
      if (res.writableEnded) break;
      sendEvent({ token });
      await new Promise<void>(r => setTimeout(r, 18));
    }

    sendEvent({ done: true, actions, messageId: assistantMessageId, userMessageId });
    res.end();
  } catch (err: any) {
    console.error('Companion stream error:', err.message);
    sendEvent({ error: clientErrorMessage(err, 'AI companion is temporarily unavailable') });
    res.end();
  }
});

export default router;
