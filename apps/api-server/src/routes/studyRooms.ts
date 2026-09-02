/**
 * Study rooms (Phase 4 · V). Mounted at /api/v1/study-rooms.
 * Pull-based roster. Clients may open one presence channel for the room they are in.
 */
import { Router, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { SupabaseService } from '../services/supabase';
import { getStudyRoomsService } from '../services/studyRooms';
import { PublicError } from '../utils/safeError';
import { AuthenticatedRequest } from '../types';
import { requireAuthUserId } from '../utils/requestAuth';

const router = Router();
let supabaseService: SupabaseService;

export const initializeStudyRoomRoutes = (supabase: SupabaseService): void => {
  supabaseService = supabase;
};

function handle(err: unknown, res: Response): void {
  if (err instanceof PublicError) {
    const code = typeof (err as any).statusCode === 'number' ? (err as any).statusCode : 400;
    res.status(code).json({ success: false, error: err.message });
    return;
  }
  throw err;
}

router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await getStudyRoomsService(supabaseService).list(userId);
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
      const data = await getStudyRoomsService(supabaseService).joinOrCreate(userId, body);
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
      const data = await getStudyRoomsService(supabaseService).get(userId, req.params.id);
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
      const data = await getStudyRoomsService(supabaseService).join(userId, req.params.id);
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
      const data = await getStudyRoomsService(supabaseService).leave(userId, req.params.id);
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  }),
);

export default router;
