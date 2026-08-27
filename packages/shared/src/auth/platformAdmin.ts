type AuthUserLike = { app_metadata?: Record<string, unknown> } | null | undefined;

/**
 * Canonical platform-admin check: JWT `app_metadata` only.
 * Never trust user-editable settings or `user_metadata`.
 */
export function resolvePlatformAdmin(authUser?: AuthUserLike, _settings?: unknown): boolean {
  return authUser?.app_metadata?.is_platform_admin === true;
}
