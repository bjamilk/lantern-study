/**
 * AI Companion Routes — persistent, context-aware "Lantern" study companion
 */
/**
 * AI companion routes — conversations, message send, streaming, attachments.
 *
 * Purpose
 * - Backs the "Lantern" companion rail: threaded conversations optionally
 *   scoped to a note, a blocking and a streaming send path, photo attachments
 *   the model can read, per-message feedback, and a group-chat summariser.
 *
 * Exports
 * - Default router and `initializeAICompanionRoutes(svc)`, called from
 *   `server.ts` at boot.
 *
 * Mount path
 * - `/api/v1/ai/companion`.
 *
 * Auth mode
 * - `authMiddleware` for the whole router (`router.use`), followed by
 *   `requirePermission('ai')`. Nothing here is reachable unauthenticated.
 *
 * Rate-limit tier — three layers, and the ORDER of declaration matters
 * - `aiPostBurstRateLimit` — short-window burst brake.
 * - `aiRateLimit` — the generic per-user AI allowance, applied to
 *   `POST /summarize-group` only.
 * - `aiRateLimitForFeature('companion')` — the companion's own daily counter
 *   plus a global credit reservation, installed by the `router.use` pair
 *   partway down the file. Every route DECLARED BELOW that point pays a
 *   companion credit; every route declared above it does not. `/attachments`
 *   sits above deliberately (see its own comment), and the read-only
 *   conversation, history, feedback and analytics routes are free.
 *
 * Credit charge points
 * - `POST /attachments` charges `NOTE_OCR_CREDIT_COST` explicitly via
 *   `chargeAiCreditsDetailed`, and refunds it with `refundAiCredits` when no
 *   attachment was produced.
 * - `POST /message` and `POST /message/stream` pay one companion feature credit
 *   through the middleware. The blocking path passes `aiChargeFromRes(res)` into
 *   `runSyncOrEnqueue` so an enqueued job inherits the charge already reserved.
 *   The streaming path refunds by hand: SSE responses end as HTTP 200, so the
 *   middleware's non-2xx auto-refund never fires.
 *
 * Trust boundary — two deliberate defences worth keeping
 * - `buildTrustedCompanionContext` ignores the study and entitlement facts the
 *   client sends and RE-DERIVES them server-side from rows this user owns. The
 *   same applies to photos: only attachment ids are believed, and the
 *   transcripts are read back out of the table, so a forged `extractedText`
 *   cannot reach the prompt.
 * - `context.tutorStyle` (F2) is a UI choice, not a claim about the student's
 *   data, so it is honoured — but only through `normalizeTutorStyleId`, a
 *   four-id allowlist, and the fragment it selects is appended AFTER every
 *   safety, honesty and grounding rule. A request that omits it falls back to
 *   the student's stored `settings.tutorStyle`. A style costs no extra credit:
 *   it is a different prompt, not a different model or a second call.
 * - `filterCompanionActions` in `services/aiService.ts` allowlists the action
 *   types a reply may contain. Model output therefore cannot name an action the
 *   server did not already intend to offer, and takes no privileged action of
 *   its own.
 *
 * Error-mapping convention
 * - 400 for a missing or unusable body, 404 for a conversation or message this
 *   account does not own, 403 for non-membership on the group summariser, 503
 *   for AI unavailability and for a missing migration, 500 for a database
 *   failure. Every client-facing message goes through `clientErrorMessage`, and
 *   the analytics insert answers `{ success: false }` at 200 rather than
 *   failing a request over telemetry.
 *
 * What it touches
 * - Supabase tables `ai_companion_conversations`, `ai_companion_messages`,
 *   `ai_analytics` and the companion image-attachment table; Redis through the
 *   AI rate limiters and credit pools; the AI providers via
 *   `services/aiService` (`companionChat`, `summarizeGroupChat`); BullMQ via
 *   `runSyncOrEnqueue`; the inference log.
 *
 * Migration tolerance
 * - `ai_companion_messages.citations` is applied by hand
 *   (`20260912090000_companion_message_citations.sql`). Reads and writes both
 *   retry without the column when PostgREST reports it missing, so an exchange
 *   is still saved — without its source chips — rather than lost.
 */
