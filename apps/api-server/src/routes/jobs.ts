import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { getJobRecord } from '../queue/jobStatus';
import { requireAuthUserId } from '../utils/requestAuth';
import { isLivePlatformAdmin } from '../utils/platformAdminAuth';

const router = Router();

router.get(
  '/:jobId',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;

    const { jobId } = req.params;
    const job = await getJobRecord(jobId);

    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    if (job.userId && job.userId !== userId && !(await isLivePlatformAdmin(req.user?.id ?? ''))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    res.json({ success: true, data: job });
  })
);

export default router;
