/**
 * AI Companion Routes — persistent, context-aware "Lantern" study companion
 */
import { Router, Request, Response } from 'express';
import { aiRateLimit, aiRateLimitForFeature, refundFeatureAiCredit } from '../middleware/aiRateLimit';
import { aiPostBurstRateLimit } from '../middleware/rateLimit';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { companionChat, summarizeGroupChat, CompanionContext } from '../services/aiService';
import { SupabaseService } from '../services/supabase';
import { logAIInference } from '../services/aiInferenceLog';
import { clientErrorMessage } from '../utils/safeError';
import { handleValidationErrors, validateAICompanionMessage } from '../middleware/validation';
import { runSyncOrEnqueue } from '../queue/enqueue';
import { sendAsyncJobAccepted, aiChargeFromRes } from '../queue/respondAsync';
import {
  buildTrustedCompanionContext,
  fetchAuthorizedGroupSummaryMessages,
} from '../services/companionContext';
import { companionStreamGate } from '../utils/concurrencyGate';
import {
  createCompanionConversation,
  ensureConversationTitle,
  findLatestConversationForNoteScope,
  getOwnedConversation,
  listCompanionConversations,
  parseCompanionUuid,
  resolveConversationForSend,
  touchConversation,
} from '../services/companionConversations';

let supabaseService: SupabaseService;

export function initializeAICompanionRoutes(svc: SupabaseService) {
  supabaseService = svc;
}

const router = Router();

router.use(authMiddleware as any);
router.use(requirePermission('ai'));

type CompanionRequestContext = CompanionContext & {
  conversationId?: string;
  newConversation?: boolean;
};

function parseNoteContextId(value: unknown): string | null {
  return parseCompanionUuid(value);
}

