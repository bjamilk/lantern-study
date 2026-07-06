import { Request, Response, NextFunction } from 'express';
import {
  isMarketplaceCountryEnabled,
  MARKETPLACE_DEFAULT_COUNTRY,
} from '@lantern/shared/marketplace';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function getUserMarketplaceCountry(req: Request): string | null {
  if (!(req as any).user?.id) return null;
  const settings = (req as any).user?.settings;
  const fromSettings =
    settings && typeof settings === 'object' && settings.marketplace?.country_code
      ? String(settings.marketplace.country_code).toUpperCase()
      : null;
  if (fromSettings && isMarketplaceCountryEnabled(fromSettings)) return fromSettings;
  return MARKETPLACE_DEFAULT_COUNTRY;
}

/** Enforce Nigeria-first marketplace compliance on writes and default read country filter. */
export function marketplaceGeoMiddleware(req: Request, res: Response, next: NextFunction) {
  const base = req.baseUrl || '';
  if (!base.endsWith('/marketplace')) {
    return next();
  }

  if (req.method === 'GET') {
    if (!req.query.country_code && !req.query.countryCode) {
      req.query.country_code = MARKETPLACE_DEFAULT_COUNTRY;
    }
    return next();
  }

  if (!MUTATION_METHODS.has(req.method.toUpperCase())) {
    return next();
  }

  const userCountry = getUserMarketplaceCountry(req);
  if (!userCountry) {
    return res.status(403).json({
      success: false,
      error:
        'Marketplace is available for Nigerian campus communities. Set your marketplace country in Settings.',
    });
  }

  const cfCountry = req.headers['cf-ipcountry'];
  if (
    typeof cfCountry === 'string' &&
    cfCountry.toUpperCase() !== 'T1' &&
    !isMarketplaceCountryEnabled(cfCountry)
  ) {
    return res.status(403).json({
      success: false,
      error: 'Marketplace transactions are not available from your region.',
    });
  }

  return next();
}
