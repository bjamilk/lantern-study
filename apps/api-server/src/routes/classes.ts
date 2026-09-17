/**
 * /api/v1/classes — lecturer-first class portal.
 * Contract: docs/phase-teach-portal-contract.md §3.
 */
import { Router, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { PublicError } from '../utils/safeError';
import { AuthenticatedRequest } from '../types';
import { requireAuthUserId } from '../utils/requestAuth';
import type { SupabaseService } from '../services/supabase';
import type { DataLayer } from '../services/data';
import { getClassSectionsService } from '../services/classSections';

const router = Router();
let dataLayer: DataLayer;

// TRANSITIONAL (M2a): the services called below still take the `SupabaseService`
// facade whole, so a flipped route hands them `dataLayer.legacyService`. The seam
// disappears when the `services/` importers are flipped.
// `dataLayer?` because a route module can be imported before its injector
// runs (several suites drive a handler without calling it), exactly as the
// old module-level `supabaseService` read as undefined there.
const legacyService = () => dataLayer?.legacyService as SupabaseService;

export const initializeClassRoutes = (layer: DataLayer): void => {
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

function classes() {
  return getClassSectionsService(dataLayer);
}

router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const role = req.query.role === 'instructor' || req.query.role === 'student' ? req.query.role : 'all';
      const data = await classes().listForUser(userId, role);
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.get(
  '/preview',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await classes().previewByCode(req.query.code);
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.post(
  '/join',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await classes().join(userId, req.body?.code);
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.get(
  '/work',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await classes().studentAssignments(userId);
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.get(
  '/official-materials',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const courseId = typeof req.query.courseId === 'string' ? req.query.courseId : null;
      const data = await classes().publishedMaterialsForStudentCourse(userId, courseId);
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
      const data = await classes().create(userId, req.body ?? {});
      res.status(201).json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.get(
  '/:classId',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await classes().getById(userId, String(req.params.classId));
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.patch(
  '/:classId',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await classes().patch(userId, String(req.params.classId), req.body ?? {});
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.get(
  '/:classId/roster',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const members = await classes().roster(userId, String(req.params.classId));
      res.json({ success: true, data: { members } });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.post(
  '/:classId/members',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await classes().addMemberByUsername(userId, String(req.params.classId), req.body ?? {});
      res.status(201).json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.patch(
  '/:classId/members/:userId',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await classes().patchMember(
        userId,
        String(req.params.classId),
        String(req.params.userId),
        req.body ?? {}
      );
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.post(
  '/:classId/rotate-code',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await classes().rotateCode(userId, String(req.params.classId));
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.get(
  '/:classId/materials',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await classes().listMaterials(userId, String(req.params.classId));
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.post(
  '/:classId/materials',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await classes().addMaterial(userId, String(req.params.classId), req.body ?? {});
      res.status(201).json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.post(
  '/:classId/materials/:materialId/publish',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await classes().setMaterialPublished(
        userId,
        String(req.params.classId),
        String(req.params.materialId),
        true
      );
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.post(
  '/:classId/materials/:materialId/unpublish',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await classes().setMaterialPublished(
        userId,
        String(req.params.classId),
        String(req.params.materialId),
        false
      );
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.post(
  '/:classId/materials/:materialId/copy',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await classes().copyMaterialToNotes(
        userId,
        String(req.params.classId),
        String(req.params.materialId)
      );
      res.status(201).json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.delete(
  '/:classId/materials/:materialId',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await classes().deleteMaterial(
        userId,
        String(req.params.classId),
        String(req.params.materialId)
      );
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.post(
  '/:classId/generate',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await classes().generateFromCorpus(userId, String(req.params.classId), req.body ?? {});
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.get(
  '/:classId/assignments',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await classes().listAssignments(userId, String(req.params.classId));
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.post(
  '/:classId/assignments',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await classes().createAssignment(userId, String(req.params.classId), req.body ?? {});
      res.status(201).json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.post(
  '/:classId/assignments/:assignmentId/complete',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await classes().completeAssignment(
        userId,
        String(req.params.classId),
        String(req.params.assignmentId),
        req.body ?? {}
      );
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

router.get(
  '/:classId/analytics',
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const data = await classes().analytics(userId, String(req.params.classId));
      res.json({ success: true, data });
    } catch (err) {
      handle(err, res);
    }
  })
);

export default router;
