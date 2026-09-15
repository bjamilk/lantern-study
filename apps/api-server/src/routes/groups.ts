/**
 * Group routes — groups, community boards and community study groups.
 *
 * A "group" is one row that renders as three things: a private group chat, a
 * community BOARD, or a community STUDY GROUP. Which one is decided by
 * `visibility` + `communityId` + `communitySurface`, normalised through
 * `resolveGroupDiscovery` / `isCommunityBoard` from `@lantern/shared/network`.
 *
 * Mounted at `/api/v1/groups` (server.ts) as
 * `optionalAuthMiddleware, applyPublicRateLimits, groupRoutes` — the public
 * rate-limit tier, because one route here (`GET /invite/:inviteId/preview`,
 * the OG/WhatsApp unfurl) is genuinely anonymous. Every other route declares
 * its own `authMiddleware`, so the router-level optional auth never softens
 * them. `GET /:groupId/members` is the exception, and only in dev:
 * `allowDevAuthBypass()` swaps in `optionalAuthMiddleware` there, with
 * `requireGroupMember('groupId')` still in front of it.
 *
 * Exports `initializeGroupRoutes(supabase, cache)`, called from server.ts
 * boot, plus the router. Both service handles are module-level singletons.
 *
 * Membership and role model
 * -------------------------
 * `group_members` rows carry `pending`. An admin-issued invite creates a
 * PENDING row the invitee must accept; joining by invite link is the user's
 * own consent and lands active immediately. Member counts and rosters filter
 * on `pending = false`.
 *
 * There is no role column. Admin is a group-level list, and BOTH shapes are
 * live, so every check tests both:
 *
 *   group.permissions?.[userId]?.admin === true  ||  group.adminIds?.includes(userId)
 *
 * Admin grants admin (`POST /:groupId/admins/:memberId`), and the last admin
 * cannot be demoted. Archiving is the one group edit any member may perform;
 * everything else on `PUT /:groupId` is admin-only.
 *
 * Community guard
 * ---------------
 * A group listed in a community is a channel of that community, so community
 * membership gates it on top of group membership. Two helpers at the top of
 * this file own that rule:
 *
 *  - `isBarredFromCommunity` — the actor must be an active community member
 *    to create a group there or to move one there. It resolves discovery
 *    first, so a `visibility: 'private'` group never consults a community.
 *  - `refuseCommunityMemberAdd` — every TARGET of a member add must already
 *    be an active community member, and a BOARD takes no member adds at all
 *    (its audience is the community's membership).
 *
 * Both resolve the community from the GROUP ROW, never from a client-supplied
 * community id, and community standing comes from `communitiesService` /
 * `communityModeration` rather than from anything in the request. Keep it that
 * way: trusting a caller's community id is exactly the hole H3 closed in
 * `services/studyRooms.ts`, where `list`/`get`/`join` accepted a stranger
 * community's id and handed back its rooms and rosters.
 *
 * A community LOUNGE is the community's own conversation room. It is minted
 * with no admins and `DELETE /:groupId` refuses it explicitly via
 * `communitiesService.isCommunityLounge`, because deleting it would take every
 * message in it (messages cascade on the group).
 *
 * Error-mapping convention: refusals are
 * `res.status(n).json({ success: false, error })`, not thrown. Not-found and
 * not-yours are both 404 `'Group not found or access denied'` — membership is
 * not disclosed. 403 is used once access is established but the role or the
 * community rule refuses. 503 means a migration is not applied yet
 * (`hasGroupCommunitySurface`), which is reported rather than silently
 * downgraded.
 *
 * What it touches
 * ---------------
 *  - Tables: `groups`, `group_members`, and `communities` /
 *    `community_members` through `communitiesService`.
 *  - Storage: group avatars, uploaded by `uploadGroupAvatar` into a private
 *    bucket. Like chat media, the stored reference is re-signed on read rather
 *    than frozen — a signed URL persisted into `groups.avatar_url` expires.
 *  - Side effects: `createNotification` (`group_invite`, fire-and-forget,
 *    never blocks the response) and `activityFeed` `joined_group`, recorded
 *    with a GROUP audience because a join is news to the room, not the world.
 *  - Cache: `group:{groupId}`, `group:members:{groupId}:*`, `groups:list:*`,
 *    `groups:user:*`, `groups:discover:*`, `user:groups:{userId}:*`, and
 *    `messages:group:{groupId}:*` on delete. Discovery lists carry `isMember`
 *    and a member count, so any membership change must drop
 *    `groups:discover:*` too.
 *  - Realtime: nothing is published here; clients subscribe to Postgres
 *    changes on `group_members` and `messages` directly.
 *
 * `POST /:groupId/members/batch` reports a total failure as a success — see
 * the KNOWN ISSUE at that route.
 */
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { allowDevAuthBypass, requireGroupMember } from '../middleware/authorizeResource';
import { handleValidationErrors, validateGroupId, validateBatchMemberIds, validateCreateGroup, validateUpdateGroup, validatePagination, validateSearch } from '../middleware/validation';
import { SupabaseService } from '../services/supabase';
import { CacheService } from '../services/cache';
import { CacheKeys, CacheTTL } from '../services/cachePolicy';
import { getCommunitiesService } from '../services/communities';
import { logger } from '../utils/logger';
import { requireAuthUserId } from '../utils/requestAuth';
import { clientErrorMessage } from '../utils/safeError';
import {
  mutedUntilFromMinutes,
  resolveChatMuteDurationMinutes,
} from '@lantern/shared/utils/chatMute';
import {
  COMMUNITY_BOARD_COPY,
  isCommunityBoard,
  resolveGroupDiscovery,
} from '@lantern/shared/network';
import { hasGroupCommunitySurface } from '../services/schemaCapabilities';

