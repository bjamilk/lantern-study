import type { CacheService } from '../services/cache';

/** Invalidate both authenticated and anonymous public listing cache keys. */
export async function invalidateListingCaches(
  cacheService: CacheService,
  listingId: string
): Promise<void> {
  await cacheService.delete(`marketplace:listing:${listingId}`);
  await cacheService.delete(`marketplace:listing:public:${listingId}`);
}
