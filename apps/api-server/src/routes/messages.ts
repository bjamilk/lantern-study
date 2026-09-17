/**
 * Chat, board and DM message routes.
 *
 * Mounted at `/api/v1/messages` (server.ts) with no router-level middleware,
 * so every route below carries its own `authMiddleware` — there is no
 * anonymous path into this file. The sibling `/api/v1/groups` router is the
 * one mounted behind `optionalAuthMiddleware` + `applyPublicRateLimits`;
 * messages are not.
 *
 * Exports `initializeMessageRoutes(layer, cache)`, called from server.ts
 * boot, plus the router itself. Both service handles are module-level
 * singletons: a route that runs before initialization has an undefined
 * `dataLayer`.
 *
 * Rate limiting: the global tier only, except the three upload routes
 * (`/upload-image`, `/upload-audio`, `/upload-question-image`), which add
 * `uploadBurstRateLimit` — base64 bodies of up to 10 MB are the expensive
 * traffic in this file.
 *
 * Ownership predicate pattern
 * ---------------------------
 * Two levels, and the difference matters:
 *
 *  - `dataLayer.groups.getAuthorizedGroupMessage(messageId, userId)` proves
 *    MEMBERSHIP only: it returns the row when the caller belongs to the
 *    message's group, whoever wrote it. It is the read/participate predicate —
 *    good enough for reacting, reposting, voting and bookmarking. It is NOT an
 *    ownership check.
 *  - author-or-group-admin (`row.sender_id === userId ||
 *    dataLayer.groups.isGroupAdmin(row.group_id, userId)`) is the standard for
 *    any WRITE onto someone else's message. Both `/:messageId/status` and
 *    `/:messageId/update` hold to it.
 *
 * The DM equivalents are `getAuthorizedDmMessage` and
 * `isDmThreadParticipant`; group reads additionally go through
 * `getGroupById(groupId, userId)`, which returns null for a non-member.
 *
 * Error-mapping convention: refusals are `res.status(n).json({ success:
 * false, error })` with a human sentence, never a thrown error, so
 * `asyncHandler` sees only genuine faults. Missing-or-not-yours is 404, not
 * 403, on the read paths — group and DM existence is not disclosed. Service
 * results that carry a reason (`ChatMessageMutationResult`,
 * `BoardRepostResult`) are mapped through the `sendChatMutationResult` /
 * `REPOST_REFUSALS` tables so each reason keeps its own status code, and 503
 * means a migration is not applied yet rather than a fault.
 *
 * What it touches
 * ---------------
 *  - Tables: `messages` (group + board posts, `image_url`, `reactions`,
 *    `flagged_as_similar_user_ids`, `question_status`), `groups` /
 *    `group_members`, `dm_threads` / `dm_messages` / `dm_thread_participants`,
 *    `message_votes`, board bookmarks and reposts.
 *  - Storage: the `note-files` bucket, under
 *    `{userId}/chat/{groupId | dm/threadId}/…`. Question images go to
 *    `question-images`.
 *  - Side effects: `learningEvents.recordLearningEvent`
 *    (`group_question_posted`), `activityFeed` (`answered_question`),
 *    `learningConnections` (`question_verified`, vote credit), and
 *    `communityModeration.enforceAnnouncementCap`. All are fail-soft and run
 *    AFTER the write they describe.
 *  - Cache: `cacheService` keys `messages:group:{groupId}:*`,
 *    `message:{messageId}`, `group:stats:{groupId}`. Invalidation is explicit
 *    at each mutation.
 *  - Realtime: this router publishes nothing itself. Clients subscribe to
 *    Supabase Postgres changes on `messages` / `dm_messages` directly, so a
 *    row written here is what fans out — which is why denormalised columns
 *    such as `reactions` must be SELECTed by the listing queries too.
 *
 * MEDIA ATTACHMENTS — the re-signing requirement
 * ----------------------------------------------
 * `note-files` is private, so a photo or voice note is only readable through a
 * signed URL. `clampSignedUrlTtl` caps every signed URL at 24 hours. Chat and
 * board photos once died after exactly 24 hours because the URL minted at
 * upload was frozen into the message row and never renewed.
 *
 * The fix, which must not be removed: the upload routes return `{ url, path }`
 * and the `path` is the durable reference. Clients mint a fresh URL on every
 * read through `POST /api/v1/storage/signed-url[s]` (batched, up to 40 refs
 * per call). Anything that persists a signed `url` into a row and renders it
 * later reintroduces the 24-hour expiry.
 *
 * The path is also the ACL: `note-files/{userId}/chat/{groupId}/…` is what
 * `canAccessStorageObject` resolves back to `isGroupMember(groupId, …)`, which
 * is why `POST /group/:groupId` validates a supplied `image_url` against the
 * caller and the target group before the insert.
 */
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { uploadBurstRateLimit } from '../middleware/rateLimit';
import { handleValidationErrors, validateGroupId, validateSendMessage, validateMessageId, validatePinMessage, validatePagination } from '../middleware/validation';
import type { DataLayer } from '../services/data';
// Type only (erased at compile time): the three result shapes are still
// re-exported by `services/supabase.ts` for this file. Every collaborator
// below takes the data layer now.
import type {
  BoardRepostResult,
  ChatMessageMutationResult,
  MessagePinResult,
} from '../services/supabase';
import { CacheService } from '../services/cache';
import {
  addMessageReaction,
  removeMessageReaction,
  REACTION_REMOVE_FAILED,
  REACTION_SAVE_FAILED,
} from '../services/messageReactions';
import { logger } from '../utils/logger';
import {
  CHAT_REACTION_MAX_DISTINCT_PER_MESSAGE,
  CHAT_REACTION_MAX_LENGTH,
  isSupportedReactionEmoji,
} from '@lantern/shared/chat';
import {
  BOARD_BOOKMARK_IMPORT_MAX,
  BOARD_GIF_MAX_BYTES,
  BOARD_REPOST_QUOTE_MAX,
  COMMUNITY_BOARD_COPY,
  isBoardImageUrlAllowed,
} from '@lantern/shared/network';
import { parseStorageObjectUrl } from '@lantern/shared/utils/storageUrl';
import {
  canVerifyQuestion,
  QUESTION_VERIFY_COPY,
  VERIFY_PEER_UPVOTES,
} from '@lantern/shared/utils/questionVerification';
import { clientErrorMessage } from '../utils/safeError';
import { requireAuthUserId } from '../utils/requestAuth';
import { enforceResourceOwner, userScopedCacheKey } from '../utils/resourceAccess';
import { CacheKeys, CacheTTL } from '../services/cachePolicy';
import { AuthenticatedRequest, Message } from '../types';
import {
  mutedUntilFromMinutes,
  resolveChatMuteDurationMinutes,
} from '@lantern/shared/utils/chatMute';
import { readDmHistoryClearedAt } from '@lantern/shared/utils/dmHistoryCutoff';
import { recordLearningEvent, surfaceFromRequest } from '../services/learningEvents';
import { getCommunityModerationService } from '../services/communityModeration';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/jpg'];
const ALLOWED_AUDIO_TYPES = [
  'audio/webm',
  'audio/mp4',
  'audio/m4a',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/x-m4a',
];

const router = Router();
const DEFAULT_MESSAGE_PAGE_SIZE = 50;
const MAX_MESSAGE_PAGE_SIZE = 100;
const resolveResponseProfile = (profile: unknown): 'compact' | 'full' =>
  profile === 'compact' ? 'compact' : 'full';

const sendChatMutationResult = (
  res: any,
  result: ChatMessageMutationResult,
  action: 'edited' | 'removed'
) => {
  if (result.status === 'ok') {
    return res.json({
      success: true,
      data: result.message,
      message: `Message ${action}`,
    });
  }

  const errors: Record<
    Exclude<ChatMessageMutationResult['status'], 'ok'>,
    { status: number; message: string }
  > = {
    invalid_content: { status: 400, message: 'Message content must be 1-50000 characters' },
    invalid_kind: { status: 400, message: 'Invalid message type' },
    not_found: { status: 404, message: 'Message not found' },
    forbidden: { status: 403, message: 'Only the sender can change this message' },
    not_editable: { status: 422, message: 'This message cannot be edited' },
    not_removable: { status: 422, message: 'This message cannot be removed' },
    removed: { status: 409, message: 'This message has already been removed' },
    expired: {
      status: 409,
      message: 'Messages can only be edited or removed within 30 minutes of sending',
    },
  };
  const resolved = errors[result.status] || {
    status: 500,
    message: `Failed to ${action === 'edited' ? 'edit' : 'remove'} message`,
  };
  return res.status(resolved.status).json({ success: false, error: resolved.message });
};