/**
 * A group listed in a community is a channel of that community, and only its
 * members may open or move one there. Resolves through the same discovery
 * normaliser the service uses, so `visibility: 'private'` never consults the
 * community at all.
 */
async function isBarredFromCommunity(
  userId: string,
  input: { visibility?: unknown; communityId?: unknown },
): Promise<boolean> {
  const discovery = resolveGroupDiscovery({
    visibility: input.visibility as 'private' | 'community' | 'public' | null | undefined,
    communityId: input.communityId as string | null | undefined,
  });
  if (!discovery.communityId) return false;
  const member = await getCommunitiesService(supabaseService).isActiveMember(
    userId,
    discovery.communityId,
  );
  return !member;
}

/**
 * Who may be pulled into a group that belongs to a community (spec §3.8).
 *
 * Both member-add endpoints checked GROUP admin only, which is a live hole:
 * a channel admin could pull people who are not in the community straight
 * into one of its channels. Two rules, in this order:
 *
 *  1. every target must already be an active member of the community;
 *  2. a BOARD takes no member adds at all — its audience IS the community's
 *     membership, so people join the community, then the board.
 *
 * Returns the refusal, or null when the request may proceed.
 */
async function refuseCommunityMemberAdd(
  group: {
    visibility?: unknown;
    communityId?: string | null;
    communitySurface?: 'board' | 'study_group' | null;
  },
  targetUserIds: string[],
): Promise<{ status: number; error: string } | null> {
  const targets = [...new Set(targetUserIds.filter((id) => typeof id === 'string' && id))];
  if (targets.length > 0) {
    const barred = await Promise.all(
      targets.map((targetId) =>
        isBarredFromCommunity(targetId, {
          visibility: group.visibility,
          communityId: group.communityId,
        }),
      ),
    );
    if (barred.some(Boolean)) {
      return { status: 403, error: 'They need to join this community first' };
    }
  }
  if (
    isCommunityBoard({
      communityId: group.communityId ?? null,
      communitySurface: group.communitySurface ?? null,
    })
  ) {
    return { status: 403, error: 'Members join the community, then the board' };
  }
  return null;
}

const router = Router();
const DEFAULT_GROUP_PAGE_SIZE = 20;
const MAX_GROUP_PAGE_SIZE = 50;
const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/jpg'];
const resolveResponseProfile = (profile: unknown): 'compact' | 'full' =>
  profile === 'compact' ? 'compact' : 'full';

// Initialize services (will be injected in main server)
let supabaseService: SupabaseService;
let cacheService: CacheService;

// Initialize function to be called from main server
export const initializeGroupRoutes = (supabase: SupabaseService, cache: CacheService) => {
  supabaseService = supabase;
  cacheService = cache;
};

// ===========================================================================
// Listing, unread counts and pending invites.
//
// Scoped to the caller: the service filters to groups they belong to, plus
// the discoverable ones for search. Registered before `/:groupId` so the
// literal paths (`/unread/all`, `/invites/pending`) are not swallowed by the
// parameter route.
// ===========================================================================

// GET /api/v1/groups - Get all groups with pagination and search
router.get(
  '/',
  authMiddleware,
  validatePagination,
  validateSearch,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    try {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { page = 1, limit, search, responseProfile } = req.query;
      const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
      const requestedLimit = parseInt((limit as string) || `${DEFAULT_GROUP_PAGE_SIZE}`, 10);
      const limitNum = Math.min(MAX_GROUP_PAGE_SIZE, Math.max(1, requestedLimit || DEFAULT_GROUP_PAGE_SIZE));
      const profile = resolveResponseProfile(responseProfile);

      // Cache key is per-user so each user gets their own groups list
      const cacheKey = userId
        ? `groups:user:${userId}:p${pageNum}:l${limitNum}${search ? `:s${search}` : ''}:profile:${profile}`
        : null;

      if (cacheKey) {
        const cached = await cacheService.get<any[]>(cacheKey);
        if (cached) {
          return res.json({
            success: true,
            data: cached,
            pagination: { page: pageNum, limit: limitNum, total: cached.length },
          });
        }
      }

      const groups = await supabaseService.getGroups({
        page: pageNum,
        limit: limitNum,
        search: search as string,
        userId,
        responseProfile: profile,
      });

      // Cache for 30 seconds — short enough for near-real-time feel, long enough to
      // absorb duplicate/StrictMode requests that fire within milliseconds of each other
      if (cacheKey) {
        await cacheService.set(cacheKey, groups, 30);
      }

      res.json({
        success: true,
        data: groups,
        pagination: { page: pageNum, limit: limitNum, total: groups.length },
        responseProfile: profile,
      });
    } catch (error) {
      console.error('Error in groups route:', error);
      res.status(500).json({ error: clientErrorMessage(error, 'Internal server error') });
    }
  })
);

