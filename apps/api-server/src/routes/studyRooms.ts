/**
 * Study rooms (Phase 4 · V). Mounted at /api/v1/study-rooms.
 * Pull-based roster. Clients may open one presence channel for the room they are in.
 */
import { Router, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import type { SupabaseService } from '../services/supabase';
import type { DataLayer } from '../services/data';
import { getStudyRoomsService } from '../services/studyRooms';
import { PublicError } from '../utils/safeError';
import { AuthenticatedRequest } from '../types';
import { requireAuthUserId } from '../utils/requestAuth';

const router = Router();
let dataLayer: DataLayer;

// TRANSITIONAL (M2a): the services called below still take the `SupabaseService`
// facade whole, so a flipped route hands them `dataLayer.legacyService`. The seam
// disappears when the `services/` importers are flipped.
// `dataLayer?` because a route module can be imported before its injector
// runs (several suites drive a handler without calling it), exactly as the
// old module-level `supabaseService` read as undefined there.
const legacyService = () => dataLayer?.legacyService as SupabaseService;

export const initializeStudyRoomRoutes = (layer: DataLayer): void => {
  dataLayer = layer;
};

function handle(err: unknown, res: Response): void {
  if (err instanceof PublicError) {
    const code = typeof (err as any).statusCode === 'number' ? (err as any).statusCode : 400;
    res.status(code).json({ success: false, error: err.message });
    return;
  }
  throw err;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
/** Non-uuid scope values are ignored, not rejected — the hub list stays reachable. */
const uuidParam = (v: unknown): string | undefined => {
  const s = str(v);
  return s && UUID_RE.test(s) ? s : undefined;
};

// GET /api/v1/study-rooms?communityId=&courseId= — the Room tab (no params)
// or a community's rooms (community_id OR the community's course_id).
router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getStudyRoomsService(legacyService()).list(userId, {
        communityId: uuidParam(req.query.communityId),
        courseId: uuidParam(req.query.courseId),
      });
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  }),
);

router.post(
  '/join-or-create',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const body = (req.body ?? {}) as {
        courseId?: string;
        communityId?: string;
        topicId?: string;
        topic?: string;
        title?: string;
      };
      const data = await getStudyRoomsService(legacyService()).joinOrCreate(userId, body);
      res.status(201).json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  }),
);

router.get(
  '/:id',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getStudyRoomsService(legacyService()).get(userId, req.params.id);
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  }),
);

router.post(
  '/:id/join',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getStudyRoomsService(legacyService()).join(userId, req.params.id);
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  }),
);

router.post(
  '/:id/leave',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getStudyRoomsService(legacyService()).leave(userId, req.params.id);
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  }),
);

export default router;