// Initialize services (will be injected in main server)
let dataLayer: DataLayer;
let cacheService: CacheService;


// Initialize function to be called from main server
export const initializeMessageRoutes = (layer: DataLayer, cache: CacheService) => {
  dataLayer = layer;
  cacheService = cache;
};

// ===========================================================================
// Media uploads — chat images, voice notes, question images.
//
// The only routes in this file on the `uploadBurstRateLimit` tier. Each takes
// base64 in the JSON body, enforces its own byte cap from the encoded length
// before decoding, and delegates to the service, which re-checks the cap,
// verifies magic bytes and re-checks group membership from the path prefix.
//
// Every one returns `{ url, path }`. `url` is a 24-hour convenience for the
// composer's local preview; `path` is what a message row stores, and readers
// re-sign it through POST /api/v1/storage/signed-url[s]. See the file header.
// ===========================================================================

// POST /api/v1/messages/upload-image — SEC-07 chat image upload with magic-byte checks

// ---------------------------------------------------------------------------
// Full-history message search (group + DM), optionally scoped to one chat.
// Access model mirrors the fetch routes: group messages only from groups the
// caller belongs to; DM messages only from threads they participate in.
// ---------------------------------------------------------------------------
router.get(
  '/search',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const q = String(req.query.q || '').trim();
    const limit = Math.min(30, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const scopeGroupId = typeof req.query.groupId === 'string' ? req.query.groupId : null;
    const scopeThreadId = typeof req.query.threadId === 'string' ? req.query.threadId : null;
    if (q.length < 2) {
      return res.json({ results: [] });
    }
    // Commas/parens would break the PostgREST or() expression; wildcards are ours.
    const pattern = `%${q.replace(/[,()%_]/g, ' ').trim()}%`;
    if (pattern === '%%') return res.json({ results: [] });

    const client = dataLayer.getClient();

    try {
      // --- resolve the group and thread scopes the caller may search ---
      let groupIds: string[] = [];
      if (scopeGroupId) {
        const { data: membership } = await client
          .from('group_members')
          .select('group_id')
          .eq('group_id', scopeGroupId)
          .eq('user_id', userId)
          .maybeSingle();
        if (membership) groupIds = [scopeGroupId];
      } else if (!scopeThreadId) {
        const { data: memberships } = await client
          .from('group_members')
          .select('group_id')
          .eq('user_id', userId)
          .limit(300);
        groupIds = (memberships || []).map((m: any) => m.group_id).filter(Boolean);
      }

      type ThreadRow = { id: string; participant_ids: string[]; participants: any };
      let threads: ThreadRow[] = [];
      if (scopeThreadId || !scopeGroupId) {
        let threadQuery = client
          .from('dm_threads')
          .select('id, participant_ids, participants, hidden_by')
          .contains('participant_ids', JSON.stringify([userId]));
        if (scopeThreadId) threadQuery = threadQuery.eq('id', scopeThreadId);
        const { data: threadRows } = await threadQuery.limit(300);
        threads = (threadRows || []).filter((t: any) => {
          const pids = Array.isArray(t.participant_ids) ? t.participant_ids : [];
          if (!pids.includes(userId)) return false;
          const hiddenBy = Array.isArray(t.hidden_by) ? t.hidden_by : [];
          return !hiddenBy.includes(userId);
        });
      }
      const threadIds = threads.map((t) => t.id);
      const threadById = new Map(threads.map((t) => [t.id, t]));

      // --- search both stores ---
      const [groupHits, dmHits] = await Promise.all([
        groupIds.length
          ? client
              .from('messages')
              .select('id, group_id, sender_id, text, question_stem, timestamp')
              .in('group_id', groupIds)
              .is('removed_at', null)
              .or(`text.ilike.${pattern},question_stem.ilike.${pattern}`)
              .order('timestamp', { ascending: false })
              .limit(limit)
          : Promise.resolve({ data: [] as any[] }),
        threadIds.length
          ? client
              .from('dm_messages')
              .select('id, thread_id, sender_id, text, timestamp')
              .in('thread_id', threadIds)
              .is('removed_at', null)
              .ilike('text', pattern)
              .order('timestamp', { ascending: false })
              .limit(limit)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const groupRows = (groupHits as any).data || [];
      const dmRows = (dmHits as any).data || [];

      // --- chat labels ---
      const matchedGroupIds = [...new Set(groupRows.map((m: any) => m.group_id))];
      let groupNameById = new Map<string, { name: string; avatarUrl: string | null }>();
      if (matchedGroupIds.length) {
        const { data: groupMeta } = await client
          .from('groups')
          .select('id, name, avatar_url')
          .in('id', matchedGroupIds);
        groupNameById = new Map(
          (groupMeta || []).map((g: any) => [g.id, { name: g.name, avatarUrl: g.avatar_url || null }])
        );
      }

      const results = [
        ...groupRows.map((m: any) => ({
          id: m.id,
          chatType: 'group' as const,
          chatId: m.group_id,
          chatName: groupNameById.get(m.group_id)?.name || 'Group',
          chatAvatarUrl: groupNameById.get(m.group_id)?.avatarUrl || null,
          otherUserId: null,
          text: (m.question_stem || m.text || '').slice(0, 300),
          senderId: m.sender_id,
          timestamp: m.timestamp,
        })),
        ...dmRows.map((m: any) => {
          const thread = threadById.get(m.thread_id);
          const otherUserId =
            (thread?.participant_ids || []).find((pid: string) => pid !== userId) || null;
          const other = otherUserId ? thread?.participants?.[otherUserId] : null;
          return {
            id: m.id,
            chatType: 'dm' as const,
            chatId: m.thread_id,
            chatName: other?.name || 'Direct chat',
            chatAvatarUrl: other?.avatarUrl || null,
            otherUserId,
            text: (m.text || '').slice(0, 300),
            senderId: m.sender_id,
            timestamp: m.timestamp,
          };
        }),
      ]
        .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
        .slice(0, limit);

      return res.json({ results });
    } catch (error: any) {
      logger.error('Message search failed', { userId, message: error?.message });
      return res.status(500).json({ success: false, error: 'Search failed' });
    }
  })
);

router.post(
  '/upload-image',
  authMiddleware,
  uploadBurstRateLimit,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { fileName, base64Data, contentType, groupId } = req.body || {};
    if (!fileName || !base64Data) {
      return res.status(400).json({ success: false, error: 'fileName and base64Data are required' });
    }
    const normalizedType = contentType === 'image/jpg' ? 'image/jpeg' : contentType;
    if (!normalizedType || !ALLOWED_IMAGE_TYPES.includes(normalizedType)) {
      return res.status(400).json({
        success: false,
        error: 'contentType is required. Only JPEG, PNG, GIF, and WebP are allowed.',
      });
    }
    const estimatedBytes = Math.ceil((String(base64Data).length * 3) / 4);
    if (estimatedBytes > 10 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'Image exceeds 10 MB limit' });
    }
    /**
     * A GIF answers to its own, SMALLER cap, and it has to be enforced here or
     * it is not enforced at all.
     *
     * `normalizeImageForStorage` passes an animated GIF through byte-for-byte
     * — nothing resizes it and its static first-frame thumb is no substitute —
     * so every reader pays the whole file. Both composers already refuse an
     * over-cap pick, but a client that skips them (or a stale build) reaches
     * this route directly, and the `note-files` bucket declares no
     * `file_size_limit`. A limit that lives only in a client is not a limit.
     */
    if (normalizedType === 'image/gif' && estimatedBytes > BOARD_GIF_MAX_BYTES) {
      return res.status(400).json({ success: false, error: COMMUNITY_BOARD_COPY.gifTooLarge });
    }

    try {
      const result = await dataLayer.uploads.uploadChatImage({
        fileName,
        base64Data,
        contentType: normalizedType,
        userId,
        groupId: typeof groupId === 'string' ? groupId : undefined,
      });
      res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error('Failed to upload chat image', { error, userId });
      res.status(400).json({
        success: false,
        error: clientErrorMessage(error, 'Failed to upload image'),
      });
    }
  })
);

