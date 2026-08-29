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
import { getCommunitiesService } from '../services/communities';
import { getStudyPresenceService } from '../services/studyPresence';
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
      const body = (req.body ?? {}) as { name?: string; description?: string; tags?: string[] };
      const data = await getCommunitiesService(supabaseService).createTopicCommunity(userId, body);
      res.status(201).json({ success: true, data });
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

// GET /api/v1/communities/:communityId/members
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
        req.query.limit ? Number(req.query.limit) : undefined
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
    const data = await getCommunitiesService(supabaseService).discoverCommunities(userId, {
      q: str(req.query.q),
      kind: str(req.query.kind),
      institutionId: str(req.query.institutionId),
      courseId: str(req.query.courseId),
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ success: true, data });
  })
);

discoverRouter.get(
  '/groups',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const data = await getCommunitiesService(supabaseService).discoverGroups(userId, {
      q: str(req.query.q),
      communityId: str(req.query.communityId),
      courseId: str(req.query.courseId),
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ success: true, data });
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
    const data = await getCommunitiesService(supabaseService).discoverPeople(userId, {
      q: str(req.query.q),
      institutionId: str(req.query.institutionId),
      courseId: str(req.query.courseId),
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ success: true, data });
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