import { Router, Request, Response } from 'express';
import {
  NOTE_OCR_CREDIT_COST,
  aiRateLimit,
  aiRateLimitForFeature,
  applyGlobalUsageHeaders,
  chargeAiCreditsDetailed,
  refundAiCredits,
  refundFeatureAiCredit,
} from '../middleware/aiRateLimit';
import { aiPostBurstRateLimit, uploadBurstRateLimit } from '../middleware/rateLimit';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { companionChat, summarizeGroupChat, CompanionContext } from '../services/aiService';
import type { DataLayer } from '../services/data';
import { logAIInference } from '../services/aiInferenceLog';
import { logger } from '../utils/logger';
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
import {
  CompanionImageTableMissingError,
  createCompanionImageAttachment,
  collectCompanionImageAttachmentIds,
  loadTrustedCompanionImages,
} from '../services/companionImageAttachments';

let dataLayer: DataLayer;


export function initializeAICompanionRoutes(layer: DataLayer) {
  dataLayer = layer;
}

const router = Router();

/**
 * What a stored companion message is worth reading back. `citations` is the
 * new one: without it a reloaded rail showed the answer as prose with
 * "(Excerpt 1)" left in the sentence and no chip to tap.
 */
const HISTORY_COLUMNS_WITHOUT_CITATIONS =
  'id, role, content, actions, feedback, created_at, note_context_id, conversation_id';
const HISTORY_COLUMNS = `${HISTORY_COLUMNS_WITHOUT_CITATIONS}, citations`;

router.use(authMiddleware as any);
router.use(requirePermission('ai'));

// `imageAttachments` is re-declared: what a client sends is a list of ids,
// what companionChat receives is the server-read transcript of each one.
type CompanionRequestContext = Omit<CompanionContext, 'imageAttachments'> & {
  conversationId?: string;
  newConversation?: boolean;
  /**
   * Photos the student attached to this turn. Only the ids are believed: the
   * transcripts are read back out of the table for rows this user owns, so a
   * forged `imageAttachments[].extractedText` cannot reach the prompt.
   */
  imageAttachmentIds?: unknown;
  imageAttachments?: Array<{ attachmentId?: unknown }>;
};

/** Ids from either shape the clients may send. Shared with the queue processor. */
const collectImageAttachmentIds = (context?: CompanionRequestContext): string[] =>
  collectCompanionImageAttachmentIds(context);

function parseNoteContextId(value: unknown): string | null {
  return parseCompanionUuid(value);
}

// ---------------------------------------------------------------------------
// Conversations and history — free of AI credits
// ---------------------------------------------------------------------------
// Declared above the `aiRateLimitForFeature('companion')` mount, so reading,
// creating an empty thread, clearing one, rating a reply and logging analytics
// cost nothing. Every read is scoped by `user_id`, and a conversation id the
// caller does not own answers 404 before any row is touched.

router.get('/conversations', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    const conversations = await listCompanionConversations(
      dataLayer.getClient(),
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
      const trusted = await buildTrustedCompanionContext(dataLayer, userId, {
        noteId: noteContextId,
      });
      trustedNoteId = trusted.noteId || null;
    }
    const row = await createCompanionConversation(
      dataLayer.getClient(),
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
    const client = dataLayer.getClient();
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

    const readHistory = (columns: string) =>
      dataLayer.aiCompanion.listConversationMessages(
        userId,
        resolvedConversationId as string,
        columns
      );

    let { data, error } = await readHistory(HISTORY_COLUMNS);
    // Before the citations migration is applied the column is simply absent;
    // the thread is still worth returning, just without its chips.
    if (error && isMissingCitationsColumn(error)) {
      ({ data, error } = await readHistory(HISTORY_COLUMNS_WITHOUT_CITATIONS));
    }

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
    const client = dataLayer.getClient();

    if (conversationId) {
      const owned = await getOwnedConversation(client, userId, conversationId);
      if (!owned) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      const { error } = await dataLayer.aiCompanion.deleteConversation(userId, conversationId);
      if (error) throw error;
      res.json({ success: true, conversationId, noteContextId: owned.note_context_id });
      return;
    }

    // Legacy: clear latest (or all matching) note-scoped messages + their conversations.
    const latest = await findLatestConversationForNoteScope(client, userId, noteContextId);
    if (latest) {
      const { error } = await dataLayer.aiCompanion.deleteConversation(userId, latest.id);
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
    const { data, error } = await dataLayer.aiCompanion.setMessageFeedback(
      userId,
      messageId,
      cleared ? null : rating
    );

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
    // FIXED (#107): the returned `error` was never read. PostgREST RESOLVES
    // with `{error}` on a failed write rather than throwing, so the catch below
    // could not fire for a database failure and a dropped row was answered
    // `{success: true}` with nothing logged. Telemetry still never fails the
    // student's request — it stays a 200 — but the answer and the log are honest.
    const { error } = await dataLayer.aiCompanion.recordAnalyticsEvent(
      userId,
      event,
      metadata || {},
      new Date().toISOString()
    );
    if (error) {
      console.warn('AI analytics insert failed (non-critical):', error.message ?? error);
      res.json({ success: false });
      return;
    }

    res.json({ success: true });
  } catch (err: any) {
    // A THROWN failure (the client itself blew up, e.g. a network error).
    console.warn('AI analytics insert failed (non-critical):', err.message);
    res.json({ success: false });
  }
});