// GET /api/v1/groups/unread/all - Get unread counts for all groups
// NOTE: This MUST be before /:groupId to avoid route matching issues
router.get(
  '/unread/all',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    try {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const cacheKey = CacheKeys.unreadGroups(userId);
      const cached = await cacheService.get<Record<string, number>>(cacheKey);
      if (cached) {
        return res.json({ success: true, data: cached });
      }

      const unreadCounts = await supabaseService.getAllGroupUnreadCounts(userId);
      await cacheService.set(cacheKey, unreadCounts, CacheTTL.unreadCounts);

      res.json({
        success: true,
        data: unreadCounts,
      });
    } catch (error) {
      console.error('Error getting unread counts:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get unread counts',
      });
    }
  })
);

// GET /api/v1/groups/invites/pending - Pending group invites for the current user
// NOTE: Must be before /:groupId
router.get(
  '/invites/pending',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const invites = await supabaseService.getPendingGroupInvitesForUser(userId);
    res.json({ success: true, data: invites });
  })
);

// POST /api/v1/groups/:groupId/invites/accept - Accept a pending group invite
router.post(
  '/:groupId/invites/accept',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;
    const accepted = await supabaseService.acceptGroupInvite(groupId, userId);
    if (!accepted) {
      return res.status(404).json({
        success: false,
        error: 'No pending invite found for this group',
      });
    }

    await cacheService.delete(`group:${groupId}`);
    await cacheService.deletePattern(`group:members:${groupId}:*`);
    await cacheService.deletePattern('groups:list:*');
    await cacheService.deletePattern('groups:user:*');
    await cacheService.deletePattern(`user:groups:${userId}:*`);

    const group = await supabaseService.getGroupById(groupId, userId);
    res.json({
      success: true,
      data: group,
      message: 'Invite accepted',
    });
  })
);

// POST /api/v1/groups/:groupId/invites/decline - Decline a pending group invite
router.post(
  '/:groupId/invites/decline',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;
    const declined = await supabaseService.declineGroupInvite(groupId, userId);
    if (!declined) {
      return res.status(404).json({
        success: false,
        error: 'No pending invite found for this group',
      });
    }

    await cacheService.delete(`group:${groupId}`);
    await cacheService.deletePattern(`group:members:${groupId}:*`);
    await cacheService.deletePattern('groups:list:*');
    await cacheService.deletePattern('groups:user:*');
    await cacheService.deletePattern(`user:groups:${userId}:*`);

    res.json({
      success: true,
      message: 'Invite declined',
    });
  })
);

// GET /api/v1/groups/:groupId - Get group by ID
router.get(
  '/:groupId',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;

    logger.debug('Fetching group', { groupId, userId });

    const group = await supabaseService.getGroupById(groupId, userId);

    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    res.json({
      success: true,
      data: group,
    });
  })
);

// ===========================================================================
// Group lifecycle — create, update, avatar, delete.
//
// Shared shape: `getGroupById(groupId, userId)` first (404 covers both "no
// such group" and "not yours"), then the admin test against BOTH
// `permissions[userId].admin` and `adminIds`, then the community guard where
// the request touches a community listing, then the write, then cache
// invalidation.
// ===========================================================================