// POST /api/v1/messages/upload-audio — chat voice notes (group or DM)
router.post(
  '/upload-audio',
  authMiddleware,
  uploadBurstRateLimit,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { fileName, base64Data, contentType, groupId, threadId } = req.body || {};
    if (!fileName || !base64Data) {
      return res.status(400).json({ success: false, error: 'fileName and base64Data are required' });
    }
    // Browsers often send MediaRecorder types with codec params (audio/webm;codecs=opus).
    const normalizedType = String(contentType || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const resolvedType = normalizedType === 'audio/x-m4a' ? 'audio/mp4' : normalizedType;
    if (!resolvedType || !ALLOWED_AUDIO_TYPES.includes(resolvedType)) {
      return res.status(400).json({
        success: false,
        error: 'contentType is required. Use webm, mp4/m4a, ogg, or wav.',
      });
    }
    const estimatedBytes = Math.ceil((String(base64Data).length * 3) / 4);
    if (estimatedBytes > 8 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'Audio exceeds 8 MB limit' });
    }

    try {
      const result = await dataLayer.uploads.uploadChatAudio({
        fileName,
        base64Data,
        contentType: resolvedType,
        userId,
        groupId: typeof groupId === 'string' ? groupId : undefined,
        threadId: typeof threadId === 'string' ? threadId : undefined,
      });
      res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error('Failed to upload chat audio', { error, userId });
      res.status(400).json({
        success: false,
        error: clientErrorMessage(error, 'Failed to upload audio'),
      });
    }
  })
);

// POST /api/v1/messages/upload-question-image — SEC-07 question image upload
router.post(
  '/upload-question-image',
  authMiddleware,
  uploadBurstRateLimit,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { fileName, base64Data, contentType } = req.body || {};
    if (!fileName || !base64Data) {
      return res.status(400).json({ success: false, error: 'fileName and base64Data are required' });
    }
    const normalizedType = contentType === 'image/jpg' ? 'image/jpeg' : contentType;
    if (!normalizedType || !ALLOWED_IMAGE_TYPES.includes(normalizedType)) {
      return res.status(400).json({
        success: false,
        error: 'contentType is required. Only JPEG, PNG, GIF, and WebP are allowed.',
      });
    }
    const estimatedBytes = Math.ceil((String(base64Data).length * 3) / 4);
    if (estimatedBytes > 10 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'Image exceeds 10 MB limit' });
    }

    try {
      const result = await dataLayer.uploads.uploadQuestionImage({
        fileName,
        base64Data,
        contentType: normalizedType,
        userId,
      });
      res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error('Failed to upload question image', { error, userId });
      res.status(400).json({
        success: false,
        error: clientErrorMessage(error, 'Failed to upload image'),
      });
    }
  })
);

// ===========================================================================
// Group and board reads.
//
// Every route here gates on `getGroupById(groupId, userId)` returning a row —
// that is the membership predicate, and a non-member gets 404, not 403.
// Ordering is load-bearing: the more specific `/group/:groupId/<suffix>`
// paths must be registered before the bare `/group/:groupId`.
// ===========================================================================

// GET /api/v1/messages/group/:groupId/user-votes - Get user votes for a group
// This route MUST be defined before /group/:groupId to avoid being caught by that route
router.get(
  '/group/:groupId/user-votes',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;

    logger.debug('Fetching user votes for group', { groupId, userId });

    const group = await dataLayer.groups.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    const votes = await dataLayer.groupMessages.getUserVotesForGroup(groupId, userId);

    res.json({
      success: true,
      data: votes,
    });
  })
);

// GET /api/v1/messages/group/:groupId - Get messages for a group
router.get(
  '/group/:groupId',
  authMiddleware,
  validateGroupId,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;
    const { page = 1, limit, before, after, responseProfile, rootsOnly } = req.query;
    const profile = resolveResponseProfile(responseProfile);
    // A board's page is roots only — comments live behind "N comments".
    const parsedRootsOnly = rootsOnly === '1' || rootsOnly === 'true';
    const parsedPage = Math.max(1, parseInt(page as string, 10) || 1);
    const requestedLimit = parseInt((limit as string) || `${DEFAULT_MESSAGE_PAGE_SIZE}`, 10);
    const parsedLimit = Math.min(MAX_MESSAGE_PAGE_SIZE, Math.max(1, requestedLimit || DEFAULT_MESSAGE_PAGE_SIZE));

    logger.debug('Fetching group messages', { groupId, page: parsedPage, limit: parsedLimit, before, after, userId, profile, rootsOnly: parsedRootsOnly });

    const group = await dataLayer.groups.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    // Service-layer cache holds unenriched rows; receipts are viewer-specific.
    const messages = await dataLayer.groupMessages.getGroupMessages(groupId, {
      page: parsedPage,
      limit: parsedLimit,
      before: before as string,
      after: after as string,
      responseProfile: profile,
      viewerUserId: userId,
      rootsOnly: parsedRootsOnly,
    });

    res.json({
      success: true,
      data: messages,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total: messages.length,
        hasMore: messages.length === parsedLimit,
      },
      responseProfile: profile,
    });
  })
);

// GET /api/v1/messages/group/:groupId/pinned - The board's one pinned post
//
// Its own endpoint because a pin can be older than the loaded page. Access is
// the same rule as GET /group/:groupId: group membership, or 404. Answers
// { message: null } — never a 500 — before the 20260903120000 migration.
router.get(
  '/group/:groupId/pinned',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;
    const group = await dataLayer.groups.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    const message = await dataLayer.chatSend.getPinnedMessage(groupId);
    res.json({ success: true, data: { message: message ?? null } });
  })
);

// PUT /api/v1/messages/:messageId/pin - Pin or unpin a board post
//
// One pin per board, cleared server-side. The service returns why it refused
// so each reason keeps its own code: 503 the migration is not applied, 400 the
// group is not a board or the target is not a live root post, 403 the caller
// is not a moderator, 404 no access.
router.put(
  '/:messageId/pin',
  authMiddleware,
  validatePinMessage,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { messageId } = req.params;
    const pinned = req.body?.pinned === true;

    const result: MessagePinResult = await dataLayer.chatSend.setMessagePin(
      messageId,
      userId,
      pinned
    );

    if (result.status === 'ok') {
      return res.json({ success: true, data: result.message });
    }

    const refusals: Record<
      Exclude<MessagePinResult['status'], 'ok'>,
      { status: number; error: string }
    > = {
      unavailable: { status: 503, error: COMMUNITY_BOARD_COPY.pinUnavailable },
      not_found: { status: 404, error: 'Message not found or access denied' },
      not_board: { status: 400, error: 'Only community boards support pinning' },
      not_pinnable: {
        status: 400,
        error: 'Only a post that is still on the board can be pinned',
      },
      forbidden: { status: 403, error: 'Only community moderators can pin' },
    };
    const refusal = refusals[result.status];
    return res.status(refusal.status).json({ success: false, error: refusal.error });
  })
);

// ---------------------------------------------------------------------------
// Board actions — Repost, Bookmark (Phase 1).
//
// FAVORITE has no route here on purpose: it is a reaction with the emoji
// pinned to BOARD_FAVORITE_EMOJI, so it uses POST/DELETE
// /messages/:messageId/reactions and GET /messages/group/:groupId/user-reactions
// unchanged. SHARE has no route either — the link is minted in shared
// (`boardPostShareUrl`) and the members-only guard is the board fetch's
// existing `getGroupById(groupId, userId)` 404, which every route below also
// relies on.
//
// GET /bookmarks is registered HERE, above `GET /:messageId`, because Express
// matches in registration order and `validateMessageId` would otherwise
// reject "bookmarks" as a malformed id rather than falling through.
// ---------------------------------------------------------------------------

/** Refusal → status + copy, in one table so no reason collapses into another. */
const REPOST_REFUSALS: Record<
  Exclude<BoardRepostResult['status'], 'ok'>,
  { status: number; error: string }
