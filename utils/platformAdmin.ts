import { resolvePlatformAdmin } from '@lantern/shared';

export { resolvePlatformAdmin };

type AuthUserLike = { app_metadata?: Record<string, unknown> } | null | undefined;

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