// POST /api/v1/groups - Create new group
router.post(
  '/',
  authMiddleware,
  validateCreateGroup,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { name, description, avatar_url, permissions, invite_id, parent_id, memberIds, courseId, visibility, communityId, communitySurface } = req.body;
    if (await isBarredFromCommunity(userId, { visibility, communityId })) {
      return res.status(403).json({ success: false, error: 'Join this community first' });
    }
    /**
     * Which surface a community group renders as. Defaults to 'board' when a
     * communityId is present, ignored otherwise. Phase 1 does NOT gate 'board'
     * on a moderator role: community_members.role is display-only, there is no
     * promote/demote endpoint, and auto-derived campus communities have
     * created_by = NULL, so a role gate would make board creation impossible
     * on every campus community (spec §3.7).
     */
    const surface: 'board' | 'study_group' | undefined = communityId
      ? communitySurface === 'study_group'
        ? 'study_group'
        : 'board'
      : undefined;
    // Pre-migration there is nowhere to record 'study_group', and silently
    // creating a board instead would drop the user into the wrong surface —
    // the one thing the no-silent-disappearance rule forbids (spec §1.1/§3.1).
    if (surface === 'study_group' && !(await hasGroupCommunitySurface(supabaseService.getClient()))) {
      return res.status(503).json({
        success: false,
        error: COMMUNITY_BOARD_COPY.studyGroupsUnavailable,
      });
    }
    const groupData = {
      name,
      description,
      avatarUrl: avatar_url,
      permissions,
      inviteId: invite_id,
      parentId: parent_id,
      // Academic archive reference (uuid-validated by validateCreateGroup; null = none).
      courseId: courseId ?? null,
      visibility,
      communityId: communityId ?? null,
      communitySurface: surface,
    };

    logger.debug('Creating group', { groupData, userId, memberIds });

    const newGroup = await supabaseService.createGroup(groupData, userId, memberIds);

    const pendingInviteUserIds = (newGroup as { pendingInviteUserIds?: string[] }).pendingInviteUserIds || [];
    if (pendingInviteUserIds.length > 0) {
      const actor = await supabaseService.getUserById(userId);
      const actorLabel = actor?.username ? `@${actor.username}` : actor?.name || 'Someone';
      for (const inviteeId of pendingInviteUserIds) {
        void supabaseService.createNotification(inviteeId, {
          message: `${actorLabel} invited you to join "${newGroup.name}". Open the invite to accept or decline.`,
          link: `/invites/groups/${newGroup.id}`,
          type: 'group_invite',
        }).catch((err) =>
          logger.error('Failed to notify invited group member on create', { err, groupId: newGroup.id, inviteeId })
        );
      }
    }

    // Invalidate groups list cache
    await cacheService.deletePattern('groups:list:*');
    await cacheService.deletePattern('groups:user:*');
    await cacheService.deletePattern('groups:discover:*');

    res.status(201).json({
      success: true,
      data: newGroup,
    });
  })
);

// PUT /api/v1/groups/:groupId - Update group
router.put(
  '/:groupId',
  authMiddleware,
  validateGroupId,
  validateUpdateGroup,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;
    const updateData = req.body;

    logger.debug('Updating group', { groupId, updateData, userId });

    // Check if user has permission to update this group
    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    const updateKeys = Object.keys(updateData || {}).filter(
      (key) => updateData[key] !== undefined,
    );
    const isArchiveOnly =
      updateKeys.length === 1 &&
      updateKeys[0] === 'isArchived' &&
      typeof updateData.isArchived === 'boolean';
    const isAdmin =
      Boolean(group.permissions?.[userId]?.admin) ||
      Boolean(group.adminIds?.includes(userId));

    // Any member may archive/unarchive; other group edits stay admin-only.
    if (!isArchiveOnly && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    // Moving a group into a community (or changing its listing there) needs
    // community membership. Only checked when the body touches the listing;
    // the half the body omits falls back to the group's current value so
    // `{ communityId }` alone on a community-visible group is still guarded.
    const touchesListing =
      updateData?.visibility !== undefined || updateData?.communityId !== undefined;
    if (
      touchesListing &&
      (await isBarredFromCommunity(userId, {
        visibility: updateData.visibility ?? group.visibility,
        communityId:
          updateData.communityId === undefined ? group.communityId : updateData.communityId,
      }))
    ) {
      return res.status(403).json({ success: false, error: 'Join this community first' });
    }

    const updatedGroup = await supabaseService.updateGroup(
      groupId,
      isArchiveOnly ? { isArchived: updateData.isArchived } : updateData,
    );

    // Invalidate group cache
    await cacheService.delete(`group:${groupId}`);
    await cacheService.deletePattern(`group:${groupId}:*`);
    await cacheService.deletePattern('groups:list:*');
    await cacheService.deletePattern('groups:user:*');
    await cacheService.deletePattern('groups:discover:*');

    res.json({
      success: true,
      data: updatedGroup,
    });
  })
);

// POST /api/v1/groups/:groupId/avatar - Upload group avatar to private storage
router.post(
  '/:groupId/avatar',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;
    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({ success: false, error: 'Group not found or access denied' });
    }
    if (!(group.permissions && group.permissions[userId]?.admin) && !(group.adminIds && group.adminIds.includes(userId))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { fileName, base64Data, contentType } = req.body || {};
    if (!fileName || !base64Data) {
      return res.status(400).json({ success: false, error: 'fileName and base64Data are required' });
    }
    if (contentType && !ALLOWED_AVATAR_TYPES.includes(contentType)) {
      return res.status(400).json({
        success: false,
        error: 'contentType must be JPEG, PNG, GIF, or WebP when provided.',
      });
    }

    const estimatedBytes = Math.ceil((String(base64Data).length * 3) / 4);
    if (estimatedBytes > 2 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'Avatar exceeds 2 MB limit' });
    }

    const uploaded = await supabaseService.uploadGroupAvatar({
      groupId,
      fileName,
      base64Data,
      contentType: contentType || 'image/jpeg',
    });

    const updatedGroup = await supabaseService.updateGroup(groupId, { avatarUrl: uploaded.avatarUrl });
    await cacheService.delete(`group:${groupId}`);
    await cacheService.deletePattern('groups:list:*');
    await cacheService.deletePattern('groups:user:*');

    res.json({
      success: true,
      data: {
        ...uploaded,
        group: updatedGroup,
      },
    });
  })
);

