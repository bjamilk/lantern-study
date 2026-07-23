import { Request, Response, NextFunction } from 'express';
import {
  isMarketplaceCountryEnabled,
  MARKETPLACE_DEFAULT_COUNTRY,
} from '@lantern/shared/marketplace';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Paths where buyer/seller money motion happens. IP geo is enforced here only.
 * Listing create/upload must work for Nigerian-campus sellers abroad (and for
 * staging smoke tests outside NG) — campus + country_code still gate compliance.
 */
const IP_GEO_ENFORCED_PATHS =
  /^\/(listings\/[^/]+\/buy-now|offers(?:\/[^/]+)?|orders(?:\/|$)|transactions(?:\/|$))/i;

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

function relativeMarketplacePath(req: Request): string {
  const full = (req.originalUrl || req.url || '').split('?')[0];
  const idx = full.indexOf('/marketplace');
  if (idx === -1) return req.path || '/';
  return full.slice(idx + '/marketplace'.length) || '/';
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

  const path = relativeMarketplacePath(req);
  if (IP_GEO_ENFORCED_PATHS.test(path)) {
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
  }

  return next();
}
