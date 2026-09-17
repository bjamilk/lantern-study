/**
 * Institution staff + LMS stub (docs/phase-teach-portal-contract.md §3).
 */
import { Router, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { PublicError } from '../utils/safeError';
import { AuthenticatedRequest } from '../types';
import { requireAuthUserId } from '../utils/requestAuth';
import type { DataLayer } from '../services/data';
import { getClassSectionsService } from '../services/classSections';

const router = Router();
let dataLayer: DataLayer;


export const initializeInstitutionStaffRoutes = (layer: DataLayer): void => {
  dataLayer = layer;
};

function handle(err: unknown, res: Response): void {
  if (err instanceof PublicError) {
    const status = (err as unknown as { statusCode?: number }).statusCode;
    res.status(typeof status === 'number' ? status : 400).json({ success: false, error: err.message });
    return;
  }
  throw err;
}

function svc() {
  return getClassSectionsService(dataLayer);
}

router.get(
  '/staff/me',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await svc().listMyStaff(userId);
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.get(
  '/lms/connectors',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    res.json({ success: true, data: svc().lmsConnectors() });
  })
);

router.get(
  '/institutions/:institutionId/staff',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await svc().listStaff(userId, String(req.params.institutionId), req.user);
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.post(
  '/institutions/:institutionId/staff',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await svc().addStaff(userId, String(req.params.institutionId), req.body ?? {}, req.user);
      res.status(201).json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.patch(
  '/institutions/:institutionId/staff/:userId',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await svc().patchStaff(
        userId,
        String(req.params.institutionId),
        String(req.params.userId),
        req.body ?? {},
        req.user
      );
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.get(
  '/institutions/:institutionId/analytics',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await svc().institutionAnalytics(userId, String(req.params.institutionId), req.user);
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

export default router;