// DELETE /api/v1/groups/:groupId - Delete group
router.delete(
  '/:groupId',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;

    logger.debug('Deleting group', { groupId, userId });

    // Check if user has permission to delete this group
    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    // Check if user is admin or owner
    if (!(group.permissions && group.permissions[userId]?.admin) && !(group.adminIds && group.adminIds.includes(userId))) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    // A community's lounge is its only conversation room and belongs to the
    // community, not to whoever opened it. Deleting one takes every message in
    // it (messages cascade on the group). It is minted with no admins, so the
    // check above already refuses today — this makes the rule explicit rather
    // than an accident of how the lounge happens to be configured.
    if (await getCommunitiesService(supabaseService).isCommunityLounge(groupId)) {
      return res.status(403).json({
        success: false,
        error: 'This is a community chat and cannot be deleted.',
      });
    }

    await supabaseService.deleteGroup(groupId);

    // Invalidate caches
    await cacheService.delete(`group:${groupId}`);
    await cacheService.deletePattern('groups:list:*');
    await cacheService.deletePattern('groups:user:*');
    await cacheService.deletePattern(`messages:group:${groupId}:*`);
    await cacheService.deletePattern(`user:groups:*`);

    res.json({
      success: true,
      message: 'Group deleted successfully',
    });
  })
);

// ===========================================================================
// Membership writes — invites, joins, leaves, removals, admin grants.
//
// Group admin authorises the add; `refuseCommunityMemberAdd` then decides
// whether the TARGETS may be pulled in at all. Both checks are required: the
// admin test alone once let a channel admin pull non-members of a community
// straight into one of its channels.
// ===========================================================================

// POST /api/v1/groups/:groupId/members - Add member to group
router.post(
  '/:groupId/members',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;
    const { userId: memberId } = req.body;

    logger.debug('Adding member to group', { groupId, memberId, userId });

    if (!memberId) {
      return res.status(400).json({
        success: false,
        error: 'Member ID is required',
      });
    }

    // Check if user has permission to add members
    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    if (!(group.permissions && group.permissions[userId]?.admin) && !(group.adminIds && group.adminIds.includes(userId))) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const refusal = await refuseCommunityMemberAdd(group, [memberId]);
    if (refusal) {
      return res.status(refusal.status).json({ success: false, error: refusal.error });
    }

    // Admin invites create a pending membership — invitee must accept.
    await supabaseService.addGroupMember(groupId, memberId, { pending: true });

    const groupMeta = await supabaseService.getGroupById(groupId);
    const actor = await supabaseService.getUserById(userId);
    const actorLabel = actor?.username ? `@${actor.username}` : actor?.name || 'An admin';
    if (groupMeta) {
      void supabaseService.createNotification(memberId, {
        message: `${actorLabel} invited you to join "${groupMeta.name}". Open the invite to accept or decline.`,
        link: `/invites/groups/${groupId}`,
        type: 'group_invite',
      }).catch((err) => logger.error('Failed to notify invited group member', { err, groupId, memberId }));
    }

    // Invalidate caches
    await cacheService.delete(`group:${groupId}`);
    await cacheService.deletePattern(`group:members:${groupId}:*`);
    await cacheService.deletePattern('groups:list:*');
    await cacheService.deletePattern('groups:user:*');
    await cacheService.deletePattern(`user:groups:${memberId}:*`);

    res.json({
      success: true,
      data: { invited: true, groupId, userId: memberId },
      message: 'Invite sent. The user must accept before joining the group.',
    });
  })
);

