import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DMThread } from '@lantern/shared/types';
import { chatMessagePreview, resolveAvatarSrc } from '@lantern/shared/utils';
import { useAuthStore } from '../../stores';
import { useGroupStore, type Group } from '../../stores/groupStore';
import {
  acceptGroupInvite,
  declineGroupInvite,
  fetchPendingGroupInvites,
} from '../../services/api';
import { Button, ScreenHeader } from '../../components/ui';
import { CHAT_LIST_WINDOWING } from '../../components/chat/chatListWindowing';
import { ResolvedAvatar } from '../../components/ResolvedAvatar';
import NewDirectMessageModal from '../../components/NewDirectMessageModal';
import { useGroupHandlers } from '../../hooks/useGroupHandlers';
import { featureAccents } from '@lantern/shared/design';
import type { ChatStackParamList } from '../../navigation/types';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useTheme } from '../../theme';
import { useLowDataMode } from '../../hooks/useLowDataMode';

type Props = NativeStackScreenProps<ChatStackParamList, 'GroupsList'>;

interface PendingGroupInvite {
  groupId: string;
  groupName: string;
  avatarUrl?: string;
  invitedAt?: string;
}

type ListItem =
  | { kind: 'section'; title: string }
  | { kind: 'archivedHeader'; count: number }
  | { kind: 'invite'; invite: PendingGroupInvite }
  | {
      kind: 'dm';
      thread: DMThread;
      otherUserId: string;
      name: string;
      avatarUrl?: string | null;
    }
  | { kind: 'group'; group: Group; nestingLevel: number; hasChildren: boolean };

function formatRelativeTime(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function ChatRow({
  name,
  avatarUrl,
  preview,
  time,
  unread,
  isMessageRequest,
  isArchived,
  lowDataMode,
  nestingLevel = 0,
  hasChildren = false,
  isExpanded = false,
  onToggleExpand,
  onPress,
}: {
  name: string;
  avatarUrl?: string | null;
  preview?: string;
  time?: string;
  unread?: number;
  isMessageRequest?: boolean;
  isArchived?: boolean;
  lowDataMode?: boolean;
  nestingLevel?: number;
  hasChildren?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        paddingLeft: 16 + nestingLevel * 20,
        borderLeftWidth: nestingLevel > 0 ? 3 : 0,
        borderLeftColor: nestingLevel > 0 ? `${featureAccents.groups}55` : 'transparent',
        opacity: isArchived ? 0.6 : 1,
      }}
      className="flex-row items-center pr-4 py-3.5 border-b border-lantern-border"
    >
      {hasChildren ? (
        <Pressable onPress={onToggleExpand} hitSlop={8} className="mr-1 p-1">
          <Ionicons
            name={isExpanded ? 'chevron-down' : 'chevron-forward'}
            size={16}
            color={colors.textTertiary}
          />
        </Pressable>
      ) : nestingLevel > 0 ? (
        <View className="w-6 mr-1" />
      ) : null}
      <Pressable
        onPress={onPress}
        className="flex-1 flex-row items-center active:opacity-80"
      >
      <View className="relative mr-3">
        {/* Group avatars live in the private `group-avatars` bucket, profile
            avatars in `profile-avatars`; ResolvedAvatar re-signs both and falls
            back to initials when there is no uploaded image. */}
        <ResolvedAvatar name={name} uri={resolveAvatarSrc(avatarUrl, lowDataMode)} size={44} />
        {unread && unread > 0 ? (
          <View className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-lantern-error items-center justify-center">
            <Text className="text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</Text>
          </View>
        ) : null}
      </View>
      <View className="flex-1 min-w-0">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="text-base font-semibold text-lantern-text flex-1" numberOfLines={1}>
            {name}
          </Text>
          {isArchived ? (
            <Ionicons name="archive-outline" size={14} color={colors.textTertiary} />
          ) : null}
          {time ? <Text className="text-xs text-lantern-text-tertiary shrink-0">{time}</Text> : null}
        </View>
        {isMessageRequest ? (
          <Text className="text-xs text-amber-700 dark:text-amber-300 mt-0.5" numberOfLines={1}>
            Message request
          </Text>
        ) : null}
        {preview ? (
          <Text className="text-sm text-lantern-text-secondary mt-0.5" numberOfLines={1}>
            {preview}
          </Text>
        ) : null}
      </View>
      </Pressable>
    </View>
  );
}

