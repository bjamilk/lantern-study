import { Request, Response, NextFunction } from 'express';
import { MARKETPLACE_DEFAULT_COUNTRY } from '@lantern/shared/marketplace';

/**
 * Keep the catalog Nigeria/NGN scoped without treating a user's IP address or
 * saved campus as an authorization boundary. Campus is listing metadata and an
 * explicit browse filter; authentication and transaction authorization remain
 * the responsibility of the route-level middleware and services.
 */
export function marketplaceGeoMiddleware(req: Request, _res: Response, next: NextFunction) {
  const base = req.baseUrl || '';
  if (!base.endsWith('/marketplace')) {
    return next();
  }

  if (req.method === 'GET') {
    if (!req.query.country_code && !req.query.countryCode) {
      req.query.country_code = MARKETPLACE_DEFAULT_COUNTRY;
    }
  }
  return next();
}