// POST /api/v1/groups/:groupId/members/batch - Add multiple members to group
//
// Same authorisation as the single add, capped at 50 ids, with the service
// splitting the outcome into invited / alreadyMembers / alreadyPending.
//
// FIXED (F10): the batch add used to catch every failure, mark all ids failed
// and still answer 200 { success: true, message: "0 invite(s) sent" } — a total
// outage read to the client exactly like a deliberate no-op. The catch now
// rethrows so `asyncHandler` maps it through the shared `errorHandler` like
// every other route. `results.failed` stays in the payload shape for older
// clients that read it, but it is now always empty: `addGroupMembersBatch`
// reports invited / alreadyMembers / alreadyPending and nothing else, so a 200
// from here means every id landed in one of those three buckets.
// FIXED (F10): `userIds[*]` is now UUID-validated by `validateBatchMemberIds`
// before anything else touches it. Only the array shape and length were checked,
// so arbitrary strings reached the service and the `.in()` filter behind it.
router.post(
  '/:groupId/members/batch',
  authMiddleware,
  validateGroupId,
  validateBatchMemberIds,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;
    const { userIds } = req.body;

    logger.debug('Batch adding members to group', { groupId, count: userIds?.length, userId });

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'userIds array is required and must not be empty',
      });
    }

    if (userIds.length > 50) {
      return res.status(400).json({
        success: false,
        error: 'Cannot add more than 50 members at once',
      });
    }

    // Check if user has permission to add members
    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    if (!(group.permissions && group.permissions[userId]?.admin) && !(group.adminIds && group.adminIds.includes(userId))) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const refusal = await refuseCommunityMemberAdd(group, userIds);
    if (refusal) {
      return res.status(refusal.status).json({ success: false, error: refusal.error });
    }

    const results = {
      invited: [] as string[],
      alreadyMembers: [] as string[],
      alreadyPending: [] as string[],
      failed: [] as string[],
      // Back-compat for older clients that still read `added`
      added: [] as string[],
    };

    try {
      const batchResult = await supabaseService.addGroupMembersBatch(groupId, userIds);
      results.invited = batchResult.invited;
      results.added = batchResult.invited;
      results.alreadyMembers = batchResult.alreadyMembers;
      results.alreadyPending = batchResult.alreadyPending;

      if (results.invited.length > 0) {
        const groupMeta = await supabaseService.getGroupById(groupId);
        const actor = await supabaseService.getUserById(userId);
        const actorLabel = actor?.username ? `@${actor.username}` : actor?.name || 'An admin';
        if (groupMeta) {
          for (const memberId of results.invited) {
            void supabaseService.createNotification(memberId, {
              message: `${actorLabel} invited you to join "${groupMeta.name}". Open the invite to accept or decline.`,
              link: `/invites/groups/${groupId}`,
              type: 'group_invite',
            }).catch((err) =>
              logger.error('Failed to notify invited group member', { err, groupId, memberId })
            );
          }
        }
      }
    } catch (error) {
      // Rethrow. A swallowed failure here answered 200 { success: true } with
      // "0 invite(s) sent", so a Supabase outage and "everyone was already a
      // member" were the same response — the client had no way to retry.
      logger.error('Batch invite members failed', { groupId, error });
      throw error;
    }

    // Invalidate caches (batch method already invalidates on success)
    if (results.invited.length === 0 && results.alreadyMembers.length > 0) {
      await cacheService.delete(`group:${groupId}`);
      await cacheService.deletePattern(`group:members:${groupId}:*`);
    }

    res.json({
      success: true,
      data: results,
      message: `${results.invited.length} invite(s) sent. Invitees must accept before joining.`,
    });
  })
);

// ===========================================================================
// Invite links.
//
// `invite_id` is the bearer token: holding it is what grants the join, so
// these routes look the group up by it rather than by group id. The preview
// is the file's one anonymous route and returns name, description, avatar and
// a count — never member identities.
// ===========================================================================

// GET /api/v1/groups/invite/:inviteId/preview — public, name + memberCount only.
// Used by the WhatsApp/OG unfurl. Must never leak member names.
router.get(
  '/invite/:inviteId/preview',
  asyncHandler(async (req: any, res: any) => {
    const { inviteId } = req.params;
    if (!inviteId) {
      return res.status(400).json({ success: false, error: 'inviteId is required' });
    }

    const group = await supabaseService.getGroupByInviteId(inviteId);
    if (!group || group.isArchived) {
      return res.status(404).json({ success: false, error: 'Invalid or expired invite link' });
    }

    const { count } = await supabaseService.getClient()
      .from('group_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('group_id', group.id)
      .eq('pending', false);

    res.json({
      success: true,
      data: {
        name: group.name,
        memberCount: count ?? 0,
      },
    });
  })
);

// GET /api/v1/groups/invite/:inviteId - Preview group for invite (no join)
router.get(
  '/invite/:inviteId',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { inviteId } = req.params;
    if (!inviteId) {
      return res.status(400).json({ success: false, error: 'inviteId is required' });
    }

    const group = await supabaseService.getGroupByInviteId(inviteId);
    if (!group) {
      return res.status(404).json({ success: false, error: 'Invalid or expired invite link' });
    }
    if (group.isArchived) {
      return res.status(400).json({ success: false, error: 'This group has been archived' });
    }

    const { count } = await supabaseService.getClient()
      .from('group_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('group_id', group.id)
      .eq('pending', false);

    const { data: membership } = await supabaseService.getClient()
      .from('group_members')
      .select('user_id, pending')
      .eq('group_id', group.id)
      .eq('user_id', userId)
      .maybeSingle();

    const isPending = membership?.pending === true;

    res.json({
      success: true,
      data: {
        id: group.id,
        name: group.name,
        description: group.description || '',
        avatarUrl: group.avatarUrl,
        memberCount: count ?? 0,
        alreadyMember: !!membership && !isPending,
        pending: isPending,
      },
    });
  })
);

