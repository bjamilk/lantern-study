import { Response } from 'express';

export function sendAsyncJobAccepted(res: Response, jobId: string): void {
  res.status(202).json({
    success: true,
    jobId,
    status: 'queued',
    pollUrl: `/api/v1/jobs/${jobId}`,
  });
}
