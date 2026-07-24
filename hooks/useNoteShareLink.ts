import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { parseAppRoute } from '../utils/appRoutes';
import { navigateToPath } from '../utils/appNavigation';

export const NOTE_SHARE_STORAGE_KEY = 'pendingNoteShareToken';

/** Preserves a secure note-share link until the recipient signs in. */
export function useNoteShareLink(userId: string | undefined) {
  const location = useLocation();

  useEffect(() => {
    const parsed = parseAppRoute(location.pathname);
    const token = parsed.shareToken;

    if (!token) {
      if (userId) {
        const stored = localStorage.getItem(NOTE_SHARE_STORAGE_KEY);
        if (stored && !location.pathname.startsWith('/notes/share/')) {
          localStorage.removeItem(NOTE_SHARE_STORAGE_KEY);
          navigateToPath(`/notes/share/${encodeURIComponent(stored)}`, { replace: true });
        }
      }
      return;
    }

    if (!userId) {
      localStorage.setItem(NOTE_SHARE_STORAGE_KEY, token);
      const target = `/notes/share/${encodeURIComponent(token)}`;
      navigateToPath(`/login?next=${encodeURIComponent(target)}`, { replace: true });
    }
  }, [userId, location.pathname]);
}
