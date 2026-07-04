import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { parseAppRoute } from '../utils/appRoutes';
import { navigateToPath } from '../utils/appNavigation';

export const INVITE_STORAGE_KEY = 'pendingInviteId';

/**
 * Processes invite links (`/invite/:id` or legacy `?inviteId=`).
 * Does not auto-join — navigates to invite preview or login with next=.
 */
export function useInviteLink(userId: string | undefined) {
  const location = useLocation();

  useEffect(() => {
    const parsed = parseAppRoute(location.pathname);
    const params = new URLSearchParams(location.search);
    const inviteId = parsed.inviteId || params.get('inviteId');

    // Legacy query param → canonical path
    if (!parsed.inviteId && params.get('inviteId')) {
      const id = params.get('inviteId')!;
      navigateToPath(`/invite/${encodeURIComponent(id)}`, { replace: true });
      return;
    }

    if (!inviteId) {
      // After login: if we stored an invite, send user to preview
      if (userId) {
        const stored = localStorage.getItem(INVITE_STORAGE_KEY);
        if (stored && !location.pathname.startsWith('/invite/')) {
          localStorage.removeItem(INVITE_STORAGE_KEY);
          navigateToPath(`/invite/${encodeURIComponent(stored)}`, { replace: true });
        }
      }
      return;
    }

    if (!userId) {
      localStorage.setItem(INVITE_STORAGE_KEY, inviteId);
      navigateToPath(`/login?next=${encodeURIComponent(`/invite/${inviteId}`)}`, { replace: true });
    }
    // Authenticated users stay on /invite/:id — App renders InviteJoinScreen
  }, [userId, location.pathname, location.search]);
}
