/**
 * Central cache TTLs and key builders for hot read paths.
 */
export const CacheTTL = {
  unreadCounts: 45,
  sellerProfile: 300,
  marketplaceListings: 300,
  userGroups: 60,
  challengeList: 60,
} as const;

export function cacheKey(scope: string, ...parts: string[]): string {
  return [scope, ...parts.filter(Boolean)].join(':');
}

export const CacheKeys = {
  unreadGroups: (userId: string) => cacheKey('unread', 'groups', userId),
  unreadDm: (userId: string) => cacheKey('unread', 'dm', userId),
  /** Separate keys so owner-private metrics never leak via shared public cache. */
  sellerProfile: (userId: string, scope: 'public' | 'owner' = 'public') =>
    cacheKey('seller', 'profile', userId, scope),
  challengeList: (userId: string, status?: string) =>
    cacheKey('challenges', 'list', userId, status || 'all'),
} as const;
