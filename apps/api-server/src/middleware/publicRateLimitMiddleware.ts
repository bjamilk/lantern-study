import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { isPublicReadRequest, isPublicWriteRequest } from './publicRoutes';
import {
  authenticatedRateLimit,
  publicReadRateLimit,
  publicWriteRateLimit,
} from './rateLimit';

/** Verified session on a public route uses per-user limits instead of IP public caps. */
export function usesAuthenticatedPublicLimit(req: AuthenticatedRequest): boolean {
  return Boolean(req.user?.id);
}

/** Apply stricter rate limits to unauthenticated public endpoints. */
export function applyPublicRateLimits(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const isPublicWrite = isPublicWriteRequest(req);
  const isPublicRead = isPublicReadRequest(req);

  if (!isPublicWrite && !isPublicRead) {
    next();
    return;
  }

  if (usesAuthenticatedPublicLimit(req)) {
    authenticatedRateLimit(req, res, next);
    return;
  }

  if (isPublicWrite) {
    publicWriteRateLimit(req, res, next);
    return;
  }

  publicReadRateLimit(req, res, next);
}
