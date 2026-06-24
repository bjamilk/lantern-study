import { Request, Response, NextFunction } from 'express';
import { isPublicReadRequest, isPublicWriteRequest } from './publicRoutes';
import { publicReadRateLimit, publicWriteRateLimit } from './rateLimit';

/** Apply stricter rate limits to unauthenticated public endpoints. */
export function applyPublicRateLimits(req: Request, res: Response, next: NextFunction): void {
  if (isPublicWriteRequest(req)) {
    publicWriteRateLimit(req, res, next);
    return;
  }
  if (isPublicReadRequest(req)) {
    publicReadRateLimit(req, res, next);
    return;
  }
  next();
}
