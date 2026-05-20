import { useEffect, useRef } from 'react';
import { joinGroupByInvite, fetchGroups } from '../services/supabase';
import { useGroupStore } from '../stores/groupStore';
import { useUIStore } from '../stores/uiStore';
import { AppMode } from '../types';

const INVITE_STORAGE_KEY = 'pendingInviteId';

/**
 * Hook that processes invite links (?inviteId=xxx) from the URL.
 * - If user is authenticated, joins the group immediately and navigates to chat.
 * - If user is not authenticated, stores the inviteId in localStorage for processing after login.
 */
export function useInviteLink(userId: string | undefined) {
  const processedRef = useRef(false);
  const setAppMode = useUIStore(s => s.setAppMode);
  const setGroups = useGroupStore(s => s.setGroups);
  const setSelectedChat = useUIStore(s => s.setSelectedChat);

  useEffect(() => {
    if (processedRef.current) return;

    // Check URL for inviteId param
    const params = new URLSearchParams(window.location.search);
    const inviteId = params.get('inviteId');

    if (inviteId) {
      // Clean the URL immediately (remove ?inviteId=xxx)
      const url = new URL(window.location.href);
      url.searchParams.delete('inviteId');
      window.history.replaceState({}, '', url.pathname);

      if (userId) {
        // User is logged in — process immediately
        processedRef.current = true;
        processInvite(inviteId);
      } else {
        // User is not logged in — store for later
        localStorage.setItem(INVITE_STORAGE_KEY, inviteId);
      }
      return;
    }

    // Check localStorage for a stored invite (user just logged in)
    if (userId) {
      const storedInviteId = localStorage.getItem(INVITE_STORAGE_KEY);
      if (storedInviteId) {
        localStorage.removeItem(INVITE_STORAGE_KEY);
        processedRef.current = true;
        processInvite(storedInviteId);
      }
    }
  }, [userId]);

  async function processInvite(inviteId: string) {
    try {
      const group = await joinGroupByInvite(inviteId);
      if (group && userId) {
        // Refresh groups list to include the newly joined group
        try {
          const updatedGroups = await fetchGroups(userId);
          if (updatedGroups) {
            setGroups(updatedGroups);
          }
        } catch (err) {
          console.error('Failed to refresh groups after joining:', err);
        }
        // Select the joined group and navigate to chat
        setSelectedChat({ ...group, chatType: 'group' as const, members: group.members || [], unreadCount: 0 });
        setAppMode(AppMode.CHAT);
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