> = {
  not_found: { status: 404, error: 'Post not found or access denied' },
  not_board: { status: 400, error: COMMUNITY_BOARD_COPY.repostUnavailable },
  not_same_board: { status: 400, error: COMMUNITY_BOARD_COPY.repostNotSameBoard },
  not_a_post: { status: 400, error: COMMUNITY_BOARD_COPY.repostNotAPost },
  repost_of_repost: { status: 400, error: COMMUNITY_BOARD_COPY.repostOfRepost },
  own_too_soon: { status: 400, error: COMMUNITY_BOARD_COPY.repostOwnTooSoon },
  removed: { status: 400, error: COMMUNITY_BOARD_COPY.repostRemoved },
  already: { status: 409, error: COMMUNITY_BOARD_COPY.repostAlready },
  too_many: { status: 429, error: COMMUNITY_BOARD_COPY.repostTooMany },
  quote_too_long: { status: 400, error: COMMUNITY_BOARD_COPY.repostQuoteTooLong },
};

// ===========================================================================
// Board interactions — repost, bookmark, thread.
//
// Participation, not ownership: these authorise with
// `getAuthorizedGroupMessage`, which proves the caller is in the group. That
// is the right level here because each one writes only the caller's OWN row
// (a repost, a bookmark) and never edits the target post.
// ===========================================================================

// POST /api/v1/messages/:messageId/repost  { quote? }
//
// `:messageId` is the ORIGINAL post. The repost lands on the SAME board with
// the original's author preserved and the reposter's name above it.
router.post(
  '/:messageId/repost',
  authMiddleware,
  validateMessageId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { messageId } = req.params;
    const quote = typeof req.body?.quote === 'string' ? req.body.quote : '';
    if (quote.length > BOARD_REPOST_QUOTE_MAX * 4) {
      // Refuse an absurd body before it reaches the service, without
      // second-guessing the trimmed length rule the service owns.
      return res.status(400).json({
        success: false,
        error: COMMUNITY_BOARD_COPY.repostQuoteTooLong,
      });
    }

    // Same access rule as reading the board: an active membership, or 404.
    const target = await dataLayer.groups.getAuthorizedGroupMessage(messageId, userId);
    if (!target) {
      return res.status(404).json({ success: false, error: 'Post not found or access denied' });
    }

    const result: BoardRepostResult = await dataLayer.boardActions.createBoardRepost(
      String((target as any).group_id),
      userId,
      messageId,
      quote
    );

    if (result.status === 'ok') {
      await cacheService.deletePattern(`messages:group:${(target as any).group_id}:*`);
      return res.status(201).json({ success: true, data: result.message });
    }
    const refusal = REPOST_REFUSALS[result.status];
    return res.status(refusal.status).json({ success: false, error: refusal.error });
  })
);

// DELETE /api/v1/messages/:messageId/repost
//
// `:messageId` is the ORIGINAL's id too, so the client never has to hold the
// repost row's id. Scoped to the caller's own row and deliberately outside the
// 30-minute mutation window — a repost is a pointer, not speech.
router.delete(
  '/:messageId/repost',
  authMiddleware,
  validateMessageId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const result = await dataLayer.boardActions.undoBoardRepost(req.params.messageId, userId);
    if (result.status !== 'ok') {
      return res.status(404).json({ success: false, error: 'Repost not found' });
    }
    await cacheService.deletePattern(`messages:group:${result.groupId}:*`);
    return res.json({ success: true, data: { removed: true, repostId: result.repostId } });
  })
);

// GET /api/v1/messages/bookmarks?limit&before — "Saved posts", every board.
router.get(
  '/bookmarks',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const limit = parseInt(String(req.query?.limit ?? ''), 10);
    const before = typeof req.query?.before === 'string' ? req.query.before : undefined;
    const page = await dataLayer.boardActions.listBookmarkedPosts(userId, {
      limit: Number.isFinite(limit) ? limit : undefined,
      before,
    });
    // 200 even with no table: a missing migration hides a control, it does not
    // break the screen.
    return res.json({ success: true, data: page });
  })
);

// PUT /api/v1/messages/bookmarks/import  { messageIds }
//
// The one-time migration of the device-local saves. Idempotent, so a client
// may keep its local key until it has seen a 2xx.
router.put(
  '/bookmarks/import',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const raw = req.body?.messageIds;
    if (!Array.isArray(raw)) {
      return res.status(400).json({ success: false, error: 'messageIds must be an array' });
    }
    if (raw.length > BOARD_BOOKMARK_IMPORT_MAX) {
      return res.status(400).json({
        success: false,
        error: `Import at most ${BOARD_BOOKMARK_IMPORT_MAX} bookmarks at a time`,
      });
    }
    const result = await dataLayer.boardActions.importMessageBookmarks(
      userId,
      raw.filter((id: unknown): id is string => typeof id === 'string')
    );
    if (!result.serverBacked) {
      return res
        .status(503)
        .json({ success: false, error: COMMUNITY_BOARD_COPY.bookmarksUnavailable });
    }
    return res.json({ success: true, data: { imported: result.imported } });
  })
);

// GET /api/v1/messages/group/:groupId/bookmarks — the viewer's saved ids on
// ONE board, so the icon renders filled on first paint. Same shape and
// lifecycle as the existing user-reactions endpoint.
router.get(
  '/group/:groupId/bookmarks',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;
    const isMember = await dataLayer.groups.isGroupMember(groupId, userId);
    if (!isMember) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }
    const data = await dataLayer.boardActions.getBookmarkedMessageIdsForGroup(groupId, userId);
    return res.json({ success: true, data });
  })
);

// PUT /api/v1/messages/:messageId/bookmark  { bookmarked }
router.put(
  '/:messageId/bookmark',
  authMiddleware,
  validateMessageId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const bookmarked = req.body?.bookmarked === true;
    const result = await dataLayer.boardActions.setMessageBookmark(
      req.params.messageId,
      userId,
      bookmarked
    );

    switch (result.status) {
      case 'ok':
        return res.json({ success: true, data: { bookmarked: result.bookmarked } });
      case 'unavailable':
        return res
          .status(503)
          .json({ success: false, error: COMMUNITY_BOARD_COPY.bookmarksUnavailable });
      case 'not_a_board_post':
        return res
          .status(400)
          .json({ success: false, error: 'Only a board post can be bookmarked' });
      case 'not_found':
      default:
        return res
          .status(404)
          .json({ success: false, error: 'Message not found or access denied' });
    }
  })
);

// GET /api/v1/messages/group/:groupId/thread/:rootId - Nested reply thread
router.get(
  '/group/:groupId/thread/:rootId',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId, rootId } = req.params;
    const group = await dataLayer.groups.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    const messages = await dataLayer.chatSend.getGroupThread(groupId, rootId, userId);
    res.json({
      success: true,
      data: messages,
    });
  })
);

// GET /api/v1/messages/group/:groupId/votes - Get user's votes for all messages in a group
router.get(
  '/group/:groupId/votes',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;

    logger.debug('Fetching user votes for group', { groupId, userId });

    const group = await dataLayer.groups.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    const votes = await dataLayer.groupMessages.getUserVotesForGroup(groupId, userId);

    res.json({
      success: true,
      data: votes,
    });
  })
);