// ---------------------------------------------------------------------------
// Group chat summary
// ---------------------------------------------------------------------------
// The only route on the generic `aiRateLimit` tier rather than the companion
// feature counter. Membership is not taken from the request:
// `fetchAuthorizedGroupSummaryMessages` resolves the group AND checks this
// user's membership, and the client-supplied `messages[]` in the body is
// ignored entirely — the messages summarised are the ones the server read.

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
      dataLayer,
      groupId,
      userId,
      50
    );

    if (messages.length === 0) {
      res.status(400).json({ error: 'No messages to summarize in this group' });
      return;
    }

    const displayName = groupName || clientGroupName || 'Group';
    // FIXED (F7a, verified F10): the marker here was stale.
    // `summarizeGroupChat` no longer joins the other members' messages raw —
    // `buildGroupChatMessagesBlock` (services/aiService.ts) strips control
    // characters, caps each line, defangs a typed BEGIN/END marker and wraps the
    // whole span in an UNTRUSTED fence the system prompt names as data. This is
    // the one cross-user prompt-injection surface in the AI stack, and
    // `aiService.groupSummaryFencing.test.ts` pins the fence.
    const { summary, provider } = await summarizeGroupChat(messages, displayName);
    await logAIInference(dataLayer.getClient(), {
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

/**
 * Attach a photo to the next companion turn.
 *
 * Declared ABOVE the companion feature limiter on purpose: reading a picture
 * is not a chat turn, and charging it against the companion counter as well as
 * the OCR credits would bill one upload twice. It charges exactly what the
 * note photo path charges to read an image — NOTE_OCR_CREDIT_COST — and gives
 * it back when the read never produced an attachment.
 */
router.post('/attachments', uploadBurstRateLimit, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { base64Data, fileName, contentType } = req.body as {
    base64Data?: unknown;
    fileName?: unknown;
    contentType?: unknown;
  };

  if (typeof base64Data !== 'string' || !base64Data.trim()) {
    res.status(400).json({ error: 'base64Data is required' });
    return;
  }

  // Strip a data: URL prefix — the web file picker produces one.
  const payload = base64Data.replace(/^data:[^;]+;base64,/, '');
  let buffer: Buffer;
  try {
    buffer = Buffer.from(payload, 'base64');
  } catch {
    res.status(400).json({ error: 'Image data could not be read' });
    return;
  }
  if (buffer.length === 0) {
    res.status(400).json({ error: 'Image data could not be read' });
    return;
  }

  const charge = await chargeAiCreditsDetailed(userId, NOTE_OCR_CREDIT_COST, 'Reading an image');
  if (!charge.ok) {
    res.status(429).json(charge.denial);
    return;
  }

  try {
    const attachment = await createCompanionImageAttachment({
      layer: dataLayer,
      userId,
      buffer,
      fileName: typeof fileName === 'string' ? fileName : 'image.jpg',
      contentType: typeof contentType === 'string' ? contentType : null,
    });
    await applyGlobalUsageHeaders(res, userId);
    res.status(201).json({
      attachmentId: attachment.attachmentId,
      url: attachment.url,
      fileName: attachment.fileName,
      extractedText: attachment.extractedText,
      wordCount: attachment.wordCount,
      creditsCharged: charge.credits,
    });
  } catch (err: any) {
    // Nothing was attached, so nothing should have been paid for.
    await refundAiCredits(userId, charge.credits, charge.pool).catch(() => {});
    await applyGlobalUsageHeaders(res, userId).catch(() => {});

    if (err instanceof CompanionImageTableMissingError) {
      console.error('Companion image attachment table missing:', err.message);
      res.status(503).json({ error: err.message });
      return;
    }
    // The upload validators throw a student-readable reason (wrong type, too
    // large, truncated bytes). `status` is how fileValidation marks those, and
    // the size/type checks in noteFiles carry the same readable sentence — a
    // bad photo is the student's to fix, not a server fault.
    const message = String(err?.message || 'Failed to attach image');
    const isValidation =
      err?.status === 400 ||
      /Invalid file type|too large|appears truncated|supported image|content does not match|Could not read image metadata/i.test(
        message
      );
    if (isValidation) {
      res.status(400).json({ error: message });
      return;
    }
    console.error('Companion image attachment error:', message);
    res.status(500).json({ error: 'Failed to attach image' });
  }
});

// ---------------------------------------------------------------------------
// Everything below this line pays a companion AI credit
// ---------------------------------------------------------------------------
// These two `router.use` calls apply only to routes DECLARED AFTER them.
// Moving a handler across this boundary silently changes what it costs, so
// placement here is load-bearing, not stylistic.
router.use(aiPostBurstRateLimit);
router.use(aiRateLimitForFeature('companion'));

/**
 * True when PostgREST is telling us the `citations` column is not there yet.
 *
 * `20260912090000_companion_message_citations.sql` is applied by hand like
 * every other migration here, so the API has to run correctly on both sides of
 * it: before it lands, the exchange is still saved — without its chips —
 * rather than the whole answer failing to persist.
 */
function isMissingCitationsColumn(error: any): boolean {
  const code = String(error?.code || '');
  const text = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return (code === 'PGRST204' || code === '42703') && text.includes('citations');
}

async function persistCompanionExchange(params: {
  userId: string;
  message: string;
  reply: string;
  actions: unknown[];
  citations?: unknown;
  conversationId: string;
  noteContextId: string | null;
  selectIds?: boolean;
}) {
  const {
    userId,
    message,
    reply,
    actions,
    citations = null,
    conversationId,
    noteContextId,
    selectIds = false,
  } = params;
  const client = dataLayer.getClient();
  const now = new Date().toISOString();
  // `user_id` is stamped by the data functions below, from the `userId`
  // argument, so a row cannot be written under another student's id.
  const rows = [
    {
      role: 'user' as const,
      content: message,
      created_at: now,
      note_context_id: noteContextId,
      conversation_id: conversationId,
    },
    {
      role: 'assistant' as const,
      content: reply,
      actions: actions.length ? actions : null,
      // Which excerpts of which note this answer was read out of. Without this
      // the chips were live-only: reload the rail and the same answer came
      // back as prose with "(Excerpt 1)" stranded in the sentence and nothing
      // to tap, which is how it looked in production every time.
      citations: citations ?? null,
      created_at: new Date(Date.now() + 1).toISOString(),
      note_context_id: noteContextId,
      conversation_id: conversationId,
    },
  ];

  /** The same rows with `citations` stripped, for a database without it. */
  const rowsWithoutCitations = rows.map(({ citations: _drop, ...rest }) => rest);

  if (selectIds) {
    let { data, error } = await dataLayer.aiCompanion.insertConversationMessagesReturningIds(
      userId,
      rows
    );
    if (error && isMissingCitationsColumn(error)) {
      console.warn(
        'ai_companion_messages.citations missing — saved without chips (apply 20260912090000_companion_message_citations.sql)'
      );
      ({ data, error } = await dataLayer.aiCompanion.insertConversationMessagesReturningIds(
        userId,
        rowsWithoutCitations
      ));
    }
    if (error) throw error;
    await touchConversation(client, userId, conversationId);
    return (data || []) as Array<{ id: string; role: string }>;
  }

  let { error } = await dataLayer.aiCompanion.insertConversationMessages(userId, rows);
  if (error && isMissingCitationsColumn(error)) {
    console.warn(
      'ai_companion_messages.citations missing — saved without chips (apply 20260912090000_companion_message_citations.sql)'
    );
    ({ error } = await dataLayer.aiCompanion.insertConversationMessages(
      userId,
      rowsWithoutCitations
    ));
  }
  if (error) throw error;
  await touchConversation(client, userId, conversationId);
  return [];
}

// ---------------------------------------------------------------------------
// Sending a turn — blocking and streaming
// ---------------------------------------------------------------------------
// Both paths do the same work in the same order: re-derive the trusted context,
// load the owned image transcripts, resolve or create the conversation, read
// the last 20 messages of it, call `companionChat`, persist both messages.
// They differ only in how the reply reaches the client and therefore in how a
// failure is refunded — see the stream's catch block.

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
          dataLayer,
          userId,
          { ...(context || {}), imageAttachments: undefined }
        );
        trustedContext.imageAttachments = await loadTrustedCompanionImages(
          dataLayer,
          userId,
          collectImageAttachmentIds(context)
        );
        const threadNoteId = trustedContext.noteId || null;
        const client = dataLayer.getClient();
        const conversation = await resolveConversationForSend(
          client,
          userId,
          parseCompanionUuid(context?.conversationId),
          threadNoteId,
          { forceNew: context?.newConversation === true }
        );
        // Conversation's note scope wins over client once the thread exists.
        const effectiveNoteId = conversation.note_context_id ?? threadNoteId;

        const { data: historyRows } =
          await dataLayer.aiCompanion.listRecentConversationMessages(
            userId,
            conversation.id,
            20
          );

        const history = (historyRows || []).reverse() as Array<{
          role: 'user' | 'assistant';
          content: string;
        }>;
        const { reply, actions, provider, citations, guidedStep, tutorStyle } =
          await companionChat(message.trim(), history, {
            ...trustedContext,
            noteId: effectiveNoteId || undefined,
          });

        await logAIInference(dataLayer.getClient(), {
          userId,
          feature: 'companion-message',
          provider,
          requestId: (req as any).requestId,
          // The id the reply was actually written in, never the fragment.
          // Costs nothing extra: a style is a different prompt, not a
          // different model or a second call.
          tutorStyle,
        });

        await persistCompanionExchange({
          userId,
          message: message.trim(),
          reply,
          actions,
          citations: citations ?? null,
          conversationId: conversation.id,
          noteContextId: effectiveNoteId,
        });
        await ensureConversationTitle(
          client,
          userId,
          conversation,
          message.trim()
        );

        return {
          reply,
          actions,
          provider,
          // Which excerpts of which note this reply was read out of. Persisted
          // alongside the message now, so a reloaded thread keeps its chips
          // instead of stranding "(Excerpt 1)" in the prose.
          citations: citations ?? null,
          conversationId: conversation.id,
          // Guided only: the step the lesson is on after this reply, so the
          // client's session advances from what the model actually said rather
          // than from a guess about the student's answer.
          guidedStep: guidedStep ?? null,
        };
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

  // A per-instance concurrency gate: an SSE response holds a socket for the
  // whole turn, so unbounded streams starve the process of connections. The
  // release is in the `finally` below — every early return after this point
  // must go through it.
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
      dataLayer,
      userId,
      { ...(context || {}), imageAttachments: undefined }
    );
    trustedContext.imageAttachments = await loadTrustedCompanionImages(
      dataLayer,
      userId,
      collectImageAttachmentIds(context)
    );
    const threadNoteId = trustedContext.noteId || null;
    const client = dataLayer.getClient();
    const conversation = await resolveConversationForSend(
      client,
      userId,
      parseCompanionUuid(context?.conversationId),
      threadNoteId,
      { forceNew: context?.newConversation === true }
    );
    const effectiveNoteId = conversation.note_context_id ?? threadNoteId;

    const { data: historyRows } = await dataLayer.aiCompanion.listRecentConversationMessages(
      userId,
      conversation.id,
      20
    );

    const history = (historyRows || []).reverse() as Array<{
      role: 'user' | 'assistant';
      content: string;
    }>;
    const { reply, actions, citations, guidedStep, tutorStyle } = await companionChat(
      message.trim(),
      history,
      {
        ...trustedContext,
        noteId: effectiveNoteId || undefined,
      }
    );

    // KNOWN ISSUE (tracked, found during F2): this path never called
    // `logAIInference` — a streamed turn has always been absent from
    // `ai_inference_log`, so provider mix and token estimates are measured off
    // the blocking path alone. Not fixed here: starting to insert a row per
    // stream is a behaviour change with a cost, and it belongs in whoever owns
    // that table. The style id is logged structurally either way, so the
    // analytics question this lane was asked to answer is answerable for both
    // paths.
    logger.info('AI inference tutor style', {
      feature: 'companion-message-stream',
      tutorStyle,
    });

    const inserted = await persistCompanionExchange({
      userId,
      message: message.trim(),
      reply,
      actions,
      citations: citations ?? null,
      conversationId: conversation.id,
      noteContextId: effectiveNoteId,
      selectIds: true,
    });
    await ensureConversationTitle(client, userId, conversation, message.trim());

    const assistantMessageId = inserted.find((row) => row.role === 'assistant')?.id;
    const userMessageId = inserted.find((row) => row.role === 'user')?.id;

    // The stream is simulated: `companionChat` has already returned the whole
    // reply and both messages are persisted before the first token is written.
    // The client sees a typing effect, but a dropped connection here loses only
    // the animation — the exchange is already saved.
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
      citations: citations ?? null,
      messageId: assistantMessageId,
      userMessageId,
      conversationId: conversation.id,
      guidedStep: guidedStep ?? null,
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
