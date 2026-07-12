import { Request, Response, NextFunction } from 'express';
import { readAccessCookie, readRefreshCookie } from '../utils/authCookies';
import { hasAuthCredential } from './rateLimit';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_HEADER = 'x-requested-with';
const CSRF_VALUE = 'LanternStudy';

function hasAuthCookie(req: Request): boolean {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (!cookies) return false;
  return !!(readAccessCookie(cookies) || readRefreshCookie(cookies));
}

/** Require a custom header on cookie-authenticated mutating requests (CSRF mitigation). */
export function csrfProtectionMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING.has(req.method)) {
    next();
    return;
  }

  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.trim()) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.trim().length > 0) {
    next();
    return;
  }

  if (!hasAuthCookie(req) && !hasAuthCredential(req)) {
    next();
    return;
  }

  const header = req.headers[CSRF_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === CSRF_VALUE) {
    next();
    return;
  }

  res.status(403).json({
    success: false,
    error: 'Forbidden',
    message: 'Missing or invalid CSRF protection header.',
    code: 'CSRF_VALIDATION_FAILED',
  });
}

export const CSRF_REQUEST_HEADER = CSRF_HEADER;
export const CSRF_REQUEST_VALUE = CSRF_VALUE;
