/**
 * /api/v1/schools — instructor affiliation beyond the tertiary catalogue.
 * Contract: docs/phase-teach-portal-contract.md.
 */
import { Router, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { PublicError } from '../utils/safeError';
import { AuthenticatedRequest } from '../types';
import { requireAuthUserId } from '../utils/requestAuth';
import type { SupabaseService } from '../services/supabase';
import type { DataLayer } from '../services/data';
import { getAcademicCoursesService } from '../services/academicCourses';
import { isSchoolKind } from '@lantern/shared/academic';

const router = Router();
let dataLayer: DataLayer;

// TRANSITIONAL (M2a): the services called below still take the `SupabaseService`
// facade whole, so a flipped route hands them `dataLayer.legacyService`. The seam
// disappears when the `services/` importers are flipped.
// `dataLayer?` because a route module can be imported before its injector
// runs (several suites drive a handler without calling it), exactly as the
// old module-level `supabaseService` read as undefined there.
const legacyService = () => dataLayer?.legacyService as SupabaseService;

export const initializeSchoolRoutes = (layer: DataLayer): void => {
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

function schools() {
  return getAcademicCoursesService(legacyService());
}

router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const kindRaw = typeof req.query.kind === 'string' ? req.query.kind : null;
      const kind = isSchoolKind(kindRaw) ? kindRaw : null;
      const data = await schools().searchSchools({ q, kind });
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.post(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const { school, created } = await schools().findOrCreateSchool(userId, {
        name: req.body?.name,
        kind: req.body?.kind,
        city: req.body?.city,
        state: req.body?.state,
      });
      res.status(created ? 201 : 200).json({ success: true, data: school });
    } catch (err) {
      handle(err, res);
    }
  })
);

export default router;
