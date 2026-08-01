type AuthUserLike = { app_metadata?: Record<string, unknown> } | null | undefined;

/** Canonical platform-admin check: JWT app_metadata only (never trust user-editable settings). */
export function resolvePlatformAdmin(authUser?: AuthUserLike, _settings?: unknown): boolean {
  return authUser?.app_metadata?.is_platform_admin === true;
}

export async function syncPlatformAdminFromSession(
  setCurrentUser: (user: import('../types').User | null) => void,
  currentUser: import('../types').User | null,
  supabase: { auth: { getSession: () => Promise<{ data: { session: { user?: AuthUserLike } | null } }> } }
): Promise<boolean> {
  if (!currentUser) return false;
  const { data } = await supabase.auth.getSession();
  const isAdmin = resolvePlatformAdmin(data.session?.user);
  if (isAdmin !== currentUser.isAdmin) {
    setCurrentUser({ ...currentUser, isAdmin });
  }
  return isAdmin;
}