// POST /api/v1/messages/group/:groupId - Send message to group
// ===========================================================================
// POST /api/v1/messages/group/:groupId — send a group message or board post.
//
// The one write path into `messages` for new content. Order matters:
// membership first, then the attachment ACL check, then the insert, then the
// fail-soft side effects (announcement pin cap, cache invalidation,
// learning_events). Nothing after the insert may throw a post away.
// ===========================================================================
router.post(
  '/group/:groupId',
  authMiddleware,
  validateSendMessage,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;
    const { content, clientMessageId, replyToMessageId, mentionedUserIds, subject, imageUrl, postKind } =
      req.body;

    logger.debug('Sending message to group', { groupId, content: content.substring(0, 100), userId, clientMessageId });

    const group = await dataLayer.groups.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    /**
     * A board post's ONE photo (§5.2), carried on `messages.image_url` so a
     * title, a body and a photo are ONE row. The path IS the ACL — a signed
     * URL under `note-files/{userId}/chat/{groupId}/` is what
     * `canAccessStorageObject` resolves back to `isGroupMember(groupId, …)` —
     * so it is checked here BEFORE the insert. Without it a client could point
     * `image_url` at another group's object.
     */
    if (imageUrl !== undefined && imageUrl !== null && imageUrl !== '') {
      const allowed =
        typeof imageUrl === 'string' &&
        isBoardImageUrlAllowed({ url: imageUrl, userId, groupId, parse: parseStorageObjectUrl });
      if (!allowed) {
        return res.status(400).json({ success: false, error: 'invalid_image' });
      }
    }

    const message = await dataLayer.chatSend.sendMessage(groupId, userId, content, clientMessageId, {
      // Written on BOARDS only — the service re-checks `board.isBoard`, so the
      // same call against a group chat ignores it rather than 400ing.
      imageUrl: typeof imageUrl === 'string' && imageUrl ? imageUrl : undefined,
      replyToMessageId: typeof replyToMessageId === 'string' ? replyToMessageId : undefined,
      mentionedUserIds: Array.isArray(mentionedUserIds)
        ? mentionedUserIds.filter((id: unknown): id is string => typeof id === 'string')
        : undefined,
      // Board post title. Length-checked by validateSendMessage; dropped
      // (never rejected) while the 20260903120000 migration is unapplied.
      subject: typeof subject === 'string' ? subject : undefined,
      // What the post IS (20260908120000). Ignored off a board, dropped
      // pre-migration, and 403 when the sender may not post that kind —
      // `announcement` is moderators-only, re-checked in the service because
      // a kind allowed only by a client is not a permission.
      postKind: typeof postKind === 'string' ? postKind : undefined,
    });

    /**
     * An announcement pins itself, and at most BOARD_ANNOUNCEMENT_PIN_MAX are
     * pinned across the WHOLE community — the oldest unpins. Per-community,
     * not per-board: three boards each holding three pinned announcements is
     * nine banners on one community page, which is where the cap has to bite.
     *
     * Deliberately AFTER the insert and deliberately fail-soft: an
     * announcement that posted but could not unpin an older one is cosmetic,
     * while throwing here would lose a post that is already written.
     */
    if (
      typeof postKind === 'string' &&
      postKind === 'announcement' &&
      (group as { communityId?: string | null })?.communityId
    ) {
      await getCommunityModerationService(dataLayer)
        .enforceAnnouncementCap((group as { communityId: string }).communityId)
        .catch(() => []);
    }

    // Invalidate message caches for this group
    await cacheService.deletePattern(`messages:group:${groupId}:*`);

    // Also invalidate group stats cache
    await cacheService.delete(`group:stats:${groupId}`);

    // learning_events: group_question_posted (type QUESTION only; plain chat
    // is not learning activity). course_id from the group. Never throws.
    if (String(message?.type || '').toUpperCase() === 'QUESTION') {
      await recordLearningEvent(dataLayer, {
        userId,
        eventType: 'group_question_posted',
        targetType: 'question',
        targetId: message?.id != null ? String(message.id) : null,
        groupId,
        courseId: (group as { courseId?: string | null })?.courseId ?? null,
        surface: surfaceFromRequest(req),
        occurredAt: typeof message?.timestamp === 'string' ? message.timestamp : null,
      });
    }

    res.status(201).json({
      success: true,
      data: message,
    });
  })
);

// ===========================================================================
// Direct messages — threads, requests, read state, mute, archive, delete.
//
// A parallel access model to the group half: the predicate is
// `isDmThreadParticipant(threadId, userId)` / `getAuthorizedDmMessage`, not
// group membership, and a non-participant gets 404. A "delete" of a thread is
// a per-viewer history cutoff (`readDmHistoryClearedAt`), not a row delete —
// the other participant keeps their copy.
// ===========================================================================

// GET /api/v1/messages/dm/threads - List DM threads for current user
router.get(
  '/dm/threads',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    try {
      // participant_ids is jsonb — pass a JSON string so PostgREST uses cs.["uuid"]
      // (a JS array becomes Postgres {uuid} and fails with 22P02 invalid json).
      const { data: threads, error } = await dataLayer.getClient()
        .from('dm_threads')
        .select('id, participant_ids, participants, last_message, last_message_time, archived_by, hidden_by, history_cleared_at, status, requested_by')
        .contains('participant_ids', JSON.stringify([userId]))
        .order('last_message_time', { ascending: false, nullsFirst: false });

      if (error) {
        logger.error('Error fetching DM threads', {
          userId,
          code: error.code,
          message: error.message,
          details: error.details,
        });
        return res.status(500).json({ success: false, error: 'Failed to fetch DM threads' });
      }

      // Keep only threads that include this user and were not "deleted" by them
      const userThreads = (threads || []).filter((t: any) => {
        const pids = t.participant_ids;
        if (!Array.isArray(pids) || !pids.includes(userId)) return false;
        const hiddenBy = Array.isArray(t.hidden_by) ? t.hidden_by : [];
        return !hiddenBy.includes(userId);
      });

      // Look up other participant profiles (current user label is local "You").
      const otherUserIds = [
        ...new Set(
          userThreads
            .map((t: any) => {
              const pids = Array.isArray(t.participant_ids) ? t.participant_ids : [];
              return pids.find((id: string) => id !== userId);
            })
            .filter(Boolean),
        ),
      ] as string[];

      let profilesMap: Record<string, any> = {};
      if (otherUserIds.length > 0) {
        const { data: profiles } = await dataLayer.getClient()
          .from('profiles')
          .select('id, name, avatar_url')
          .in('id', otherUserIds);
        if (profiles) {
          profilesMap = Object.fromEntries(profiles.map((p: any) => [p.id, p]));
        }
      }

      // Prefer stored participants JSON when profile lookup misses.
      const result = userThreads.map((t: any) => {
        const pids = Array.isArray(t.participant_ids) ? t.participant_ids : [];
        const otherUserId = pids.find((id: string) => id !== userId);
        const otherProfile = otherUserId ? profilesMap[otherUserId] : null;
        const storedParticipants =
          t.participants && typeof t.participants === 'object' ? t.participants : {};

        const status =
          t.status === 'pending' || t.status === 'declined' || t.status === 'open'
            ? t.status
            : 'open';
        return {
          id: t.id,
          participantIds: pids,
          participants: {
            [userId]: {
              name: storedParticipants[userId]?.name || 'You',
              avatarUrl:
                storedParticipants[userId]?.avatarUrl ||
                storedParticipants[userId]?.avatar_url,
            },
            ...(otherUserId
              ? {
                  [otherUserId]: {
                    name:
                      otherProfile?.name ||
                      storedParticipants[otherUserId]?.name ||
                      'Unknown',
                    avatarUrl:
                      otherProfile?.avatar_url ||
                      storedParticipants[otherUserId]?.avatarUrl ||
                      storedParticipants[otherUserId]?.avatar_url,
                  },
                }
              : {}),
          },
          lastMessage: t.last_message,
          lastMessageTimestamp: t.last_message_time,
          isArchived: Array.isArray(t.archived_by) && t.archived_by.includes(userId),
          historyClearedAt: readDmHistoryClearedAt(t.history_cleared_at, userId),
          status,
          requestedBy: typeof t.requested_by === 'string' ? t.requested_by : null,
        };
      });

      res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error('Error in DM threads endpoint', { error: error.message, userId });
      res.status(500).json({ success: false, error: 'Failed to fetch DM threads' });
    }
  })
);

// POST /api/v1/messages/dm/:threadId/accept - Accept a pending message request
router.post(
  '/dm/:threadId/accept',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { threadId } = req.params;
    try {
      const data = await dataLayer.directMessages.acceptDmMessageRequest(threadId, userId);
      res.json({ success: true, data });
    } catch (error: any) {
      const msg = error?.message || 'Failed to accept message request';
      const status =
        msg === 'Thread not found' ? 404 : msg === 'Access denied' ? 403 : 400;
      res.status(status).json({ success: false, error: msg });
    }
  })
);

// POST /api/v1/messages/dm/:threadId/decline - Decline a pending message request
router.post(
  '/dm/:threadId/decline',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { threadId } = req.params;
    try {
      const data = await dataLayer.directMessages.declineDmMessageRequest(threadId, userId);
      res.json({ success: true, data });
    } catch (error: any) {
      const msg = error?.message || 'Failed to decline message request';
      const status =
        msg === 'Thread not found' ? 404 : msg === 'Access denied' ? 403 : 400;
      res.status(status).json({ success: false, error: msg });
    }
  })
);

