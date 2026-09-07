/**
 * Communities + the Discover hub (Phase 3 · L).
 *
 * Discovery reads are deliberately separate from `GET /groups`, which is
 * memberships-only and cached per user. Mounted at /api/v1/communities and
 * /api/v1/discover.
 */
import { Router, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { SupabaseService } from '../services/supabase';
import {
  getCommunitiesService,
  normalizePublicCommunitySlug,
  type CommunityPublicSummary,
} from '../services/communities';
import { cacheService } from '../services/cache';
import { getStudyPresenceService } from '../services/studyPresence';
import { getCommunityModerationService } from '../services/communityModeration';
import { PublicError } from '../utils/safeError';
import { AuthenticatedRequest } from '../types';
import { requireAuthUserId } from '../utils/requestAuth';

const router = Router();
export const discoverRouter = Router();

let supabaseService: SupabaseService;

export const initializeCommunityRoutes = (supabase: SupabaseService): void => {
  supabaseService = supabase;
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Only PublicError becomes a client-visible status; everything else is a 500. */
function handle(err: unknown, res: Response): void {
  if (err instanceof PublicError) {
    const code = typeof (err as any).statusCode === 'number' ? (err as any).statusCode : 400;
    res.status(code).json({ success: false, error: err.message });
    return;
  }
  throw err;
}

// GET /api/v1/communities/public/:slug — the ONE unauthenticated community
// read. It backs the crawler join card at /discover/c/:slug (functions/discover/
// c/[[path]].ts), so a community link pasted into a WhatsApp group unfurls as
// "join this room" instead of nothing.
//
// Registered FIRST on purpose. Express matches in registration order, and
// `/:communityId/members` etc. are also two-segment patterns: a community whose
// slug were literally "members" would otherwise be swallowed by one of them.
// (`/:slug` is one segment and can never shadow this.)
//
// Public + crawled, so it is cached hard on both sides, exactly like
// routes/campuses.ts. Unauthenticated callers are still bounded by the global
// anonymousIpRateLimit that server.ts applies ahead of every router.
router.get(
  '/public/:slug',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const slug = normalizePublicCommunitySlug(req.params.slug);
    if (!slug) {
      res.set('Cache-Control', 'public, max-age=600');
      res.status(404).json({ success: false, error: 'Community not found' });
      return;
    }

    const cacheKey = `communities:public:${slug}`;
    const cached = await cacheService.get<CommunityPublicSummary>(cacheKey);
    if (cached) {
      res.set('Cache-Control', 'public, max-age=600');
      res.json({ success: true, data: cached });
      return;
    }

    const data = await getCommunitiesService(supabaseService).publicSummaryBySlug(slug);
    if (!data) {
      // Unknown AND private answer the same way: the card must not become an
      // oracle for whether a private room exists.
      res.set('Cache-Control', 'public, max-age=600');
      res.status(404).json({ success: false, error: 'Community not found' });
      return;
    }

    // Name/kind/institution never move and member_count moves slowly.
    await cacheService.set(cacheKey, data, 600);
    res.set('Cache-Control', 'public, max-age=600');
    res.json({ success: true, data });
  })
);

// GET /api/v1/communities — the caller's own communities
router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await getCommunitiesService(supabaseService).listMine(userId);
    res.json({ success: true, data });
  })
);

