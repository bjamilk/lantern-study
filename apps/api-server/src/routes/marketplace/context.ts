/**
 * Shared state and helpers for the marketplace sub-routers.
 *
 * `supabaseService` and `cacheService` are injected once from server.ts (via
 * `initializeMarketplaceRoutes` in ./index) and then read as live ES-module
 * bindings by every sub-router — the same single-assignment shape the file had
 * before the R5a split, without threading the services through ten modules.
 */
import type { SupabaseService } from '../../services/supabase';
import type { DataLayer } from '../../services/data';
import { CacheService } from '../../services/cache';
import { MARKETPLACE_DEFAULT_COUNTRY, OTHER_CITY_CAMPUS_SLUG } from '@lantern/shared/marketplace';
import { PublicError } from '../../utils/safeError';
import { createHash } from 'crypto';

// Initialized from the main server; every sub-router imports these bindings.
export let dataLayer: DataLayer;
/**
 * TRANSITIONAL (M2a): several sub-routers still hand the `SupabaseService`
 * facade whole to the `services/` singletons that take it
 * (`getMarketplaceOrdersService`, `getMarketplacePaymentsService`, …). It is
 * the SAME instance the data layer is built from (`dataLayer.legacyService`),
 * and this binding disappears when those callees are flipped.
 */
export let supabaseService: SupabaseService;
export let cacheService: CacheService;

export const initializeMarketplaceContext = (layer: DataLayer, cache: CacheService) => {
  dataLayer = layer;
  supabaseService = layer.legacyService;
  cacheService = cache;
};

/**
 * Stable hash of the fields that define "this request". Used to build a
 * fallback idempotency key when the client sends no Idempotency-Key header, so
 * two different requests from the same user in the same window can never share
 * a key (and therefore a cached response).
 */
export function requestContentHash(content: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 32);
}

/** marketplace_orders.fulfillment_mode CHECK — the only accepted values. */
export const FULFILLMENT_MODES = ['campus_meetup', 'hall_dropoff'] as const;

/**
 * Campus/city metadata rejection. A `PublicError` subclass rather than a bare
 * `new Error` so ./errors classifies it explicitly — R5a removed the name-check
 * heuristic that used to surface it as a 400 by accident. Still 400, and now the
 * real message survives `clientErrorMessage` in production.
 */
export class MarketplaceCampusMetadataError extends PublicError {
  constructor(message: string) {
    super(message);
    this.name = 'MarketplaceCampusMetadataError';
  }
}

export async function resolveRequiredMarketplaceCampus(
  rawCampusId: unknown,
  rawLocation: unknown
): Promise<{ campusId: string; countryCode: string }> {
  const campusId = typeof rawCampusId === 'string' ? rawCampusId.trim() : '';
  if (!campusId) {
    throw new MarketplaceCampusMetadataError(
      'Campus or city metadata is required for marketplace listings'
    );
  }

  const campus = await supabaseService.getMarketplaceCampusById(campusId);
  if (!campus || !campus.active || campus.country_code !== MARKETPLACE_DEFAULT_COUNTRY) {
    throw new MarketplaceCampusMetadataError('Invalid or inactive Nigerian campus or city');
  }

  if (
    campus.slug === OTHER_CITY_CAMPUS_SLUG &&
    (typeof rawLocation !== 'string' || !rawLocation.trim())
  ) {
    throw new MarketplaceCampusMetadataError(
      'Enter the Nigerian city or pickup/delivery area for the Other city option'
    );
  }

  return {
    campusId,
    countryCode: MARKETPLACE_DEFAULT_COUNTRY,
  };
}
