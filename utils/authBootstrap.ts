/**
 * Pure helpers for cold-start auth restore decisions.
 * Kept free of browser APIs so unit tests can cover the guest/stale-session cases.
 */

export type AuthBootToken = { token: string; userId: string };

/** Restore a persisted profile only when it matches a live local access token. */
export function shouldRestorePersistedAuthUser(
  boot: AuthBootToken | null | undefined,
  persisted: { id?: unknown } | null | undefined,
): boolean {
  const persistedId = typeof persisted?.id === 'string' ? persisted.id : null;
  return Boolean(boot?.token && boot.userId && persistedId && persistedId === boot.userId);
}

/**
 * True when a stored access-token expiry is far enough in the future to fan out
 * authenticated API calls without waiting for refresh.
 */
export function isAccessTokenFreshEnough(
  expiresAtSeconds: number | null | undefined,
  nowSeconds = Date.now() / 1000,
  bufferSeconds = 60,
): boolean {
  if (typeof expiresAtSeconds !== 'number' || !Number.isFinite(expiresAtSeconds)) {
    return false;
  }
  return expiresAtSeconds - nowSeconds > bufferSeconds;
}