router.get('/conversations', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    const conversations = await listCompanionConversations(
      supabaseService.getClient(),
      userId
    );
    res.json({ conversations });
  } catch (err: any) {
    console.error('Companion conversations list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

router.post('/conversations', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const noteContextId = parseNoteContextId(
    (req.body as { noteContextId?: string } | undefined)?.noteContextId
  );
  try {
    // Only attach a note the user owns (same trust boundary as message send).
    let trustedNoteId: string | null = null;
    if (noteContextId) {
      const trusted = await buildTrustedCompanionContext(supabaseService, userId, {
        noteId: noteContextId,
      });
      trustedNoteId = trusted.noteId || null;
    }
    const row = await createCompanionConversation(
      supabaseService.getClient(),
      userId,
      trustedNoteId
    );
    res.status(201).json({
      conversation: {
        id: row.id,
        title: row.title || 'New chat',
        preview: '',
        noteContextId: row.note_context_id,
        noteTitle: null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (err: any) {
    console.error('Companion create conversation error:', err.message);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

router.get('/history', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const conversationId = parseCompanionUuid(req.query.conversationId);
  const noteContextId = parseNoteContextId(req.query.noteContextId);
  try {
    const client = supabaseService.getClient();
    let resolvedConversationId = conversationId;
    let resolvedNoteContextId: string | null = noteContextId;

    if (resolvedConversationId) {
      const owned = await getOwnedConversation(client, userId, resolvedConversationId);
      if (!owned) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      resolvedNoteContextId = owned.note_context_id;
    } else {
      const latest = await findLatestConversationForNoteScope(client, userId, noteContextId);
      resolvedConversationId = latest?.id ?? null;
      if (latest) resolvedNoteContextId = latest.note_context_id;
    }

    if (!resolvedConversationId) {
      res.json({
        messages: [],
        conversationId: null,
        noteContextId: resolvedNoteContextId,
      });
      return;
    }

    const { data, error } = await client
      .from('ai_companion_messages')
      .select('id, role, content, actions, feedback, created_at, note_context_id, conversation_id')
      .eq('user_id', userId)
      .eq('conversation_id', resolvedConversationId)
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) throw error;
    res.json({
      messages: data || [],
      conversationId: resolvedConversationId,
      noteContextId: resolvedNoteContextId,
    });
  } catch (err: any) {
    console.error('Companion history error:', err.message);
    res.status(500).json({ error: 'Failed to fetch conversation history' });
  }
});

router.delete('/history', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const conversationId = parseCompanionUuid(
    req.query.conversationId ??
      (req.body as { conversationId?: string } | undefined)?.conversationId
  );
  const noteContextId = parseNoteContextId(
    req.query.noteContextId ?? (req.body as { noteContextId?: string } | undefined)?.noteContextId
  );
  try {
    const client = supabaseService.getClient();

    if (conversationId) {
      const owned = await getOwnedConversation(client, userId, conversationId);
      if (!owned) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      const { error } = await client
        .from('ai_companion_conversations')
        .delete()
        .eq('id', conversationId)
        .eq('user_id', userId);
      if (error) throw error;
      res.json({ success: true, conversationId, noteContextId: owned.note_context_id });
      return;
    }

    // Legacy: clear latest (or all matching) note-scoped messages + their conversations.
    const latest = await findLatestConversationForNoteScope(client, userId, noteContextId);
    if (latest) {
      const { error } = await client
        .from('ai_companion_conversations')
        .delete()
        .eq('id', latest.id)
        .eq('user_id', userId);
      if (error) throw error;
      res.json({ success: true, conversationId: latest.id, noteContextId });
      return;
    }

    res.json({ success: true, conversationId: null, noteContextId });
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

async function persistCompanionExchange(params: {
  userId: string;
  message: string;
  reply: string;
  actions: unknown[];
  conversationId: string;
  noteContextId: string | null;
  selectIds?: boolean;
}) {
  const {
    userId,
    message,
    reply,
    actions,
    conversationId,
    noteContextId,
    selectIds = false,
  } = params;
  const client = supabaseService.getClient();
  const now = new Date().toISOString();
  const rows = [
    {
      user_id: userId,
      role: 'user' as const,
      content: message,
      created_at: now,
      note_context_id: noteContextId,
      conversation_id: conversationId,
    },
    {
      user_id: userId,
      role: 'assistant' as const,
      content: reply,
      actions: actions.length ? actions : null,
      created_at: new Date(Date.now() + 1).toISOString(),
      note_context_id: noteContextId,
      conversation_id: conversationId,
    },
  ];

  if (selectIds) {
    const { data, error } = await client
      .from('ai_companion_messages')
      .insert(rows)
      .select('id, role');
    if (error) throw error;
    await touchConversation(client, userId, conversationId);
    return (data || []) as Array<{ id: string; role: string }>;
  }

  const { error } = await client.from('ai_companion_messages').insert(rows);
  if (error) throw error;
  await touchConversation(client, userId, conversationId);
  return [];
}

router.post('/message', validateAICompanionMessage, handleValidationErrors, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { message, context } = req.body as {
    message: string;
    context?: CompanionRequestContext;
  };

  if (!message || typeof message !== 'string' || message.trim().length < 1) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  try {
    const outcome = await runSyncOrEnqueue(
      'ai.companion.message',
      {
        message: message.trim(),
        context: context || {},
        conversationId: parseCompanionUuid(context?.conversationId),
        newConversation: context?.newConversation === true,
      },
      userId,
      async () => {
        const trustedContext = await buildTrustedCompanionContext(
          supabaseService,
          userId,
          context || {}
        );
        const threadNoteId = trustedContext.noteId || null;
        const client = supabaseService.getClient();
        const conversation = await resolveConversationForSend(
          client,
          userId,
          parseCompanionUuid(context?.conversationId),
          threadNoteId,
          { forceNew: context?.newConversation === true }
        );
        // Conversation's note scope wins over client once the thread exists.
        const effectiveNoteId = conversation.note_context_id ?? threadNoteId;

        const { data: historyRows } = await client
          .from('ai_companion_messages')
          .select('role, content')
          .eq('user_id', userId)
          .eq('conversation_id', conversation.id)
          .order('created_at', { ascending: false })
          .limit(20);

        const history = (historyRows || []).reverse() as Array<{
          role: 'user' | 'assistant';
          content: string;
        }>;
        const { reply, actions, provider } = await companionChat(
          message.trim(),
          history,
          { ...trustedContext, noteId: effectiveNoteId || undefined }
        );

        await logAIInference(supabaseService.getClient(), {
          userId,
          feature: 'companion-message',
          provider,
          requestId: (req as any).requestId,
        });

        await persistCompanionExchange({
          userId,
          message: message.trim(),
          reply,
          actions,
          conversationId: conversation.id,
          noteContextId: effectiveNoteId,
        });
        await ensureConversationTitle(
          client,
          userId,
          conversation,
          message.trim()
        );

        return { reply, actions, provider, conversationId: conversation.id };
      }
    ,
      aiChargeFromRes(res)
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
    context?: CompanionRequestContext;
  };

  if (!message || typeof message !== 'string' || message.trim().length < 1) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  if (!companionStreamGate.tryAcquire()) {
    res.setHeader('Retry-After', '5');
    res.status(503).json({
      error: 'Too many concurrent companion streams on this instance. Please retry shortly.',
    });
    return;
  }

  // Default 0: deliver tokens without artificial delay (avoids holding sockets for minutes).
  const tokenDelayMs = Math.max(
    0,
    parseInt(process.env.COMPANION_STREAM_TOKEN_DELAY_MS || '0', 10) || 0
  );

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data: Record<string, unknown>) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const trustedContext = await buildTrustedCompanionContext(
      supabaseService,
      userId,
      context || {}
    );
    const threadNoteId = trustedContext.noteId || null;
    const client = supabaseService.getClient();
    const conversation = await resolveConversationForSend(
      client,
      userId,
      parseCompanionUuid(context?.conversationId),
      threadNoteId,
      { forceNew: context?.newConversation === true }
    );
    const effectiveNoteId = conversation.note_context_id ?? threadNoteId;

    const { data: historyRows } = await client
      .from('ai_companion_messages')
      .select('role, content')
      .eq('user_id', userId)
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(20);

    const history = (historyRows || []).reverse() as Array<{
      role: 'user' | 'assistant';
      content: string;
    }>;
    const { reply, actions } = await companionChat(message.trim(), history, {
      ...trustedContext,
      noteId: effectiveNoteId || undefined,
    });

    const inserted = await persistCompanionExchange({
      userId,
      message: message.trim(),
      reply,
      actions,
      conversationId: conversation.id,
      noteContextId: effectiveNoteId,
      selectIds: true,
    });
    await ensureConversationTitle(client, userId, conversation, message.trim());

    const assistantMessageId = inserted.find((row) => row.role === 'assistant')?.id;
    const userMessageId = inserted.find((row) => row.role === 'user')?.id;

    const tokens = reply.split(/(\s+)/);
    for (const token of tokens) {
      if (res.writableEnded) break;
      sendEvent({ token });
      if (tokenDelayMs > 0) {
        await new Promise<void>((r) => setTimeout(r, tokenDelayMs));
      }
    }

    sendEvent({
      done: true,
      actions,
      messageId: assistantMessageId,
      userMessageId,
      conversationId: conversation.id,
    });
    res.end();
  } catch (err: any) {
    console.error('Companion stream error:', err.message);
    // SSE failures end as HTTP 200, so the feature middleware's non-2xx
    // auto-refund never fires — refund here: the user got no reply, and
    // without this every failed stream still burned a daily credit.
    void refundFeatureAiCredit(userId, 'companion').catch((refundErr) => {
      console.error('Companion stream credit refund failed:', refundErr);
    });
    sendEvent({ error: clientErrorMessage(err, 'AI companion is temporarily unavailable') });
    res.end();
  } finally {
    companionStreamGate.release();
  }
});

export default router;