// GET /api/v1/messages/dm/unread/all - Get unread counts for all DM threads
// IMPORTANT: This must be defined BEFORE /:messageId to avoid being caught by that route
router.get(
  '/dm/unread/all',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    try {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const cacheKey = CacheKeys.unreadDm(userId);
      const cached = await cacheService.get<Record<string, number>>(cacheKey);
      if (cached) {
        return res.json({ success: true, data: cached });
      }

      const unreadCounts = await dataLayer.readState.getAllDMUnreadCounts(userId);
      await cacheService.set(cacheKey, unreadCounts, CacheTTL.unreadCounts);

      res.json({
        success: true,
        data: unreadCounts,
      });
    } catch (error) {
      console.error('Error getting DM unread counts:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get DM unread counts',
      });
    }
  })
);

// GET /api/v1/messages/dm/:threadId/thread/:rootId - Nested reply thread in a DM
// IMPORTANT: This must be defined BEFORE /:messageId to avoid being caught by that route
router.get(
  '/dm/:threadId/thread/:rootId',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { threadId, rootId } = req.params;
    try {
      const messages = await dataLayer.chatSend.getDmThread(threadId, rootId, userId);
      res.json({
        success: true,
        data: messages,
      });
    } catch (error: any) {
      if (error?.message === 'Access denied') {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
      throw error;
    }
  })
);

// POST /api/v1/messages/dm/:threadId/read - Mark DM thread as read
// IMPORTANT: This must be defined BEFORE /:messageId to avoid being caught by that route
router.post(
  '/dm/:threadId/read',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    try {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { threadId } = req.params;

      const result = await dataLayer.readState.markDMAsRead(threadId, userId);

      res.json({
        success: result.success,
        previousLastReadAt: result.previousLastReadAt,
        data: { previousLastReadAt: result.previousLastReadAt },
        message: result.success ? 'DM marked as read' : 'Failed to mark DM as read',
      });
    } catch (error) {
      console.error('Error marking DM as read:', error);
      res.status(500).json({
        success: false,
        previousLastReadAt: null,
        error: 'Failed to mark DM as read',
      });
    }
  })
);

// PUT /api/v1/messages/dm/:threadId/archive - Archive a DM thread for a user
router.put(
  '/dm/:threadId/archive',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    try {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { threadId } = req.params;

      const success = await dataLayer.readState.archiveDmThread(threadId, userId);
      if (!success) {
        return res.status(404).json({ success: false, error: 'DM thread not found or you are not a participant' });
      }

      res.json({ success: true, message: 'DM thread archived' });
    } catch (error) {
      console.error('Error archiving DM thread:', error);
      res.status(500).json({ success: false, error: 'Failed to archive DM thread' });
    }
  })
);

// GET /api/v1/messages/dm/:threadId/mute - Current mute status for a DM
router.get(
  '/dm/:threadId/mute',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { threadId } = req.params;
    const status = await dataLayer.readState.getChatMute(userId, 'dm', threadId);
    res.json({ success: true, data: status });
  })
);

// PUT /api/v1/messages/dm/:threadId/mute - Mute DM notifications for a duration
router.put(
  '/dm/:threadId/mute',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { threadId } = req.params;
    const minutes = resolveChatMuteDurationMinutes(req.body?.duration, req.body?.durationMinutes);
    if (!minutes) {
      return res.status(400).json({
        success: false,
        error: 'Provide duration (1h|8h|24h|7d) or durationMinutes (1-43200)',
      });
    }
    const result = await dataLayer.readState.setChatMute(
      userId,
      'dm',
      threadId,
      mutedUntilFromMinutes(minutes)
    );
    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'DM thread not found or you are not a participant',
      });
    }
    res.json({ success: true, data: result, message: 'DM notifications muted' });
  })
);

// DELETE /api/v1/messages/dm/:threadId/mute - Unmute DM notifications
router.delete(
  '/dm/:threadId/mute',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { threadId } = req.params;
    const success = await dataLayer.readState.clearChatMute(userId, 'dm', threadId);
    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'DM thread not found or you are not a participant',
      });
    }
    res.json({ success: true, data: { muted: false, mutedUntil: null }, message: 'DM notifications unmuted' });
  })
);

// PUT /api/v1/messages/dm/:threadId/unarchive - Unarchive a DM thread for a user
router.put(
  '/dm/:threadId/unarchive',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    try {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { threadId } = req.params;

      const success = await dataLayer.readState.unarchiveDmThread(threadId, userId);
      if (!success) {
        return res.status(404).json({ success: false, error: 'DM thread not found' });
      }

      res.json({ success: true, message: 'DM thread unarchived' });
    } catch (error) {
      console.error('Error unarchiving DM thread:', error);
      res.status(500).json({ success: false, error: 'Failed to unarchive DM thread' });
    }
  })
);

// DELETE /api/v1/messages/dm/:threadId - Delete a DM thread and all its messages
router.delete(
  '/dm/:threadId',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    try {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { threadId } = req.params;

      const success = await dataLayer.readState.deleteDmThread(threadId, userId);

      if (!success) {
        return res.status(404).json({
          success: false,
          error: 'DM thread not found or you are not a participant',
        });
      }

      res.json({
        success: true,
        message: 'DM thread deleted successfully',
      });
    } catch (error) {
      console.error('Error deleting DM thread:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete DM thread',
      });
    }
  })
);

// ===========================================================================
// Single-message CRUD — edit and soft-remove, DM then group.
//
// Sender-only, and the predicate lives in `editChatMessage` /
// `removeChatMessage` rather than here: the service returns a reason
// (`forbidden`, `not_editable`, `expired`, …) and `sendChatMutationResult`
// maps each to its own status. That is why these handlers do no authorisation
// of their own beyond the body shape — moving the check up here would
// duplicate the 30-minute mutation window and the removed/removable rules.
// ===========================================================================

// PUT /api/v1/messages/dm-message/:messageId - Edit an owned DM message
router.put(
  '/dm-message/:messageId',
  authMiddleware,
  validateMessageId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { messageId } = req.params;
    const { content } = req.body || {};
    if (typeof content !== 'string' || !content.trim() || content.length > 50000) {
      return res.status(400).json({
        success: false,
        error: 'Message content must be 1-50000 characters',
      });
    }

    const result = await dataLayer.groupMessages.editChatMessage('dm', messageId, userId, content);
    return sendChatMutationResult(res, result, 'edited');
  })
);

// DELETE /api/v1/messages/dm-message/:messageId - Soft-remove an owned DM message
router.delete(
  '/dm-message/:messageId',
  authMiddleware,
  validateMessageId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const result = await dataLayer.groupMessages.removeChatMessage(
      'dm',
      req.params.messageId,
      userId
    );
    return sendChatMutationResult(res, result, 'removed');
  })
);

// GET /api/v1/messages/:messageId - Get message by ID
router.get(
  '/:messageId',
  authMiddleware,
  validateMessageId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { messageId } = req.params;

    logger.debug('Fetching message', { messageId, userId });

    const cacheKey = userScopedCacheKey('message', userId, messageId);
    let message = await cacheService.get(cacheKey);

    if (!message) {
      message = await dataLayer.groupMessages.getMessageById(messageId, userId);

      if (!message) {
        return res.status(404).json({
          success: false,
          error: 'Message not found or access denied',
        });
      }

      // Cache for 10 minutes
      await cacheService.set(cacheKey, message, 600);
    } else {
      const msg = message as Record<string, unknown>;
      const senderId = msg.senderId ?? msg.sender_id;
      if (senderId !== userId) {
        const groupId = msg.groupId ?? msg.group_id;
        if (groupId) {
          const group = await dataLayer.groups.getGroupById(String(groupId), userId);
          if (!group) {
            return res.status(403).json({ success: false, error: 'Access denied' });
          }
        } else if (!enforceResourceOwner(res, msg, userId)) {
          return;
        }
      }
    }

    res.json({
      success: true,
      data: message,
    });
  })
);