// POST /api/v1/groups/join - Join a group via invite link
router.post(
  '/join',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { inviteId } = req.body;

    logger.debug('Joining group via invite link', { inviteId, userId });

    if (!inviteId || typeof inviteId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'inviteId is required',
      });
    }

    // Look up group by invite_id
    const group = await supabaseService.getGroupByInviteId(inviteId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Invalid or expired invite link',
      });
    }

    if (group.isArchived) {
      return res.status(400).json({
        success: false,
        error: 'This group has been archived',
      });
    }

    // Invite-link join is user-initiated consent — join as active member immediately.
    const updatedGroup = await supabaseService.addGroupMember(group.id, userId, { pending: false });

    // Invalidate caches
    await cacheService.delete(`group:${group.id}`);
    await cacheService.deletePattern(`group:members:${group.id}:*`);
    await cacheService.deletePattern('groups:list:*');
    await cacheService.deletePattern('groups:user:*');
    await cacheService.deletePattern(`user:groups:${userId}:*`);
    // Discovery lists carry an isMember flag and a member count, both now stale.
    await cacheService.deletePattern('groups:discover:*');

    // Academic feed (Phase 3 · M): visible to the group, not to followers — a
    // join is news to the room you joined, not to the internet.
    const { getActivityFeedService } = await import('../services/activityFeed');
    await getActivityFeedService(supabaseService).record({
      actorId: userId,
      verb: 'joined_group',
      objectType: 'group',
      objectId: group.id,
      audienceType: 'group',
      audienceId: group.id,
      payload: { groupName: group.name },
    });

    res.json({
      success: true,
      data: updatedGroup,
      message: `Successfully joined group "${group.name}"`,
    });
  })
);

// POST /api/v1/groups/:groupId/leave - Current user leaves the group
router.post(
  '/:groupId/leave',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;
    logger.debug('Leaving group', { groupId, userId });

    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    const isMember = await supabaseService.isGroupMember(groupId, userId);
    if (!isMember) {
      return res.status(400).json({
        success: false,
        error: 'You are not a member of this group',
      });
    }

    const isAdmin =
      (group.permissions && group.permissions[userId]?.admin) ||
      (group.adminIds && group.adminIds.includes(userId));
    if (isAdmin && (group.adminIds?.length || 0) <= 1) {
      return res.status(400).json({
        success: false,
        error: 'Cannot leave as the only admin. Promote another member first.',
      });
    }

    await supabaseService.removeGroupMember(groupId, userId);

    await cacheService.delete(`group:${groupId}`);
    await cacheService.deletePattern(`group:members:${groupId}:*`);
    await cacheService.deletePattern('groups:list:*');
    await cacheService.deletePattern('groups:user:*');
    await cacheService.deletePattern(`user:groups:${userId}:*`);

    res.json({
      success: true,
      message: 'Left group successfully',
    });
  })
);

// DELETE /api/v1/groups/:groupId/members/:memberId - Remove member from group
router.delete(
  '/:groupId/members/:memberId',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId, memberId } = req.params;

    logger.debug('Removing member from group', { groupId, memberId, userId });

    // Check if user has permission to remove members
    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    // Users can remove themselves, admins can remove anyone
    if (userId !== memberId && !(group.permissions && group.permissions[userId]?.admin) && !(group.adminIds && group.adminIds.includes(userId))) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const targetIsAdmin =
      (group.permissions && group.permissions[memberId]?.admin) ||
      (group.adminIds && group.adminIds.includes(memberId));
    if (targetIsAdmin && (group.adminIds?.length || 0) <= 1) {
      return res.status(400).json({
        success: false,
        error:
          userId === memberId
            ? 'Cannot leave as the only admin. Promote another member first.'
            : 'Cannot remove the only admin of the group.',
      });
    }

    const updatedGroup = await supabaseService.removeGroupMember(groupId, memberId);

    // Invalidate caches
    await cacheService.delete(`group:${groupId}`);
    await cacheService.deletePattern(`group:members:${groupId}:*`);
    await cacheService.deletePattern('groups:list:*');
    await cacheService.deletePattern('groups:user:*');
    await cacheService.deletePattern(`user:groups:${memberId}:*`);

    res.json({
      success: true,
      data: updatedGroup,
    });
  })
);

// ===========================================================================
// Per-group reads and per-member preferences — roster, stats, mute, read.
//
// The preference routes sit behind `requireGroupMember('groupId')` middleware
// rather than an inline `getGroupById` check, and each writes only the
// caller's own `group_members` row.
// ===========================================================================

// GET /api/v1/groups/:groupId/members - Get group members
router.get(
  '/:groupId/members',
  allowDevAuthBypass() ? optionalAuthMiddleware : authMiddleware,
  requireGroupMember('groupId'),
  validateGroupId,
  validatePagination,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { groupId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const userId = req.user?.id;

    logger.debug('Fetching group members', { groupId, page, limit, userId });

    // Check if group exists (without strict access check for dev)
    const group = await supabaseService.getGroupById(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found',
      });
    }

    // Service caches public member rows only and attaches self PII after the cache hit (SEC-04).
    const members = await supabaseService.getGroupMembers(groupId, {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      requestingUserId: userId,
    });

    res.json({
      success: true,
      data: members,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: members.length,
      },
    });
  })
);

