import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../services/supabase';
import { resolvePlatformAdmin } from '../utils/platformAdmin';

/** Keeps platform-admin flag in sync with JWT (not persisted in localStorage). */
export function usePlatformAdmin(): boolean {
  const currentUser = useAuthStore((s) => s.currentUser);
  const setCurrentUser = useAuthStore((s) => s.setCurrentUser);
  const [isAdmin, setIsAdmin] = useState(currentUser?.isAdmin === true);

  useEffect(() => {
    if (!currentUser) {
      setIsAdmin(false);
      return;
    }

    if (currentUser.isAdmin === true) {
      setIsAdmin(true);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data: refreshData } = await supabase.auth.refreshSession();
        const sessionUser = refreshData.session?.user;
        const { data: sessionData } = sessionUser
          ? { data: { session: refreshData.session } }
          : await supabase.auth.getSession();

        const resolved = resolvePlatformAdmin(
          sessionData.session?.user,
          currentUser.settings as Record<string, unknown> | undefined
        );

        if (cancelled) return;

        setIsAdmin(resolved);
        if (resolved && !currentUser.isAdmin) {
          setCurrentUser({ ...currentUser, isAdmin: true });
        }
      } catch {
        const fallback = resolvePlatformAdmin(undefined, currentUser.settings as Record<string, unknown>);
        if (!cancelled) setIsAdmin(fallback);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, currentUser?.isAdmin, currentUser, setCurrentUser]);

  return isAdmin;
}
