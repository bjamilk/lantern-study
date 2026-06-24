import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { joinGroupByInvite, fetchGroups } from '../services/supabase';
import { useGroupStore } from '../stores/groupStore';
import { useUIStore } from '../stores/uiStore';
import { AppMode } from '../types';
import { parseAppRoute } from '../utils/appRoutes';
import { navigateToPath } from '../utils/appNavigation';

const INVITE_STORAGE_KEY = 'pendingInviteId';

/**
 * Processes invite links (`/invite/:id` or legacy `?inviteId=`).
 * - Authenticated users join immediately and land on group chat.
 * - Unauthenticated users store the invite for processing after login.
 */
export function useInviteLink(userId: string | undefined) {
  const processedRef = useRef(false);
  const setAppModeDirect = useUIStore((s) => s.setAppModeDirect);
  const setGroups = useGroupStore((s) => s.setGroups);
  const setSelectedChat = useUIStore((s) => s.setSelectedChat);
  const location = useLocation();

  useEffect(() => {
    if (processedRef.current) return;

    const parsed = parseAppRoute(location.pathname);
    const params = new URLSearchParams(location.search);
    const inviteId = parsed.inviteId || params.get('inviteId');

    if (inviteId) {
      if (parsed.inviteId) {
        navigateToPath('/', { replace: true });
      } else {
        const url = new URL(window.location.href);
        url.searchParams.delete('inviteId');
        window.history.replaceState({}, '', url.pathname + url.search);
      }

      if (userId) {
        processedRef.current = true;
        void processInvite(inviteId);
      } else {
        localStorage.setItem(INVITE_STORAGE_KEY, inviteId);
      }
      return;
    }

    if (userId) {
      const storedInviteId = localStorage.getItem(INVITE_STORAGE_KEY);
      if (storedInviteId) {
        localStorage.removeItem(INVITE_STORAGE_KEY);
        processedRef.current = true;
        void processInvite(storedInviteId);
      }
    }
  }, [userId, location.pathname, location.search]);

  async function processInvite(inviteId: string) {
    try {
      const group = await joinGroupByInvite(inviteId);
      if (group && userId) {
        try {
          const updatedGroups = await fetchGroups(userId);
          if (updatedGroups) {
            setGroups(updatedGroups);
          }
        } catch (err) {
          console.error('Failed to refresh groups after joining:', err);
        }
        setSelectedChat({
          ...group,
          chatType: 'group' as const,
          members: group.members || [],
          unreadCount: 0,
        });
        navigateToPath(`/chat/group/${encodeURIComponent(group.id)}`, { replace: true });
        setAppModeDirect(AppMode.CHAT);
        alert(`You've joined "${group.name}"!`);
      }
    } catch (error: any) {
      console.error('Failed to join group via invite link:', error);
      if (error.message?.includes('Invalid or expired')) {
        alert('This invite link is invalid or expired.');
      } else if (error.message?.includes('archived')) {
        alert('This group has been archived and is no longer accepting new members.');
      } else {
        alert('Failed to join group. Please try again.');
      }
    }
  }
}