// POST /api/v1/communities — create a horizontal (topic) community
router.post(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const body = (req.body ?? {}) as {
        name?: string;
        description?: string;
        tags?: string[];
        kind?: string;
        visibility?: string;
        startsAt?: string | null;
        endsAt?: string | null;
        location?: string | null;
      };
      const data = await getCommunitiesService(supabaseService).createCommunity(userId, body);
      res.status(201).json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

// POST /api/v1/communities/join-by-code — the ONLY way into a private
// community.
//
// Registered before `/:slug` and before every `/:communityId/...` pattern:
// Express matches in registration order, and a community whose slug were
// literally "join-by-code" would otherwise swallow it.
//
// Every refusal answers the SAME string with the same status, so this
// endpoint cannot become an oracle for which codes are real or which private
// communities exist.
router.post(
  '/join-by-code',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      await getCommunitiesService(supabaseService).assertCanAccessCommunities(userId);
      const data = await getCommunityModerationService(supabaseService).joinByCode(
        userId,
        (req.body ?? {}).code
      );
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

// GET /api/v1/communities/:communityId/invites — moderators only
router.get(
  '/:communityId/invites',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getCommunityModerationService(supabaseService).listInvites(
        userId,
        req.params.communityId
      );
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

// POST /api/v1/communities/:communityId/invites { expiresInMs?, maxUses? }
router.post(
  '/:communityId/invites',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const body = (req.body ?? {}) as { expiresInMs?: unknown; maxUses?: unknown };
      const data = await getCommunityModerationService(supabaseService).createInvite(
        userId,
        req.params.communityId,
        body
      );
      res.status(201).json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

// DELETE /api/v1/communities/:communityId/invites/:code
router.delete(
  '/:communityId/invites/:code',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getCommunityModerationService(supabaseService).revokeInvite(
        userId,
        req.params.communityId,
        req.params.code
      );
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

// POST /api/v1/communities/:communityId/members/:userId/role { role }
//
// Owner-only (or a platform admin — the only moderation an auto-derived
// campus room has, because it has no owner).
router.post(
  '/:communityId/members/:userId/role',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const actorId = requireAuthUserId(req, res);
    if (!actorId) return;
    try {
      const data = await getCommunityModerationService(supabaseService).setMemberRole(
        actorId,
        req.params.communityId,
        req.params.userId,
        (req.body ?? {}).role
      );
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

// POST /api/v1/communities/:communityId/members/:userId/mute { duration?, reason? }
//
// Omitting `duration` UNMUTES. There is no permanent mute: a muted member
// reads everything and cannot post, and a mute nobody lifts is a ban with no
// appeal — bans belong to the Phase 1 · E suspension machinery.
router.post(
  '/:communityId/members/:userId/mute',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const actorId = requireAuthUserId(req, res);
    if (!actorId) return;
    try {
      const body = (req.body ?? {}) as { duration?: unknown; reason?: unknown };
      const data = await getCommunityModerationService(supabaseService).muteMember(
        actorId,
        req.params.communityId,
        req.params.userId,
        body
      );
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

// DELETE /api/v1/communities/:communityId/posts/:postId { reason? }
//
// A SOFT removal (removed_at / removed_by / removed_reason). The card stays
// as a tombstone, so a reader who saw the post is told what happened.
router.delete(
  '/:communityId/posts/:postId',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const actorId = requireAuthUserId(req, res);
    if (!actorId) return;
    try {
      const data = await getCommunityModerationService(supabaseService).removePost(
        actorId,
        req.params.communityId,
        req.params.postId,
        (req.body ?? {}).reason
      );
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

// GET /api/v1/communities/:slug
router.get(
  '/:slug',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getCommunitiesService(supabaseService).getBySlug(userId, req.params.slug);
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

// GET /api/v1/communities/:communityId/members?limit&cursor — the roster,
// keyset-paged (CommunityMembersPage). Members only. A caller who may moderate
// also gets each member's `mutedUntil`; nobody else is told who is muted.
router.get(
  '/:communityId/members',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getCommunitiesService(supabaseService).listMembers(
        userId,
        req.params.communityId,
        {
          limit: req.query.limit ? Number(req.query.limit) : undefined,
          cursor: str(req.query.cursor),
        }
      );
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

// GET /api/v1/communities/:communityId/channels — the community as a server:
// lounge, text channels, open study rooms, head counts (CommunityChannels).
// Guests of a public community get public channels only. Uncached.
router.get(
  '/:communityId/channels',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getCommunitiesService(supabaseService).listChannels(
        userId,
        req.params.communityId
      );
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

// POST /api/v1/communities/:communityId/lounge — open (mint if needed) the
// community's persistent chat and join the caller. Members only; 503 until
// the 20260829170000 migration is applied.
router.post(
  '/:communityId/lounge',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getCommunitiesService(supabaseService).openLounge(
        userId,
        req.params.communityId
      );
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

// POST /api/v1/communities/:communityId/join
router.post(
  '/:communityId/join',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getCommunitiesService(supabaseService).join(userId, req.params.communityId);
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

// DELETE /api/v1/communities/:communityId/join
router.delete(
  '/:communityId/join',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getCommunitiesService(supabaseService).leave(userId, req.params.communityId);
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

// ---------------------------------------------------------------------------
// /api/v1/discover — the Discover hub's four tabs
// ---------------------------------------------------------------------------

discoverRouter.get(
  '/communities',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getCommunitiesService(supabaseService).discoverCommunities(userId, {
        q: str(req.query.q),
        kind: str(req.query.kind),
        institutionId: str(req.query.institutionId),
        courseId: str(req.query.courseId),
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json({ success: true, data });
    } catch (err) {
      // The gate refuses with a PublicError 403; anything else is a 500.
      handle(err, res);
    }
  })
);

discoverRouter.get(
  '/groups',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getCommunitiesService(supabaseService).discoverGroups(userId, {
        q: str(req.query.q),
        communityId: str(req.query.communityId),
        courseId: str(req.query.courseId),
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json({ success: true, data });
    } catch (err) {
      // The gate refuses with a PublicError 403; anything else is a 500.
      handle(err, res);
    }
  })
);

discoverRouter.post(
  '/groups/:groupId/join',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getCommunitiesService(supabaseService).joinDiscoverableGroup(
        userId,
        req.params.groupId
      );
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

discoverRouter.get(
  '/people',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getCommunitiesService(supabaseService).discoverPeople(userId, {
        q: str(req.query.q),
        institutionId: str(req.query.institutionId),
        courseId: str(req.query.courseId),
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json({ success: true, data });
    } catch (err) {
      // The gate refuses with a PublicError 403; anything else is a 500.
      handle(err, res);
    }
  })
);

// GET /api/v1/discover/presence?courseId= — "23 studying cardiology tonight"
discoverRouter.get(
  '/presence',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await getStudyPresenceService(supabaseService).now(userId, {
      courseId: str(req.query.courseId) ?? null,
      institutionId: str(req.query.institutionId) ?? null,
    });
    res.json({ success: true, data });
  })
);

export default router;
