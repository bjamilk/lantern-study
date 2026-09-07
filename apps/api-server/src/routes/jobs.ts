import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { getJobRecord, reconcileJobTimeout } from '../queue/jobStatus';
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
    const record = await getJobRecord(jobId);

    if (!record) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    if (record.userId && record.userId !== userId && !(await isLivePlatformAdmin(req.user?.id ?? ''))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Only once the caller is known to own the job: a stranger polling an id
    // must not be able to drive someone else's refund.
    const job = (await reconcileJobTimeout(record)) ?? record;

    // The full record is the client contract: stage/percent drive the honest
    // progress a student sees, resultRef says where the work landed, and
    // credit is the ledger. `errorMessage` is the flat string older shipped
    // builds read off `error`.
    //
    // `push` (what happened to the completion notification) is the owner's
    // alone: it names their device registration and their notification
    // preferences, so an admin reading someone else's job never sees it.
    const isOwner = !!job.userId && job.userId === userId;
    const { push, ...rest } = job as typeof job & { push?: unknown };

    res.json({
      success: true,
      data: {
        ...rest,
        ...(isOwner && push ? { push } : {}),
        errorMessage: job.error?.message,
      },
    });
  })
);

export default router;
