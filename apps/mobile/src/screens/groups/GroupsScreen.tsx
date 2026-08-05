import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { Button, ScreenHeader } from '../../components/ui';
import { ResolvedAvatar } from '../../components/ResolvedAvatar';
import NewDirectMessageModal from '../../components/NewDirectMessageModal';
import { useGroupHandlers } from '../../hooks/useGroupHandlers';
import { featureAccents } from '@lantern/shared/design';
import type { ChatStackParamList } from '../../navigation/types';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useTheme } from '../../theme';

type Props = NativeStackScreenProps<ChatStackParamList, 'GroupsList'>;

type ListItem =
  | { kind: 'section'; title: string }
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
        <ResolvedAvatar name={name} uri={resolveAvatarSrc(avatarUrl)} size={44} />
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

export function GroupsScreen({ navigation }: Props) {
  const tabBarClearance = useTabBarClearance(16);
  const user = useAuthStore(s => s.user);
  const { groups, dmThreads, isLoading, fetchGroups, fetchDmThreads, getTopLevelGroups } = useGroupStore();
  const { handleSelectGroup, handleInitiateDm } = useGroupHandlers();
  const [refreshing, setRefreshing] = useState(false);
  const [dmModalOpen, setDmModalOpen] = useState(false);
  const [expandedParentGroups, setExpandedParentGroups] = useState<Record<string, boolean>>({});

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

  const loadChats = useCallback(async () => {
    if (!user?.id) return;
    await Promise.all([fetchGroups(user.id), fetchDmThreads(user.id)]);
  }, [user?.id, fetchGroups, fetchDmThreads]);

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
    if (inboundRequests.length > 0) {
      rebuilt.push({
        kind: 'section',
        title: `Message requests (${inboundRequests.length})`,
      });
      rebuilt.push(...inboundRequests.map(toDmItem));
    }
    rebuilt.push(...openItems);
    return rebuilt;
  }, [dmThreads, getTopLevelGroups, subGroupsMap, expandedParentGroups, user?.id]);

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

  const handlePress = (item: ListItem) => {
    if (item.kind === 'section') return;
    if (item.kind === 'group') {
      handleSelectGroup(item.group);
      return;
    }
    if (item.otherUserId) {
      handleInitiateDm(item.otherUserId, item.name);
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
          keyExtractor={item =>
            item.kind === 'section'
              ? `section-${item.title}`
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
        onStartChat={(userId, userName) => {
          setDmModalOpen(false);
          handleInitiateDm(userId, userName);
        }}
      />
    </SafeAreaView>
  );
}

export default GroupsScreen;
