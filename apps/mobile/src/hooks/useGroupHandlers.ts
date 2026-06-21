/**
 * Mobile Group Handlers — navigation-based port of root useGroupHandlers
 */
import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { DMThread } from '@lantern/shared/types';
import { useAuthStore } from '../stores/authStore';
import { useGroupStore, type Group, type Message } from '../stores/groupStore';

function buildThreadId(userId: string, otherUserId: string): string {
  return [userId, otherUserId].sort().join('-');
}

export function useGroupHandlers() {
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const {
    groups,
    dmThreads,
    messages,
    userVotes,
    messagePagination,
    fetchMessages,
    loadMoreMessages,
    sendMessage,
    markGroupAsRead,
    fetchUserVotesForGroup,
    fetchGroupMembers,
    markDMAsRead,
    fetchDirectMessagesForThread,
    sendDirectMessageTo,
    fetchDmThreads,
    promoteGroupAdmin,
    demoteGroupAdmin,
    flagMessageAsSimilar,
    voteOnMessage,
    createGroup,
    deleteDmThread,
    archiveDmThread,
    unarchiveDmThread,
  } = useGroupStore();

  const handleSelectGroup = useCallback(async (group: Group) => {
    if (!user?.id) return;

    navigation.navigate('GroupChat', {
      groupId: group.id,
      groupName: group.name,
    });

    await Promise.all([
      fetchMessages(group.id, { page: 1, refresh: true }),
      fetchUserVotesForGroup(group.id, user.id),
      fetchGroupMembers(group.id),
      markGroupAsRead(group.id, user.id),
    ]);
  }, [user?.id, navigation, fetchMessages, fetchUserVotesForGroup, fetchGroupMembers, markGroupAsRead]);

  const handleInitiateDm = useCallback(async (otherUserId: string, otherUserName: string) => {
    if (!user?.id || otherUserId === user.id) return;

    const threadId = buildThreadId(user.id, otherUserId);
    let thread = dmThreads.find(t => t.id === threadId);

    if (!thread) {
      const newThread: DMThread = {
        id: threadId,
        participantIds: [user.id, otherUserId].sort() as [string, string],
        participants: {
          [user.id]: { name: user.user_metadata?.full_name || user.email || 'You' },
          [otherUserId]: { name: otherUserName },
        },
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
  }, [user, dmThreads, navigation, fetchDirectMessagesForThread, markDMAsRead]);

  const onSendMessage = useCallback(async (groupId: string, text: string) => {
    if (!user?.id) return;
    await sendMessage(
      groupId,
      text,
      user.id,
      user.user_metadata?.full_name || user.email || 'User'
    );
  }, [user, sendMessage]);

  const handleSendDm = useCallback(async (threadId: string, recipientId: string, text: string) => {
    if (!user?.id) return;
    await sendDirectMessageTo(user.id, recipientId, text, threadId);
    await fetchDmThreads(user.id);
  }, [user, sendDirectMessageTo, fetchDmThreads]);

  const onVoteQuestion = useCallback(async (groupId: string, messageId: string, voteType: 'up' | 'down') => {
    if (!user?.id) return;
    await voteOnMessage(groupId, messageId, user.id, voteType);
  }, [user?.id, voteOnMessage]);

  const onFlagAsSimilar = useCallback(async (messageId: string, groupId: string) => {
    if (!user?.id) return;
    await flagMessageAsSimilar(messageId, groupId, user.id);
  }, [user?.id, flagMessageAsSimilar]);

  const handleLoadMoreMessages = useCallback(async (groupId: string) => {
    const pagination = messagePagination[groupId];
    if (!pagination?.hasMore) return 0;
    return loadMoreMessages(groupId);
  }, [messagePagination, loadMoreMessages]);

  const handlePromoteToAdmin = useCallback(async (groupId: string, memberUserId: string) => {
    await promoteGroupAdmin(groupId, memberUserId);
  }, [promoteGroupAdmin]);

  const handleDemoteAdmin = useCallback(async (groupId: string, memberUserId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (group?.adminIds && group.adminIds.length <= 1 && group.adminIds.includes(memberUserId)) {
      Alert.alert('Cannot demote', 'Cannot demote the only admin of the group.');
      return;
    }
    await demoteGroupAdmin(groupId, memberUserId);
  }, [groups, demoteGroupAdmin]);

  const handleCreateSubGroup = useCallback(async (
    name: string,
    description: string,
    parentId: string,
    ownerName?: string
  ) => {
    if (!user?.id) return null;

    const created = await createGroup({
      name,
      description,
      ownerId: user.id,
      ownerName: ownerName || user.user_metadata?.full_name || user.email || 'User',
      parentId,
    });

    navigation.navigate('GroupChat', {
      groupId: created.id,
      groupName: created.name,
    });

    return created;
  }, [user, createGroup, navigation]);

  const handleDeleteDmThread = useCallback(async (threadId: string) => {
    if (!user?.id) return;
    await deleteDmThread(threadId, user.id);
  }, [user?.id, deleteDmThread]);

  const handleArchiveDmThread = useCallback(async (threadId: string) => {
    if (!user?.id) return;
    await archiveDmThread(threadId, user.id);
  }, [user?.id, archiveDmThread]);

  const handleUnarchiveDmThread = useCallback(async (threadId: string) => {
    if (!user?.id) return;
    await unarchiveDmThread(threadId, user.id);
  }, [user?.id, unarchiveDmThread]);

  const findDuplicateQuestion = useCallback((groupId: string, stem: string): Message | undefined => {
    const groupMessages = messages;
    const trimmedStem = stem.trim().toLowerCase();
    return groupMessages.find(
      m => m.type === 'question' && (m.questionStem || m.text)?.trim().toLowerCase() === trimmedStem
    );
  }, [messages]);

  return {
    handleSelectGroup,
    handleInitiateDm,
    onSendMessage,
    handleSendDm,
    onVoteQuestion,
    onFlagAsSimilar,
    handleLoadMoreMessages,
    handlePromoteToAdmin,
    handleDemoteAdmin,
    handleCreateSubGroup,
    handleDeleteDmThread,
    handleArchiveDmThread,
    handleUnarchiveDmThread,
    findDuplicateQuestion,
    userVotes,
  };
}