// GET /api/v1/groups/:groupId/stats - Get group statistics
router.get(
  '/:groupId/stats',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId } = req.params;

    logger.debug('Fetching group stats', { groupId, userId });

    // Check if user has access to this group
    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or access denied',
      });
    }

    const cacheKey = `group:stats:${groupId}`;
    let stats = await cacheService.get(cacheKey);

    if (!stats) {
      stats = await supabaseService.getGroupStats(groupId);

      // Cache for 5 minutes
      await cacheService.set(cacheKey, stats, 300);
    }

    res.json({
      success: true,
      data: stats,
    });
  })
);

// GET /api/v1/groups/:groupId/mute - Current mute status for a group
router.get(
  '/:groupId/mute',
  authMiddleware,
  requireGroupMember('groupId'),
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { groupId } = req.params;
    const status = await supabaseService.getChatMute(userId, 'group', groupId);
    res.json({ success: true, data: status });
  })
);

// PUT /api/v1/groups/:groupId/mute - Mute group notifications for a duration
router.put(
  '/:groupId/mute',
  authMiddleware,
  requireGroupMember('groupId'),
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { groupId } = req.params;
    const minutes = resolveChatMuteDurationMinutes(req.body?.duration, req.body?.durationMinutes);
    if (!minutes) {
      return res.status(400).json({
        success: false,
        error: 'Provide duration (1h|8h|24h|7d) or durationMinutes (1-43200)',
      });
    }
    const result = await supabaseService.setChatMute(
      userId,
      'group',
      groupId,
      mutedUntilFromMinutes(minutes)
    );
    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or you are not a member',
      });
    }
    res.json({ success: true, data: result, message: 'Group notifications muted' });
  })
);

// DELETE /api/v1/groups/:groupId/mute - Unmute group notifications
router.delete(
  '/:groupId/mute',
  authMiddleware,
  requireGroupMember('groupId'),
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { groupId } = req.params;
    const success = await supabaseService.clearChatMute(userId, 'group', groupId);
    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or you are not a member',
      });
    }
    res.json({
      success: true,
      data: { muted: false, mutedUntil: null },
      message: 'Group notifications unmuted',
    });
  })
);

// POST /api/v1/groups/:groupId/read - Mark group as read
router.post(
  '/:groupId/read',
  authMiddleware,
  requireGroupMember('groupId'),
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    try {
      const userId = requireAuthUserId(req, res);
      if (!userId) return;

      const { groupId } = req.params;

      const result = await supabaseService.markGroupAsRead(groupId, userId);

      res.json({
        success: result.success,
        previousLastReadAt: result.previousLastReadAt,
        data: { previousLastReadAt: result.previousLastReadAt },
        message: result.success ? 'Group marked as read' : 'Failed to mark group as read',
      });
    } catch (error) {
      console.error('Error marking group as read:', error);
      res.status(500).json({
        success: false,
        previousLastReadAt: null,
        error: 'Failed to mark group as read',
      });
    }
  })
);

// ===========================================================================
// Admin grants.
//
// Any existing admin may promote or demote, and the last admin cannot be
// demoted — the group must never be left with nobody able to administer it.
// Both routes write `adminIds` through `updateGroup`; `permissions` is the
// older shape and is read, not written, here.
// ===========================================================================

// POST /api/v1/groups/:groupId/admins/:memberId - Promote member to admin
router.post(
  '/:groupId/admins/:memberId',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId, memberId } = req.params;
    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({ success: false, error: 'Group not found or access denied' });
    }

    const isAdmin = (group.permissions && group.permissions[userId]?.admin) || group.adminIds?.includes(userId);
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Only group admins can promote members' });
    }

    if (group.adminIds?.includes(memberId)) {
      return res.json({ success: true, data: group });
    }

    const updatedGroup = await supabaseService.updateGroup(groupId, {
      adminIds: [...(group.adminIds || []), memberId],
    });

    await cacheService.delete(`group:${groupId}`);
    await cacheService.deletePattern('groups:list:*');
    await cacheService.deletePattern('groups:user:*');

    res.json({ success: true, data: updatedGroup });
  })
);

// DELETE /api/v1/groups/:groupId/admins/:memberId - Demote admin
router.delete(
  '/:groupId/admins/:memberId',
  authMiddleware,
  validateGroupId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { groupId, memberId } = req.params;
    const group = await supabaseService.getGroupById(groupId, userId);
    if (!group) {
      return res.status(404).json({ success: false, error: 'Group not found or access denied' });
    }

    const isAdmin = (group.permissions && group.permissions[userId]?.admin) || group.adminIds?.includes(userId);
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Only group admins can demote members' });
    }

    if ((group.adminIds?.length || 0) <= 1 && group.adminIds?.includes(memberId)) {
      return res.status(400).json({ success: false, error: 'Cannot demote the only admin' });
    }

    const updatedGroup = await supabaseService.updateGroup(groupId, {
      adminIds: (group.adminIds || []).filter((id: string) => id !== memberId),
    });

    await cacheService.delete(`group:${groupId}`);
    await cacheService.deletePattern('groups:list:*');
    await cacheService.deletePattern('groups:user:*');

    res.json({ success: true, data: updatedGroup });
  })
);

export default router;