// PUT /api/v1/messages/:messageId - Edit an owned group text message
router.put(
  '/:messageId',
  authMiddleware,
  validateMessageId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { messageId } = req.params;
    const { content } = req.body || {};
    if (typeof content !== 'string' || !content.trim() || content.length > 50000) {
      return res.status(400).json({
        success: false,
        error: 'Message content must be 1-50000 characters',
      });
    }

    const result = await dataLayer.groupMessages.editChatMessage('group', messageId, userId, content);
    return sendChatMutationResult(res, result, 'edited');
  })
);

// DELETE /api/v1/messages/:messageId - Soft-remove an owned group text/voice message
router.delete(
  '/:messageId',
  authMiddleware,
  validateMessageId,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const result = await dataLayer.groupMessages.removeChatMessage(
      'group',
      req.params.messageId,
      userId
    );
    return sendChatMutationResult(res, result, 'removed');
  })
);

// GET /api/v1/messages/user/:userId - Get direct messages for user
router.get(
  '/user/:userId',
  authMiddleware,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const authUserId = requireAuthUserId(req, res);
    if (!authUserId) return;

    const { userId } = req.params;
    const { page = 1, limit = 50, otherUserId } = req.query;

    if (authUserId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    logger.debug('Fetching direct messages', { userId: authUserId, otherUserId, page, limit });

    if (!otherUserId) {
      return res.status(400).json({
        success: false,
        error: 'otherUserId parameter is required for direct messages',
      });
    }

    try {
      // Receipts are viewer-specific; do not serve a shared cache of enriched DMs.
      const messages = await dataLayer.directMessages.getDirectMessages(
        authUserId,
        otherUserId as string,
        {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
        }
      );

      res.json({
        success: true,
        data: messages || [],
        pagination: {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          total: (messages || []).length,
        },
      });
    } catch (error: any) {
      logger.error('Error fetching direct messages:', { error: error.message, userId, otherUserId });
      res.status(500).json({
        success: false,
        error: clientErrorMessage(error, 'Failed to fetch direct messages'),
      });
    }
  })
);

// POST /api/v1/messages/user/:userId - Send direct message
router.post(
  '/user/:userId',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const senderId = requireAuthUserId(req, res);
    if (!senderId) return;

    const { userId } = req.params;
    const { content, recipientId, clientMessageId, replyToMessageId } = req.body;

    if (senderId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    logger.debug('Sending direct message', {
      senderId,
      recipientId,
      content: content?.substring(0, 100)
    });

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message content is required',
      });
    }

    if (!recipientId) {
      return res.status(400).json({
        success: false,
        error: 'Recipient ID is required',
      });
    }

    try {
      const message = await dataLayer.directMessages.sendDirectMessage(senderId, recipientId, content, {
        clientMessageId,
        replyToMessageId: typeof replyToMessageId === 'string' ? replyToMessageId : undefined,
      });

      // Invalidate direct message caches
      await cacheService.deletePattern(`messages:direct:${senderId}:${recipientId}:*`);
      await cacheService.deletePattern(`messages:direct:${recipientId}:${senderId}:*`);

      res.status(201).json({
        success: true,
        data: message,
      });
    } catch (error: any) {
      const blocked =
        error.message?.includes('does not accept direct messages') ||
        error.message?.includes('only accepts direct messages') ||
        error.message?.includes('message request was declined') ||
        error.message?.includes('You cannot message this user');
      logger.error('Error sending direct message:', { error: error.message, senderId, recipientId });
      res.status(blocked ? 403 : 500).json({
        success: false,
        error: blocked
          ? error.message?.includes('declined')
            ? 'This message request was declined'
            : error.message?.includes('cannot message')
              ? 'You cannot message this user'
              : 'This user does not accept direct messages from you'
          : clientErrorMessage(error, 'Failed to send direct message'),
      });
    }
  })
);

// POST /api/v1/messages/:messageId/vote - Vote on message
router.post(
  '/:messageId/vote',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { messageId } = req.params;
    const { voteType } = req.body;

    logger.debug('Voting on message', { messageId, voteType, userId });

    if (!voteType || !['up', 'down'].includes(voteType)) {
      return res.status(400).json({
        success: false,
        error: 'Valid vote type (up or down) is required',
      });
    }

    const authorized = await dataLayer.groups.getAuthorizedGroupMessage(messageId, userId);
    if (!authorized) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    const result = await dataLayer.groupMessages.voteQuestion(messageId, userId, voteType);

    // Invalidate message cache
    await cacheService.delete(`message:${messageId}`);

    // North-star metric (Phase 3 · O): an upvote is one student telling another
    // their question helped. A DOWNVOTE is not a learning connection, so only
    // 'up' counts. Actor = the question's author (they did the helping).
    if (voteType === 'up' && authorized.sender_id) {
      const { getLearningConnectionsService } = await import('../services/learningConnections');
      await getLearningConnectionsService(dataLayer).record({
        actorId: authorized.sender_id,
        beneficiaryId: userId,
        kind: 'question_voted',
        objectType: 'question',
        objectId: messageId,
      });
    }

    res.json({
      success: true,
      data: result,
    });
  })
);

// DELETE /api/v1/messages/:messageId/vote - Remove vote from message
router.delete(
  '/:messageId/vote',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { messageId } = req.params;

    logger.debug('Removing vote from message', { messageId, userId });

    const authorized = await dataLayer.groups.getAuthorizedGroupMessage(messageId, userId);
    if (!authorized) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    const result = await dataLayer.groupMessages.removeVote(messageId, userId);

    // Invalidate message cache
    await cacheService.delete(`message:${messageId}`);

    res.json({
      success: true,
      data: result,
    });
  })
);

// ---------------------------------------------------------------------------
// Emoji reactions (20260830120000) — group messages AND DMs, every message
// type including questions. Reactions gate nothing; question votes still
// decide verification, so the two are kept deliberately separate.
// ---------------------------------------------------------------------------

/** Resolve the message and the viewer's right to react to it, group or DM. */
// ===========================================================================
// Votes and reactions.
//
// Participation-level again: the caller must be able to reach the message, and
// the row written is their own. `authorizeReactionTarget` tries the group
// predicate first and falls back to the DM one, so a single route serves both
// surfaces and returns which scope matched — the caller needs that to know
// which cache pattern to invalidate.
//
// The reaction upsert is the site of the `onConflict`-vs-partial-unique-index
// trap: PostgREST cannot use a partial unique index for `onConflict`, and the
// upsert 500s. That silently broke every reaction and favorite for several
// releases. Changing the reaction uniqueness constraint means re-checking this
// path, not just the SQL.
// ===========================================================================
async function authorizeReactionTarget(messageId: string, userId: string) {
  const group = await dataLayer.groups.getAuthorizedGroupMessage(messageId, userId);
  if (group) return { scope: 'group' as const, groupId: (group as any).group_id ?? null };
  const dm = await dataLayer.groups.getAuthorizedDmMessage(messageId, userId);
  if (dm) return { scope: 'dm' as const, threadId: dm.threadId };
  return null;
}

// POST /api/v1/messages/:messageId/reactions  { emoji }
router.post(
  '/:messageId/reactions',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { messageId } = req.params;
    const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.trim() : '';

    if (!emoji || emoji.length > CHAT_REACTION_MAX_LENGTH) {
      return res.status(400).json({ success: false, error: 'A valid emoji is required' });
    }
    // Fixed set: keeps the counts readable and the column bounded. Clients
    // render exactly these, so anything else is a malformed or hostile call.
    if (!isSupportedReactionEmoji(emoji)) {
      return res.status(400).json({ success: false, error: 'That emoji is not available' });
    }

    const target = await authorizeReactionTarget(messageId, userId);
    if (!target) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    const existing = await dataLayer.groupMessages.countDistinctReactionEmoji(messageId, target.scope);
    const already = await dataLayer.groupMessages.readMessageReactions(messageId, target.scope);
    if (
      existing >= CHAT_REACTION_MAX_DISTINCT_PER_MESSAGE &&
      !(emoji in already.reactions)
    ) {
      return res.status(409).json({
        success: false,
        error: 'This message already has the maximum number of different reactions',
      });
    }

    try {
      const result = await addMessageReaction(
        dataLayer,
        messageId,
        userId,
        emoji,
        target.scope
      );
      await cacheService.delete(`message:${messageId}`);
      if (target.scope === 'group' && (target as any).groupId) {
        await cacheService.deletePattern(`messages:group:${(target as any).groupId}:*`);
      }
      res.json({ success: true, data: result });
    } catch (error: any) {
      // A reaction that fails must SAY it failed to save. Letting this reach
      // the global handler produced a 500 whose body is the generic
      // "Something went wrong" — the toast a student got when Favorite broke,
      // and the one string that tells them nothing about what to do next.
      logger.error('Reaction add failed', { messageId, scope: target.scope, error });
      const statusCode = error?.statusCode === 503 ? 503 : 500;
      return res.status(statusCode).json({
        success: false,
        error: statusCode === 503 ? error.message : REACTION_SAVE_FAILED,
      });
    }
  })
);