/**
 * A group invite the user has not answered yet. Until this existed the only way
 * in was the push notification — if it was missed or dismissed, the invite was
 * unreachable even though the server still had it pending.
 */
function InviteRow({
  invite,
  busy,
  lowDataMode,
  onAccept,
  onDecline,
}: {
  invite: PendingGroupInvite;
  busy: boolean;
  lowDataMode?: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <View className="flex-row items-center gap-3 px-4 py-3.5 border-b border-lantern-border">
      <ResolvedAvatar
        name={invite.groupName}
        uri={resolveAvatarSrc(invite.avatarUrl, lowDataMode)}
        size={44}
      />
      <View className="flex-1 min-w-0">
        <Text className="text-base font-semibold text-lantern-text" numberOfLines={1}>
          {invite.groupName}
        </Text>
        <Text className="text-xs text-lantern-text-secondary mt-0.5" numberOfLines={1}>
          Invited you to join{invite.invitedAt ? ` · ${formatRelativeTime(invite.invitedAt)}` : ''}
        </Text>
      </View>
      <View className="flex-row items-center gap-2 shrink-0">
        <Pressable
          onPress={onDecline}
          disabled={busy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Decline invite to ${invite.groupName}`}
          accessibilityState={{ disabled: busy }}
          className="px-3 py-1.5 rounded-lg border border-lantern-border active:opacity-70"
          style={{ opacity: busy ? 0.5 : 1 }}
        >
          <Text className="text-xs font-semibold text-lantern-text-secondary">Decline</Text>
        </Pressable>
        <Pressable
          onPress={onAccept}
          disabled={busy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Accept invite to ${invite.groupName}`}
          accessibilityState={{ disabled: busy }}
          className="px-3 py-1.5 rounded-lg bg-lantern-primary active:opacity-70"
          style={{ opacity: busy ? 0.5 : 1 }}
        >
          <Text className="text-xs font-semibold text-white">Accept</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function GroupsScreen({ navigation }: Props) {
  const tabBarClearance = useTabBarClearance(16);
  const { colors } = useTheme();
  const { lowDataMode } = useLowDataMode();
  const user = useAuthStore(s => s.user);
  const { groups, dmThreads, isLoading, fetchGroups, fetchDmThreads, getTopLevelGroups, fetchGroupMembers } = useGroupStore();
  const { handleSelectGroup, handleInitiateDm } = useGroupHandlers();
  const [refreshing, setRefreshing] = useState(false);
  const [dmModalOpen, setDmModalOpen] = useState(false);
  const [expandedParentGroups, setExpandedParentGroups] = useState<Record<string, boolean>>({});
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<PendingGroupInvite[]>([]);
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null);

  const subGroupsMap = useMemo(() => {
    const map: Record<string, Group[]> = {};
    for (const g of groups) {
      if (g.parentId && !g.isArchived) {
        if (!map[g.parentId]) map[g.parentId] = [];
        map[g.parentId].push(g);
      }
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [groups]);

  const contacts = useMemo(
    () => {
      const map = new Map<string, { id: string; userId: string; name: string; avatarUrl?: string }>();
      for (const group of groups) {
        for (const member of group.members) {
          if (member.userId !== user?.id && !map.has(member.userId)) {
            map.set(member.userId, {
            id: member.id,
            userId: member.userId,
            name: member.name,
            avatarUrl: member.avatarUrl,
          });
        }
        }
      }
      return Array.from(map.values());
    },
    [groups, user?.id]
  );

  const loadInvites = useCallback(async () => {
    try {
      const invites = await fetchPendingGroupInvites();
      setPendingInvites(Array.isArray(invites) ? invites : []);
    } catch {
      // An invites fetch failure must not blank the chat list — leave whatever
      // is already on screen and try again on the next refresh.
    }
  }, []);

  const loadChats = useCallback(async () => {
    if (!user?.id) return;
    await Promise.all([fetchGroups(user.id), fetchDmThreads(user.id), loadInvites()]);
  }, [user?.id, fetchGroups, fetchDmThreads, loadInvites]);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  const listItems = useMemo((): ListItem[] => {
    const activeDms = dmThreads.filter((t) => !t.isArchived);
    const inboundRequests = activeDms.filter(
      (t) =>
        t.status === 'pending' &&
        typeof t.requestedBy === 'string' &&
        t.requestedBy !== user?.id,
    );
    const openDms = activeDms.filter(
      (t) =>
        !(
          t.status === 'pending' &&
          typeof t.requestedBy === 'string' &&
          t.requestedBy !== user?.id
        ),
    );

    const toDmItem = (thread: DMThread): ListItem => {
      const otherUserId = thread.participantIds.find((id) => id !== user?.id) || '';
      const other = otherUserId ? thread.participants[otherUserId] : undefined;
      const name = other?.name || 'Direct message';
      return { kind: 'dm', thread, otherUserId, name, avatarUrl: other?.avatarUrl };
    };

    const openItems: ListItem[] = openDms.map(toDmItem);

    const appendGroupEntries = (group: Group, level: number) => {
      const children = subGroupsMap[group.id] || [];
      openItems.push({
        kind: 'group',
        group,
        nestingLevel: level,
        hasChildren: children.length > 0,
      });
      if (children.length > 0 && expandedParentGroups[group.id]) {
        for (const child of children) {
          appendGroupEntries(child, level + 1);
        }
      }
    };

    for (const group of getTopLevelGroups()) {
      appendGroupEntries(group, 0);
    }

    openItems.sort((a, b) => {
      const timeA =
        a.kind === 'dm'
          ? a.thread.lastMessageTimestamp
          : a.kind === 'group'
            ? a.group.lastMessage?.createdAt || a.group.updatedAt
            : 0;
      const timeB =
        b.kind === 'dm'
          ? b.thread.lastMessageTimestamp
          : b.kind === 'group'
            ? b.group.lastMessage?.createdAt || b.group.updatedAt
            : 0;
      return new Date(timeB || 0).getTime() - new Date(timeA || 0).getTime();
    });

    const rebuilt: ListItem[] = [];
    // Invites sit above message requests: they are the more consequential ask,
    // and an unanswered one hides a whole group from the list.
    if (pendingInvites.length > 0) {
      rebuilt.push({
        kind: 'section',
        title: `Group invites (${pendingInvites.length})`,
      });
      rebuilt.push(...pendingInvites.map((invite): ListItem => ({ kind: 'invite', invite })));
    }
    if (inboundRequests.length > 0) {
      rebuilt.push({
        kind: 'section',
        title: `Message requests (${inboundRequests.length})`,
      });
      rebuilt.push(...inboundRequests.map(toDmItem));
    }
    rebuilt.push(...openItems);

    // Archived chats stay reachable, as they are on web. Without this the mobile
    // archive action is one-way: the row disappears and nothing can unarchive it.
    const archivedItems: ListItem[] = [
      ...groups
        .filter((g) => g.isArchived)
        .map((group): ListItem => ({
          kind: 'group',
          group,
          nestingLevel: 0,
          hasChildren: false,
        })),
      ...dmThreads.filter((t) => t.isArchived).map(toDmItem),
    ];
    if (archivedItems.length > 0) {
      rebuilt.push({ kind: 'archivedHeader', count: archivedItems.length });
      if (archivedExpanded) rebuilt.push(...archivedItems);
    }
    return rebuilt;
  }, [
    dmThreads,
    groups,
    getTopLevelGroups,
    subGroupsMap,
    expandedParentGroups,
    archivedExpanded,
    pendingInvites,
    user?.id,
  ]);

  // Contacts are derived from group members, but the groups list response does
  // not include them — they only arrive when a group chat is opened. Without
  // this, "New Message" claims you have no contacts until you visit a group.
  useEffect(() => {
    if (!dmModalOpen || contacts.length > 0) return;
    const needsMembers = groups.filter((g) => !g.isArchived && !g.members?.length).slice(0, 10);
    if (needsMembers.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const group of needsMembers) {
        if (cancelled) return;
        try {
          await fetchGroupMembers(group.id);
        } catch {
          // A group that fails to hydrate simply contributes no contacts.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dmModalOpen, contacts.length, groups, fetchGroupMembers]);

  const toggleGroupExpand = useCallback((groupId: string) => {
    setExpandedParentGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadChats();
    setRefreshing(false);
  };

  const handleAcceptInvite = useCallback(
    async (invite: PendingGroupInvite) => {
      if (inviteBusyId) return;
      setInviteBusyId(invite.groupId);
      try {
        await acceptGroupInvite(invite.groupId);
        setPendingInvites((prev) => prev.filter((i) => i.groupId !== invite.groupId));
        // Refetch before navigating — the group is not in the store yet, and
        // GroupChatScreen reads its name and roster from there.
        if (user?.id) await fetchGroups(user.id);
        navigation.navigate('GroupChat', {
          groupId: invite.groupId,
          groupName: invite.groupName,
        });
      } catch (error) {
        Alert.alert(
          'Could not accept invite',
          error instanceof Error ? error.message : 'Please try again.'
        );
      } finally {
        setInviteBusyId(null);
      }
    },
    [inviteBusyId, user?.id, fetchGroups, navigation]
  );

  const handleDeclineInvite = useCallback(
    async (invite: PendingGroupInvite) => {
      if (inviteBusyId) return;
      setInviteBusyId(invite.groupId);
      try {
        await declineGroupInvite(invite.groupId);
        setPendingInvites((prev) => prev.filter((i) => i.groupId !== invite.groupId));
      } catch (error) {
        Alert.alert(
          'Could not decline invite',
          error instanceof Error ? error.message : 'Please try again.'
        );
      } finally {
        setInviteBusyId(null);
      }
    },
    [inviteBusyId]
  );

  const handlePress = (item: ListItem) => {
    if (item.kind === 'section' || item.kind === 'archivedHeader' || item.kind === 'invite') return;
    if (item.kind === 'group') {
      handleSelectGroup(item.group);
      return;
    }
    if (item.otherUserId) {
      handleInitiateDm(item.otherUserId, item.name, item.avatarUrl);
    }
  };
    
    return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <ScreenHeader
        title="Chats"
        subtitle={`${groups.length} group${groups.length !== 1 ? 's' : ''}`}
        right={
          <View className="flex-row items-center gap-1">
            <Button variant="ghost" size="sm" onPress={() => setDmModalOpen(true)}>
              <Ionicons name="chatbubble-outline" size={18} color="#6366f1" />
            </Button>
            <Button size="sm" onPress={() => navigation.navigate('CreateGroup')}>
              +
            </Button>
                  </View>
        }
      />

      {isLoading && listItems.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#6366f1" />
            </View>
      ) : (
        <FlatList
          data={listItems}
          {...CHAT_LIST_WINDOWING}
          keyExtractor={item =>
            item.kind === 'section'
              ? `section-${item.title}`
              : item.kind === 'archivedHeader'
                ? 'section-archived'
                : item.kind === 'invite'
                  ? `invite-${item.invite.groupId}`
                  : item.kind === 'dm'
                    ? `dm-${item.thread.id}`
                    : `group-${item.group.id}-L${item.nestingLevel}`
          }
          contentContainerStyle={{ paddingBottom: tabBarClearance }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />
          }
          ListEmptyComponent={
            <View className="items-center py-16 px-6">
              <View className="w-16 h-16 rounded-2xl bg-lantern-primary-background dark:bg-lantern-primary-dark/40 items-center justify-center mb-4">
                <Ionicons name="people" size={32} color="#6366f1" />
              </View>
              <Text className="text-base font-semibold text-lantern-text mb-1">
                No conversations yet
              </Text>
              <Text className="text-sm text-lantern-text-secondary text-center mb-6">
                Join or create a group to start collaborating.
              </Text>
              <Button onPress={() => navigation.navigate('CreateGroup')}>Create Group</Button>
            </View>
          }
          renderItem={({ item }) => {
            if (item.kind === 'section') {
              return (
                <View className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-lantern-border">
                  <Text className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                    {item.title}
                  </Text>
                </View>
              );
            }
            if (item.kind === 'archivedHeader') {
              return (
                <Pressable
                  onPress={() => setArchivedExpanded((prev) => !prev)}
                  className="flex-row items-center gap-2 px-4 py-3 border-b border-lantern-border active:bg-lantern-background-secondary"
                  accessibilityRole="button"
                  accessibilityState={{ expanded: archivedExpanded }}
                  accessibilityLabel={`Archived chats, ${item.count}`}
                >
                  <Ionicons name="archive-outline" size={16} color={colors.textSecondary} />
                  <Text className="flex-1 text-xs font-semibold uppercase tracking-wider text-lantern-text-secondary">
                    Archived ({item.count})
                  </Text>
                  <Ionicons
                    name={archivedExpanded ? 'chevron-down' : 'chevron-forward'}
                    size={16}
                    color={colors.textTertiary}
                  />
                </Pressable>
              );
            }
            if (item.kind === 'invite') {
              return (
                <InviteRow
                  invite={item.invite}
                  busy={inviteBusyId === item.invite.groupId}
                  lowDataMode={lowDataMode}
                  onAccept={() => void handleAcceptInvite(item.invite)}
                  onDecline={() => void handleDeclineInvite(item.invite)}
                />
              );
            }
            if (item.kind === 'dm') {
              const isMessageRequest =
                item.thread.status === 'pending' &&
                typeof item.thread.requestedBy === 'string' &&
                item.thread.requestedBy !== user?.id;
              return (
                <ChatRow
                  name={item.name}
                  avatarUrl={item.avatarUrl}
                  preview={chatMessagePreview(item.thread.lastMessage, "")}
                  time={formatRelativeTime(
                    typeof item.thread.lastMessageTimestamp === 'string'
                      ? item.thread.lastMessageTimestamp
                      : item.thread.lastMessageTimestamp?.toString()
                  )}
                  unread={item.thread.unreadCount}
                  isMessageRequest={isMessageRequest}
                  isArchived={item.thread.isArchived}
                  lowDataMode={lowDataMode}
                  onPress={() => handlePress(item)}
                />
              );
            }
            const g = item.group;
            return (
              <ChatRow
                name={g.name}
                avatarUrl={g.avatarUrl}
                preview={chatMessagePreview(g.lastMessage?.text, "")}
                time={formatRelativeTime(g.lastMessage?.createdAt || g.updatedAt)}
                unread={g.unreadCount}
                isArchived={g.isArchived}
                lowDataMode={lowDataMode}
                nestingLevel={item.nestingLevel}
                hasChildren={item.hasChildren}
                isExpanded={!!expandedParentGroups[g.id]}
                onToggleExpand={() => toggleGroupExpand(g.id)}
                onPress={() => handlePress(item)}
              />
            );
          }}
        />
      )}

      <NewDirectMessageModal
        visible={dmModalOpen}
        onClose={() => setDmModalOpen(false)}
        contacts={contacts}
        currentUserId={user?.id || ''}
        onStartChat={(userId, userName, userAvatarUrl) => {
          setDmModalOpen(false);
          handleInitiateDm(userId, userName, userAvatarUrl);
        }}
      />
    </SafeAreaView>
  );
}

export default GroupsScreen;
