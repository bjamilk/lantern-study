import { Response } from 'express';
import { attachJobCharge } from './jobStatus';
import type { AiJobCharge } from './enqueue';

/** The charge the rate-limit middleware recorded for this request, if any. */
export function aiChargeFromRes(res: Response): AiJobCharge | undefined {
  const charge = (res.locals as { aiCharge?: AiJobCharge }).aiCharge;
  return charge && charge.credits > 0 ? charge : undefined;
}

/**
 * A 202 is a 2xx, so the rate-limit middlewares' non-2xx auto-refund can
 * never fire for async work. Stamp what this request reserved onto the job
 * record; the worker refunds it if the job permanently fails. Call from any
 * handler that answers 202 with a jobId without using sendAsyncJobAccepted.
 */
export function stampAiChargeOnJob(res: Response, jobId: string): void {
  const charge = (res.locals as { aiCharge?: { credits: number; featureKey?: string } }).aiCharge;
  if (charge && charge.credits > 0) {
    void attachJobCharge(jobId, charge).catch(() => {
      /* best-effort: without the stamp the job simply can't auto-refund */
    });
  }
}

export function sendAsyncJobAccepted(res: Response, jobId: string): void {
  stampAiChargeOnJob(res, jobId);

  res.status(202).json({
    success: true,
    jobId,
    status: 'queued',
    pollUrl: `/api/v1/jobs/${jobId}`,
  });
}
