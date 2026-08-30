import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
  TextInput,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  muteDmThread,
  muteGroupChat,
  searchMessages,
  searchUsers,
} from '../../services/api';
import {
  Button,
  EmptyState,
  ErrorState,
  InlineErrorBanner,
  LoadingState,
} from '../../components/ui';
import { CHAT_LIST_WINDOWING } from '../../components/chat/chatListWindowing';
import { ResolvedAvatar } from '../../components/ResolvedAvatar';
import NewDirectMessageModal from '../../components/NewDirectMessageModal';
import { useGroupHandlers } from '../../hooks/useGroupHandlers';
import { useToastStore } from '../../stores/toastStore';
import { confirmSheet } from '../../stores/confirmStore';
import { featureAccents } from '@lantern/shared/design';
import type { ChatStackParamList } from '../../navigation/types';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useChrome } from '../../components/layout/ChromeContext';
import { useTheme } from '../../theme';
import { useLowDataMode } from '../../hooks/useLowDataMode';

type Props = NativeStackScreenProps<ChatStackParamList, 'GroupsList'>;

/** Device-local pins (no backend field exists for chat pinning yet). */
const PINNED_CHATS_KEY = 'lantern_pinned_chats';

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
  | { kind: 'group'; group: Group; nestingLevel: number; hasChildren: boolean }
  | {
      kind: 'user';
      userId: string;
      name: string;
      username?: string;
      avatarUrl?: string | null;
    }
  | {
      kind: 'msghit';
      id: string;
      chatType: 'group' | 'dm';
      chatId: string;
      chatName: string;
      avatarUrl?: string | null;
      text: string;
      otherUserId?: string | null;
    };

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
  onLongPress,
  selected = false,
  pinned = false,
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
  onLongPress?: () => void;
  selected?: boolean;
  pinned?: boolean;
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
      // No row divider: avatars + generous row padding already separate chats,
      // and the hairline made a dense list look like a table (founder call).
      className={`flex-row items-center pr-4 py-3.5${
        selected ? ' bg-lantern-primary-background' : ''
      }`}
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
        onLongPress={onLongPress}
        accessibilityState={{ selected }}
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
        {selected ? (
          <View className="absolute -bottom-0.5 -right-0.5 h-[18px] w-[18px] rounded-full bg-lantern-primary border border-white items-center justify-center">
            <Ionicons name="checkmark" size={12} color="#ffffff" />
          </View>
        ) : null}
      </View>
      <View className="flex-1 min-w-0">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="text-base font-semibold text-lantern-text flex-1" numberOfLines={1}>
            {name}
          </Text>
          {pinned ? (
            <Ionicons name="pin" size={13} color={colors.textTertiary} />
          ) : null}
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
    <View className="flex-row items-center gap-3 px-4 py-3.5">
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
  const { onScroll: chromeOnScroll, setTopBarSuppressed } = useChrome();
  const { colors } = useTheme();
  const { lowDataMode } = useLowDataMode();
  const user = useAuthStore(s => s.user);
  const { groups, dmThreads, isLoading, listError, fetchGroups, fetchDmThreads, getTopLevelGroups, fetchGroupMembers } = useGroupStore();
  const { handleSelectGroup, handleInitiateDm } = useGroupHandlers();
  const [refreshing, setRefreshing] = useState(false);
  const [dmModalOpen, setDmModalOpen] = useState(false);
  const [expandedParentGroups, setExpandedParentGroups] = useState<Record<string, boolean>>({});
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [chatQuery, setChatQuery] = useState('');
  /** Multi-select: keys are `g:<groupId>` / `d:<threadId>`. Long-press starts
      a selection, taps toggle more; the action bar lives while non-empty. */
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [pinnedKeys, setPinnedKeys] = useState<Set<string>>(new Set());
  const selectionActive = selectedKeys.size > 0;
  const [userResults, setUserResults] = useState<
    Array<{ id: string; name: string; username?: string; avatarUrl?: string | null }>
  >([]);
  const userSearchRef = useRef(0);
  const [messageResults, setMessageResults] = useState<
    Array<{
      id: string;
      chatType: 'group' | 'dm';
      chatId: string;
      chatName: string;
      chatAvatarUrl: string | null;
      otherUserId: string | null;
      text: string;
    }>
  >([]);
  const messageSearchRef = useRef(0);
  const [pendingInvites, setPendingInvites] = useState<PendingGroupInvite[]>([]);
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null);
  const [contactsLoading, setContactsLoading] = useState(false);

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
      // Pinned chats float above everything, then the usual recency order.
      const pinRank = (it: ListItem) =>
        (it.kind === 'dm' && pinnedKeys.has(`d:${it.thread.id}`)) ||
        (it.kind === 'group' && pinnedKeys.has(`g:${it.group.id}`))
          ? 0
          : 1;
      const pinDiff = pinRank(a) - pinRank(b);
      if (pinDiff !== 0) return pinDiff;
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

    // Archived chats stay reachable, as they are on web. Pinned to the TOP
    // of the list, right below the search bar.
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

    const rebuilt: ListItem[] = [];
    if (archivedItems.length > 0) {
      rebuilt.push({ kind: 'archivedHeader', count: archivedItems.length });
      if (archivedExpanded) rebuilt.push(...archivedItems);
    }
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

    // Universal search: chat-name matches, latest-message matches (only the
    // previews already on device — full history search needs a server
    // endpoint), and people to start a new message with. Archived chats match
    // even while the Archived row is collapsed.
    const q = chatQuery.trim().toLowerCase();
    if (q) {
      const pool = archivedExpanded ? rebuilt : [...rebuilt, ...archivedItems];
      const nameOf = (item: ListItem) =>
        item.kind === 'dm' ? item.name : item.kind === 'group' ? item.group.name : '';
      const previewOf = (item: ListItem) =>
        item.kind === 'dm'
          ? String(item.thread.lastMessage || '')
          : item.kind === 'group'
            ? String(item.group.lastMessage?.text || '')
            : '';
      const chatRows = pool.filter(
        (item) =>
          (item.kind === 'dm' || item.kind === 'group') &&
          nameOf(item).toLowerCase().includes(q)
      );
      const messageRows = pool.filter(
        (item) =>
          (item.kind === 'dm' || item.kind === 'group') &&
          !nameOf(item).toLowerCase().includes(q) &&
          previewOf(item).toLowerCase().includes(q)
      );
      const out: ListItem[] = [];
      if (chatRows.length > 0) {
        out.push({ kind: 'section', title: 'Chats' }, ...chatRows);
      }
      if (messageResults.length > 0) {
        out.push(
          { kind: 'section', title: 'Messages' },
          ...messageResults.map(
            (r): ListItem => ({
              kind: 'msghit',
              id: r.id,
              chatType: r.chatType,
              chatId: r.chatId,
              chatName: r.chatName,
              avatarUrl: r.chatAvatarUrl,
              text: r.text,
              otherUserId: r.otherUserId,
            })
          )
        );
      } else if (messageRows.length > 0) {
        out.push({ kind: 'section', title: 'Messages' }, ...messageRows);
      }
      if (userResults.length > 0) {
        out.push(
          { kind: 'section', title: 'People' },
          ...userResults.map(
            (u): ListItem => ({
              kind: 'user',
              userId: u.id,
              name: u.name,
              username: u.username,
              avatarUrl: u.avatarUrl,
            })
          )
        );
      }
      return out;
    }
    return rebuilt;
  }, [
    dmThreads,
    groups,
    getTopLevelGroups,
    subGroupsMap,
    expandedParentGroups,
    archivedExpanded,
    chatQuery,
    pinnedKeys,
    userResults,
    messageResults,
    pendingInvites,
    user?.id,
  ]);

  // Hydrate device-local pins per account.
  useEffect(() => {
    if (!user?.id) {
      setPinnedKeys(new Set());
      return;
    }
    let cancelled = false;
    void AsyncStorage.getItem(`${PINNED_CHATS_KEY}:${user.id}`).then((raw) => {
      if (cancelled || !raw) return;
      try {
        setPinnedKeys(new Set(JSON.parse(raw) as string[]));
      } catch {
        /* corrupt pin cache: start clean */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // People results for the universal search bar (same endpoint the New DM
  // modal uses; leading @ prefers username matches).
  useEffect(() => {
    const q = chatQuery.trim();
    if (q.length < 2) {
      setUserResults([]);
      return;
    }
    const requestId = ++userSearchRef.current;
    const timer = setTimeout(() => {
      void searchUsers(q, 10)
        .then((rows) => {
          if (requestId !== userSearchRef.current) return;
          setUserResults(
            (rows || [])
              .filter((u: { id: string }) => u.id !== user?.id)
              .map((u: { id: string; name?: string; username?: string; avatarUrl?: string | null }) => ({
                id: u.id,
                name: u.name || u.username || 'User',
                username: u.username,
                avatarUrl: u.avatarUrl,
              }))
          );
        })
        .catch(() => {
          if (requestId === userSearchRef.current) setUserResults([]);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [chatQuery, user?.id]);

  // Full-history message search via the server. Older deployments without the
  // endpoint just fail quietly and the latest-message fallback below carries on.
  useEffect(() => {
    const q = chatQuery.trim();
    if (q.length < 2) {
      setMessageResults([]);
      return;
    }
    const requestId = ++messageSearchRef.current;
    const timer = setTimeout(() => {
      void searchMessages(q, 15)
        .then((data) => {
          if (requestId !== messageSearchRef.current) return;
          setMessageResults(data?.results || []);
        })
        .catch(() => {
          if (requestId === messageSearchRef.current) setMessageResults([]);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [chatQuery]);

  const persistPinned = (next: Set<string>) => {
    setPinnedKeys(next);
    if (user?.id) {
      void AsyncStorage.setItem(`${PINNED_CHATS_KEY}:${user.id}`, JSON.stringify([...next]));
    }
  };

  const chatKeyFor = (item: ListItem): string | null =>
    item.kind === 'dm' ? `d:${item.thread.id}` : item.kind === 'group' ? `g:${item.group.id}` : null;

  const toggleSelect = (item: ListItem) => {
    const key = chatKeyFor(item);
    if (!key) return;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const clearSelection = () => setSelectedKeys(new Set());

  // Hardware back leaves selection mode instead of exiting the screen.
  useEffect(() => {
    if (!selectionActive) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      clearSelection();
      return true;
    });
    return () => sub.remove();
  }, [selectionActive]);

  // The top icon row yields its space to the action bar while selecting, and
  // comes back the moment the selection empties. Leaving the screen clears
  // the selection so other tabs never inherit a hidden top bar.
  useEffect(() => {
    setTopBarSuppressed(selectionActive);
    return () => setTopBarSuppressed(false);
  }, [selectionActive, setTopBarSuppressed]);

  useEffect(() => {
    const sub = navigation.addListener('blur', () => setSelectedKeys(new Set()));
    return sub;
  }, [navigation]);

  const selectedAllPinned =
    selectionActive && [...selectedKeys].every((k) => pinnedKeys.has(k));
  const selectedAllArchived =
    selectionActive &&
    [...selectedKeys].every((k) => {
      const id = k.slice(2);
      return k.startsWith('g:')
        ? !!groups.find((g) => g.id === id)?.isArchived
        : !!dmThreads.find((t) => t.id === id)?.isArchived;
    });

  const handlePinSelected = () => {
    const next = new Set(pinnedKeys);
    if (selectedAllPinned) selectedKeys.forEach((k) => next.delete(k));
    else selectedKeys.forEach((k) => next.add(k));
    persistPinned(next);
    useToastStore
      .getState()
      .showToast(
        selectedAllPinned
          ? `Unpinned ${selectedKeys.size} chat${selectedKeys.size === 1 ? '' : 's'}`
          : `Pinned ${selectedKeys.size} chat${selectedKeys.size === 1 ? '' : 's'}`,
        'success'
      );
    clearSelection();
  };

  const handleMuteSelected = async () => {
    const targets = [...selectedKeys];
    clearSelection();
    const results = await Promise.allSettled(
      targets.map((k) =>
        k.startsWith('d:') ? muteDmThread(k.slice(2), '8h') : muteGroupChat(k.slice(2), '8h')
      )
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - ok;
    useToastStore
      .getState()
      .showToast(
        failed > 0
          ? `Muted ${ok} of ${results.length} chats for 8h`
          : `Muted ${ok} chat${ok === 1 ? '' : 's'} for 8h`,
        failed > 0 ? 'error' : 'success'
      );
  };

  const handleArchiveSelected = async () => {
    const uid = user?.id;
    if (!uid) return;
    const targets = [...selectedKeys];
    const unarchiving = selectedAllArchived;
    clearSelection();
    const store = useGroupStore.getState();
    const results = await Promise.allSettled(
      targets.map((k) => {
        const id = k.slice(2);
        if (k.startsWith('d:')) {
          return unarchiving ? store.unarchiveDmThread(id, uid) : store.archiveDmThread(id, uid);
        }
        // archiveGroup TOGGLES; only touch groups on the wrong side.
        const g = groups.find((gr) => gr.id === id);
        if (!g || !!g.isArchived === !unarchiving) return Promise.resolve();
        return store.archiveGroup(id);
      })
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    useToastStore
      .getState()
      .showToast(
        `${unarchiving ? 'Unarchived' : 'Archived'} ${targets.length - failed} chat${
          targets.length - failed === 1 ? '' : 's'
        }${failed ? ` · ${failed} failed` : ''}`,
        failed ? 'error' : 'success'
      );
  };

  const handleDeleteSelected = async () => {
    const uid = user?.id;
    if (!uid) return;
    const dmIds: string[] = [];
    const ownedGroupIds: string[] = [];
    const memberGroupIds: string[] = [];
    selectedKeys.forEach((k) => {
      const id = k.slice(2);
      if (k.startsWith('d:')) {
        dmIds.push(id);
        return;
      }
      const g = groups.find((gr) => gr.id === id);
      if (g?.adminIds?.includes(uid)) ownedGroupIds.push(id);
      else memberGroupIds.push(id);
    });
    const total = dmIds.length + ownedGroupIds.length + memberGroupIds.length;
    const ok = await confirmSheet({
      title: `Delete ${total} chat${total === 1 ? '' : 's'}?`,
      message:
        'Direct chats are deleted for you. Groups you admin are deleted for everyone; other groups you leave.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    clearSelection();
    const store = useGroupStore.getState();
    const results = await Promise.allSettled([
      ...dmIds.map((id) => store.deleteDmThread(id, uid)),
      ...ownedGroupIds.map((id) => store.deleteGroup(id)),
      ...memberGroupIds.map((id) => store.leaveGroup(id, uid)),
    ]);
    const failed = results.filter((r) => r.status === 'rejected').length;
    useToastStore
      .getState()
      .showToast(
        failed
          ? `Deleted ${total - failed} of ${total} chats`
          : `Deleted ${total} chat${total === 1 ? '' : 's'}`,
        failed ? 'error' : 'success'
      );
  };

  // Count what the list actually renders: top-level, non-archived groups (not the
  // raw `groups` array, which also holds archived groups and nested sub-groups)
  // plus the open direct-message threads.

  // Contacts are derived from group members, but the groups list response does
  // not include them — they only arrive when a group chat is opened. Without
  // this, "New Message" claims you have no contacts until you visit a group.
  // Hydrate every non-archived group up front (not just the first ten, and not
  // stopping at the first contact) and expose a loading flag so the modal shows
  // a spinner instead of a false "no contacts" empty state while members arrive.
  useEffect(() => {
    if (!dmModalOpen) {
      setContactsLoading(false);
      return;
    }
    const needsMembers = groups.filter((g) => !g.isArchived && !g.members?.length);
    if (needsMembers.length === 0) {
      setContactsLoading(false);
      return;
    }
    let cancelled = false;
    setContactsLoading(true);
    void (async () => {
      try {
        for (const group of needsMembers) {
          if (cancelled) return;
          try {
            await fetchGroupMembers(group.id);
          } catch {
            // A group that fails to hydrate simply contributes no contacts.
          }
        }
      } finally {
        if (!cancelled) setContactsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Snapshot the groups list on open; re-running as each roster lands would
    // restart the loop and double-fetch. New groups mid-session are rare here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dmModalOpen, fetchGroupMembers]);

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
    if (
      item.kind === 'section' ||
      item.kind === 'archivedHeader' ||
      item.kind === 'invite' ||
      // People and message-hit rows navigate inline, never through here.
      item.kind === 'user' ||
      item.kind === 'msghit'
    )
      return;
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
      {/* No title row: the bottom tab already names this screen. A live
          search bar replaces it, with new-DM alongside; creating a group
          moved to the floating button bottom-right. While chats are selected
          the row becomes a contextual action bar: count on the left,
          pin / mute / archive / delete on the right; it disappears when the
          selection empties. */}
      {selectionActive ? (
        <View className="flex-row items-center px-2 pt-2 pb-3">
          <Pressable
            onPress={clearSelection}
            className="h-11 w-11 items-center justify-center"
            accessibilityRole="button"
            accessibilityLabel="Cancel selection"
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
          <Text
            className="text-lg font-bold text-lantern-text"
            accessibilityLiveRegion="polite"
            accessibilityLabel={`${selectedKeys.size} selected`}
          >
            {selectedKeys.size}
          </Text>
          <View className="flex-1" />
          {/* Generous gaps so neighbouring actions cannot be fat-fingered. */}
          <View className="flex-row items-center gap-3 pr-1">
          <Pressable
            onPress={handlePinSelected}
            className="h-11 w-11 items-center justify-center"
            accessibilityRole="button"
            accessibilityLabel={selectedAllPinned ? 'Unpin selected' : 'Pin selected'}
          >
            <Ionicons
              name={selectedAllPinned ? 'pin' : 'pin-outline'}
              size={22}
              color={colors.text}
            />
          </Pressable>
          <Pressable
            onPress={() => void handleMuteSelected()}
            className="h-11 w-11 items-center justify-center"
            accessibilityRole="button"
            accessibilityLabel="Mute selected for 8 hours"
          >
            <Ionicons name="volume-mute-outline" size={22} color={colors.text} />
          </Pressable>
          <Pressable
            onPress={() => void handleArchiveSelected()}
            className="h-11 w-11 items-center justify-center"
            accessibilityRole="button"
            accessibilityLabel={selectedAllArchived ? 'Unarchive selected' : 'Archive selected'}
          >
            <Ionicons
              name={selectedAllArchived ? 'archive' : 'archive-outline'}
              size={22}
              color={colors.text}
            />
          </Pressable>
          <Pressable
            onPress={() => void handleDeleteSelected()}
            className="h-11 w-11 items-center justify-center"
            accessibilityRole="button"
            accessibilityLabel="Delete selected"
          >
            <Ionicons name="trash-outline" size={22} color={colors.error} />
          </Pressable>
          </View>
        </View>
      ) : (
      <View className="flex-row items-center gap-2 px-4 pt-2 pb-3">
        <View className="flex-1 flex-row items-center gap-2 px-3 rounded-xl border border-lantern-border bg-lantern-surface min-h-[44px]">
          <Ionicons name="search" size={16} color={colors.inputPlaceholder} />
          <TextInput
            value={chatQuery}
            onChangeText={setChatQuery}
            placeholder="Search chats…"
            placeholderTextColor={colors.inputPlaceholder}
            autoCorrect={false}
            returnKeyType="search"
            className="flex-1 text-sm text-lantern-text py-1"
            accessibilityLabel="Search chats"
          />
          {chatQuery ? (
            <Pressable
              onPress={() => setChatQuery('')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => setDmModalOpen(true)}
          className="h-11 w-11 items-center justify-center rounded-xl border border-lantern-border bg-lantern-surface"
          accessibilityRole="button"
          accessibilityLabel="New direct message"
        >
          <Ionicons name="chatbubble-outline" size={18} color="#6366f1" />
        </Pressable>
      </View>
      )}

      {/* error + no data -> ErrorState; error + stale data -> banner over the
          list; no error + no data -> EmptyState. See components/ui/AsyncStates. */}
      {isLoading && listItems.length === 0 ? (
        <LoadingState label="Loading your chats" />
      ) : listError && listItems.length === 0 ? (
        <ErrorState message={listError} onRetry={() => void loadChats()} />
      ) : (
        <FlatList
          data={listItems}
          extraData={{ selectedKeys, pinnedKeys, selectionActive }}
          {...CHAT_LIST_WINDOWING}
        onScroll={chromeOnScroll}
        scrollEventThrottle={16}
          keyExtractor={item =>
            item.kind === 'section'
              ? `section-${item.title}`
              : item.kind === 'archivedHeader'
                ? 'section-archived'
                : item.kind === 'invite'
                  ? `invite-${item.invite.groupId}`
                  : item.kind === 'dm'
                    ? `dm-${item.thread.id}`
                    : item.kind === 'user'
                      ? `user-${item.userId}`
                      : item.kind === 'msghit'
                        ? `msghit-${item.id}`
                      : `group-${item.group.id}-L${item.nestingLevel}`
          }
          contentContainerStyle={{ paddingBottom: tabBarClearance }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />
          }
          ListHeaderComponent={
            listError ? (
              <InlineErrorBanner
                title="Couldn't refresh your chats"
                detail="Showing your latest saved conversations."
                onRetry={() => void loadChats()}
              />
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="people"
              title="No conversations yet"
              description="Join or create a group to start collaborating."
              action={
                <Button onPress={() => navigation.navigate('CreateGroup')}>Create Group</Button>
              }
            />
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
            if (item.kind === 'msghit') {
              return (
                <Pressable
                  onPress={() => {
                    if (item.chatType === 'group') {
                      navigation.navigate('GroupChat', {
                        groupId: item.chatId,
                        groupName: item.chatName,
                      });
                    } else if (item.otherUserId) {
                      handleInitiateDm(item.otherUserId, item.chatName, item.avatarUrl ?? undefined);
                    }
                  }}
                  className="flex-row items-center gap-3 px-4 py-3 border-b border-lantern-border active:bg-lantern-background-secondary"
                  accessibilityRole="button"
                  accessibilityLabel={`Open message in ${item.chatName}`}
                >
                  <ResolvedAvatar
                    name={item.chatName}
                    uri={resolveAvatarSrc(item.avatarUrl, lowDataMode)}
                    size={40}
                  />
                  <View className="flex-1 min-w-0">
                    <Text className="text-base font-semibold text-lantern-text" numberOfLines={1}>
                      {item.chatName}
                    </Text>
                    <Text className="text-xs text-lantern-text-secondary" numberOfLines={1}>
                      {item.text}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                </Pressable>
              );
            }
            if (item.kind === 'user') {
              return (
                <Pressable
                  onPress={() => handleInitiateDm(item.userId, item.name, item.avatarUrl ?? undefined)}
                  className="flex-row items-center gap-3 px-4 py-3 border-b border-lantern-border active:bg-lantern-background-secondary"
                  accessibilityRole="button"
                  accessibilityLabel={`Message ${item.name}`}
                >
                  <ResolvedAvatar
                    name={item.name}
                    uri={resolveAvatarSrc(item.avatarUrl, lowDataMode)}
                    size={40}
                  />
                  <View className="flex-1 min-w-0">
                    <Text className="text-base font-semibold text-lantern-text" numberOfLines={1}>
                      {item.name}
                    </Text>
                    {item.username ? (
                      <Text className="text-xs text-lantern-text-secondary" numberOfLines={1}>
                        @{item.username}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="chatbubble-outline" size={18} color="#6366f1" />
                </Pressable>
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
                  selected={selectedKeys.has(`d:${item.thread.id}`)}
                  pinned={pinnedKeys.has(`d:${item.thread.id}`)}
                  onLongPress={() => toggleSelect(item)}
                  onPress={() => (selectionActive ? toggleSelect(item) : handlePress(item))}
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
                selected={selectedKeys.has(`g:${g.id}`)}
                pinned={pinnedKeys.has(`g:${g.id}`)}
                onLongPress={() => toggleSelect(item)}
                onPress={() => (selectionActive ? toggleSelect(item) : handlePress(item))}
              />
            );
          }}
        />
      )}

      <NewDirectMessageModal
        visible={dmModalOpen}
        onClose={() => setDmModalOpen(false)}
        contacts={contacts}
        contactsLoading={contactsLoading}
        currentUserId={user?.id || ''}
        lowDataMode={lowDataMode}
        onStartChat={(userId, userName, userAvatarUrl) => {
          setDmModalOpen(false);
          handleInitiateDm(userId, userName, userAvatarUrl);
        }}
      />
      {/* Create group, moved from the old header row. Sits above the tab
          bar; the bar hides on scroll but the clearance offset keeps the
          button in a stable spot. */}
      <Pressable
        onPress={() => navigation.navigate('CreateGroup')}
        accessibilityRole="button"
        accessibilityLabel="Create group"
        className="absolute right-4 h-14 w-14 items-center justify-center rounded-full bg-lantern-primary"
        style={{
          bottom: tabBarClearance - 8,
          elevation: 8,
          shadowColor: '#0f172a',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.2,
          shadowRadius: 8,
        }}
      >
        <Ionicons name="add" size={28} color="#ffffff" />
      </Pressable>
    </SafeAreaView>
  );
}

export default GroupsScreen;
