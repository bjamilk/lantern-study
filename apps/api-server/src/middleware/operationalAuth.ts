import { Request, Response, NextFunction } from 'express';

/** Restrict /ready and /metrics to a shared operational token in production. */
export function requireOperationalAccess(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV !== 'production') {
    next();
    return;
  }

  const token = process.env.OPERATIONAL_ACCESS_TOKEN;
  const headerToken = req.headers['x-operational-token'];
  if (token && typeof headerToken === 'string' && headerToken === token) {
    next();
    return;
  }

  res.status(403).json({ error: 'Forbidden' });
}
