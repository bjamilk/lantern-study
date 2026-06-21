import { Request, Response, NextFunction } from 'express';

function isPrivateOrLocalIp(req: Request): boolean {
  const raw = req.ip || req.socket.remoteAddress || '';
  const ip = raw.replace(/^::ffff:/, '');
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.')) return true;
  return false;
}

/** Restrict /ready and /metrics to local/private networks or a shared operational token. */
export function requireOperationalAccess(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.OPERATIONAL_ACCESS_TOKEN;
  const headerToken = req.headers['x-operational-token'];
  if (token && typeof headerToken === 'string' && headerToken === token) {
    next();
    return;
  }

  if (process.env.NODE_ENV !== 'production') {
    next();
    return;
  }

  if (isPrivateOrLocalIp(req)) {
    next();
    return;
  }

  res.status(403).json({ error: 'Forbidden' });
}
