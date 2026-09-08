/**
 * Mobile Group Handlers — navigation-based port of root useGroupHandlers
 */
import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { DMThread } from '@lantern/shared/types';
import { profileDisplayName } from './profileIdentity';
import { useAuthStore } from '../stores/authStore';
import { useGroupStore, type Group } from '../stores/groupStore';

function buildThreadId(userId: string, otherUserId: string): string {
  return [userId, otherUserId].sort().join('-');
}

export function useGroupHandlers() {
  const navigation = useNavigation<any>();
  const { user, profileName } = useAuthStore();
  // Per-value selectors: the whole-store destructure re-ran GroupsScreen on any
  // store mutation, including chat traffic in a group that is not even open.
  const dmThreads = useGroupStore(s => s.dmThreads);
  const userVotes = useGroupStore(s => s.userVotes);
  const fetchUserVotesForGroup = useGroupStore(s => s.fetchUserVotesForGroup);
  const fetchGroupMembers = useGroupStore(s => s.fetchGroupMembers);
  const markDMAsRead = useGroupStore(s => s.markDMAsRead);
  const fetchDirectMessagesForThread = useGroupStore(s => s.fetchDirectMessagesForThread);

  const handleSelectGroup = useCallback(async (group: Group) => {
    if (!user?.id) return;

    // GroupChatScreen owns message fetch via selectGroup + fetchMessages.
    // Prefetch members/votes/read only — avoids racing a second messages request.
    navigation.navigate('GroupChat', {
      groupId: group.id,
      groupName: group.name,
    });

    // Mark-as-read (and unread scroll anchor) is owned by GroupChatScreen.loadChat
    // so we don't race two mark calls and lose the prior last_read_at marker.
    await Promise.all([
      fetchUserVotesForGroup(group.id, user.id),
      fetchGroupMembers(group.id),
    ]);
  }, [user?.id, navigation, fetchUserVotesForGroup, fetchGroupMembers]);

  const handleInitiateDm = useCallback(async (
    otherUserId: string,
    otherUserName: string,
    otherUserAvatarUrl?: string | null,
  ) => {
    if (!user?.id || otherUserId === user.id) return;

    const threadId = buildThreadId(user.id, otherUserId);
    let thread = dmThreads.find(t => t.id === threadId);

    if (!thread) {
      const newThread: DMThread = {
        id: threadId,
        participantIds: [user.id, otherUserId].sort() as [string, string],
        participants: {
          [user.id]: {
            // Never the address, nor the local part it collapses to: resolved
            // through the same pure planner every mobile surface uses. A
            // nameless account resolves to '' and the neutral self-label 'You'
            // stands in — never "nimaj22".
            name:
              profileDisplayName({
                profileName,
                metadataName:
                  (typeof user.user_metadata?.name === 'string' && user.user_metadata.name) ||
                  (typeof user.user_metadata?.full_name === 'string' &&
                    user.user_metadata.full_name) ||
                  null,
                email: user.email ?? null,
              }) || 'You',
          },
          // Carry the avatar from the contact row — a client-pending thread has
          // no server row to hydrate it from, so without this the peer shows
          // initials until the thread is persisted and refetched.
          [otherUserId]: { name: otherUserName, avatarUrl: otherUserAvatarUrl || undefined },
        },
        clientPending: true,
      };
      useGroupStore.setState(state => ({
        dmThreads: [...state.dmThreads, newThread],
      }));
      thread = newThread;
    }

    navigation.navigate('DirectMessage', {
      recipientId: otherUserId,
      recipientName: otherUserName,
      threadId: thread.id,
    });

    await Promise.all([
      fetchDirectMessagesForThread(user.id, otherUserId, thread.id),
      markDMAsRead(thread.id, user.id),
    ]);
  }, [user, profileName, dmThreads, navigation, fetchDirectMessagesForThread, markDMAsRead]);

  return {
    handleSelectGroup,
    handleInitiateDm,
    userVotes,
  };
}