// DELETE /api/v1/messages/:messageId/reactions  { emoji }
router.delete(
  '/:messageId/reactions',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { messageId } = req.params;
    const raw = req.body?.emoji ?? req.query?.emoji;
    const emoji = typeof raw === 'string' ? raw.trim() : '';
    if (!emoji || emoji.length > CHAT_REACTION_MAX_LENGTH) {
      return res.status(400).json({ success: false, error: 'A valid emoji is required' });
    }

    const target = await authorizeReactionTarget(messageId, userId);
    if (!target) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    try {
      const result = await removeMessageReaction(
        dataLayer,
        messageId,
        userId,
        emoji,
        target.scope
      );
      await cacheService.delete(`message:${messageId}`);
      if (target.scope === 'group' && (target as any).groupId) {
        await cacheService.deletePattern(`messages:group:${(target as any).groupId}:*`);
      }
      res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error('Reaction remove failed', { messageId, scope: target.scope, error });
      const statusCode = error?.statusCode === 503 ? 503 : 500;
      return res.status(statusCode).json({
        success: false,
        error: statusCode === 503 ? error.message : REACTION_REMOVE_FAILED,
      });
    }
  })
);

// GET /api/v1/messages/group/:groupId/user-reactions
router.get(
  '/group/:groupId/user-reactions',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { groupId } = req.params;
    const isMember = await dataLayer.groups.isGroupMember(groupId, userId);
    if (!isMember) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }
    const data = await dataLayer.groupMessages.getUserReactionsForGroup(groupId, userId);
    res.json({ success: true, data });
  })
);

// GET /api/v1/messages/dm/:threadId/user-reactions
router.get(
  '/dm/:threadId/user-reactions',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { threadId } = req.params;
    const allowed = await dataLayer.groups.isDmThreadParticipant(threadId, userId);
    if (!allowed) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }
    const data = await dataLayer.groupMessages.getUserReactionsForThread(threadId, userId);
    res.json({ success: true, data });
  })
);

// PUT /api/v1/messages/:messageId/status - Update question status
// ===========================================================================
// Writes onto SOMEONE ELSE'S message — question status and similarity flags.
//
// The only two routes in this file that change a row the caller may not have
// written, and both hold to the same predicate:
//
//   getAuthorizedGroupMessage  -> the caller is IN the group (404 otherwise)
//   sender_id === userId || isGroupAdmin(group_id, userId)  -> may write
//
// Membership alone is not enough here, because the field being written
// describes another member. Keep the two routes in step: if one gains a
// relaxation the other has not, that is the bug.
// ===========================================================================
router.put(
  '/:messageId/status',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { messageId } = req.params;
    const { questionStatus } = req.body;

    logger.debug('Updating question status', { messageId, questionStatus, userId });

    if (!questionStatus || !['PENDING', 'VERIFIED', 'REJECTED'].includes(questionStatus)) {
      return res.status(400).json({
        success: false,
        error: 'Valid question status (PENDING, VERIFIED, REJECTED) is required',
      });
    }

    const authorized = await dataLayer.groups.getAuthorizedGroupMessage(messageId, userId);
    if (!authorized) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    const isSender = authorized.sender_id === userId;
    const isAdmin = await dataLayer.groups.isGroupAdmin(authorized.group_id, userId);
    if (!isSender && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Only the question author or a group admin can update question status',
      });
    }

    // VERIFIED is a peer signal, so it is gated on evidence rather than on who
    // is asking: the author and a group admin are refused identically below the
    // threshold, which is why the rule cannot live on a client. PENDING and
    // REJECTED stay free — pulling a bad question needs no quorum.
    //
    // Only the transition is gated. Questions already stored as VERIFIED keep
    // that status; there is no backfill and no migration.
    let peerUpvotes: number | undefined;
    if (questionStatus === 'VERIFIED') {
      peerUpvotes = await dataLayer.groupMessages.countPeerUpvotesForMessage(
        messageId,
        authorized.sender_id
      );
      if (!canVerifyQuestion(peerUpvotes)) {
        return res.status(409).json({
          success: false,
          error: QUESTION_VERIFY_COPY.blocked(peerUpvotes),
          data: { peerUpvotes, requiredPeerUpvotes: VERIFY_PEER_UPVOTES },
        });
      }
    }

    const result = await dataLayer.groupMessages.updateQuestionStatus(messageId, questionStatus);

    // Invalidate message cache
    await cacheService.delete(`message:${messageId}`);

    // Phase 3 M: answered_question had no feed writer. Group-scoped, and only
    // on VERIFIED — an answer being confirmed correct is the newsworthy moment.
    if (questionStatus === 'VERIFIED' && authorized.type === 'QUESTION') {
      const { getActivityFeedService } = await import('../services/activityFeed');
      await getActivityFeedService(dataLayer).record({
        actorId: userId,
        verb: 'answered_question',
        objectType: 'question',
        objectId: messageId,
        audienceType: 'group',
        audienceId: authorized.group_id,
      });
    }

    // North-star metric (Phase 3 · O): the question's AUTHOR is the actor —
    // their question was confirmed useful. `userId` here is the VERIFIER and is
    // the beneficiary; passing it as actorId would credit admins as helpers and
    // invert the metric. Only VERIFIED counts; other statuses are not help.
    // `type` is already selected by getAuthorizedGroupMessage. Without this
    // clause a TEXT message marked VERIFIED would credit its author with a
    // question_verified connection.
    if (questionStatus === 'VERIFIED' && authorized.type === 'QUESTION' && authorized.sender_id) {
      const { getLearningConnectionsService } = await import('../services/learningConnections');
      await getLearningConnectionsService(dataLayer).record({
        actorId: authorized.sender_id,
        beneficiaryId: userId,
        kind: 'question_verified',
        objectType: 'question',
        objectId: messageId,
      });
    }

    res.json({
      success: true,
      data: result,
      peerUpvotes,
      requiredPeerUpvotes: VERIFY_PEER_UPVOTES,
    });
  })
);

// PUT /api/v1/messages/:messageId/update - Update message (flagged status)
//
// `flagged_as_similar_user_ids` drives who a board shows as a duplicate
// poster, so writing it onto another member's message is a write on their
// content. This route once authorised with `getAuthorizedGroupMessage` alone
// — membership — which let any member of a group rewrite the flags on any
// other member's message. It now applies the author-or-group-admin rule
// below, matching /:messageId/status. Covered by messages.flagUpdate.test.ts.
router.put(
  '/:messageId/update',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { messageId } = req.params;
    const { flagged_as_similar_user_ids, flaggedUserIds } = req.body;
    const flagIds = flagged_as_similar_user_ids ?? flaggedUserIds;

    logger.debug('Updating message', { messageId, userId });

    const authorized = await dataLayer.groups.getAuthorizedGroupMessage(messageId, userId);
    if (!authorized) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    if (!Array.isArray(flagIds)) {
      return res.status(400).json({
        success: false,
        error: 'flagged_as_similar_user_ids must be an array',
      });
    }

    // getAuthorizedGroupMessage only proves the caller is IN the group, so
    // any member could rewrite any other member's similarity flags. This is a
    // write on someone else's message: hold it to the same author-or-admin
    // rule the /status route above uses.
    const isSender = authorized.sender_id === userId;
    const isAdmin = await dataLayer.groups.isGroupAdmin(authorized.group_id, userId);
    if (!isSender && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Only the author or a group admin can update this message',
      });
    }

    const result = await dataLayer.groupMessages.updateMessageFlagged(messageId, flagIds);

    // Invalidate message cache
    await cacheService.delete(`message:${messageId}`);

    res.json({
      success: true,
      data: result,
    });
  })
);

export default router;