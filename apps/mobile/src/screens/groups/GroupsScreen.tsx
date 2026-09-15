/**
 * Chat tab root (ChatStack -> GroupsList): the chat inbox. One list of DMs,
 * group chats and their sub-groups, plus archived chats, pending group invites
 * and message requests, with a universal search bar (chat names, message
 * history, people) and multi-select actions (pin, mute, archive, leave).
 *
 * Exports: GroupsScreen (named and default).
 * Touches: groupStore (groups, DM threads, unread, archive/leave),
 * communityStore (to recognise lounges), authStore, toastStore, confirmStore;
 * services/api fetchPendingGroupInvites / accept / decline, searchUsers,
 * searchMessages, muteGroupChat, muteDmThread; AsyncStorage for device-local
 * pins; useNetworkStatus, useLowDataMode, ChromeContext, BackHandler.
 * Gotchas: community BOARD groups are filtered out of this list -- they belong
 * to the community page. Pins are device-local (no server field) and keyed by
 * user id. The reconnect auto-retry fires ONCE per reconnection, latched in a
 * ref: fetchGroups clears and re-sets listError, so an unlatched retry would
 * loop forever when Wi-Fi is up but Lantern is not (rule and test in
 * reconnectRetry.ts). Server-backed search halves swallow their own errors and
 * record that they failed, so "no results" is never claimed for a request that
 * did not happen; resolveListState keeps failure above empty and no-match.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
  TextInput,
  BackHandler,
} from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DMThread } from '@lantern/shared/types';
import { chatMessagePreview, resolveAvatarSrc } from '@lantern/shared/utils';
import { isHiddenFromChatInbox, resolveListState } from '@lantern/shared/network';
import { buildChatHome, chatMatchesInboxFilter, CHAT_HOME_COPY, type ChatInboxFilter } from '@lantern/shared/chat';
import { Swipeable } from 'react-native-gesture-handler';
import { collectKnownLounges, useCommunityStore } from '../../stores/communityStore';
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
import type { ChatStackParamList } from '../../navigation/types';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { Screen } from '../../components/layout';
import { useChrome } from '../../components/layout/ChromeContext';
import { brand, useTheme } from '../../theme';
import { useLowDataMode } from '../../hooks/useLowDataMode';
import { useNetworkStatus } from '../../hooks/useSync';
import { toTab } from '../../navigation/nestedTab';
import { planReconnectRetry } from './reconnectRetry';
import { AppIcon } from '../../components/ui/AppIcon';

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
  muted = false,
  communityName,
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
  muted?: boolean;
  communityName?: string | null;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        paddingLeft: 16 + nestingLevel * 20,
        borderLeftWidth: nestingLevel > 0 ? 3 : 0,
        // Neutral, not the feature hue: this marks nesting, it is not an accent.
        borderLeftColor: nestingLevel > 0 ? colors.border : 'transparent',
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
          <AppIcon
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
            <Text className="text-label font-bold text-white">{unread > 99 ? '99+' : unread}</Text>
          </View>
        ) : null}
        {selected ? (
          <View className="absolute -bottom-0.5 -right-0.5 h-[18px] w-[18px] rounded-full bg-lantern-primary-fill border border-white items-center justify-center">
            <AppIcon name="checkmark" size={12} color="#ffffff" />
          </View>
        ) : null}
      </View>
      <View className="flex-1 min-w-0">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="text-base font-semibold text-lantern-text flex-1" numberOfLines={1}>
            {name}
          </Text>
          {pinned ? (
            <AppIcon name="pin" size={13} color={colors.textTertiary} />
          ) : null}
          {muted ? (
            <AppIcon name="notifications-off" size={13} color={colors.textTertiary} />
          ) : null}
          {isArchived ? (
            <AppIcon name="archive" size={14} color={colors.textTertiary} />
          ) : null}
          {time ? <Text className="text-xs text-lantern-text-tertiary shrink-0">{time}</Text> : null}
        </View>
        {isMessageRequest ? (
          <Text className="text-xs text-amber-700 dark:text-amber-300 mt-0.5" numberOfLines={1}>
            Message request
          </Text>
        ) : null}
        {preview ? (
          <Text className="text-caption text-lantern-text-secondary mt-0.5" numberOfLines={1}>
            {preview}
          </Text>
        ) : communityName ? (
          <Text className="text-caption text-lantern-text-secondary mt-0.5" numberOfLines={1}>
            in {communityName}
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
          className="px-3 py-1.5 rounded-lg bg-lantern-primary-fill active:opacity-70"
          style={{ opacity: busy ? 0.5 : 1 }}
        >
          <Text className="text-xs font-semibold text-white">Accept</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The floating "Create group" circle: 56dp, the Material FAB size. */
const FAB_SIZE = 56;
/** Breathing room between the last list row and the circle. */
const FAB_GAP = 12;

export function GroupsScreen({ navigation }: Props) {
  const tabBarClearance = useTabBarClearance(16);
  /*
   * The "Create group" FAB floats over this list, so the list has to end
   * ABOVE it. With tab-bar clearance alone the last chat row sat underneath
   * the button and could not be read or tapped ("Pilot hall test Lounge").
   * One constant for the circle, used by both the button and the list's
   * bottom padding, so they cannot drift apart.
   */
  const fabClearance = tabBarClearance + FAB_SIZE + FAB_GAP;
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
  const [inboxFilter, setInboxFilter] = useState<ChatInboxFilter>('all');
  const [mutedKeys, setMutedKeys] = useState<Set<string>>(new Set());
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

  // §4.5 — a community BOARD is not a chat and must not appear in the chat
  // list. Its group row is still in GET /groups, so the filter has to be here,
  // beside the archived / non-top-level ones. The community's lounge and its
  // study groups stay: both are genuinely chats.
  const detailBySlug = useCommunityStore((s) => s.detailBySlug);
  const channelsById = useCommunityStore((s) => s.channelsById);
  const myCommunities = useCommunityStore((s) => s.myCommunities);
  const loadMyCommunities = useCommunityStore((s) => s.loadMine);
  // The membership list carries each community's lounge pointer, so the chat
  // list can tell a lounge from a board without the user having opened the
  // community page. Until it lands, `knownLounges` reports the community as
  // unresolved and every one of its groups stays a chat — never the reverse.
  useEffect(() => {
    void loadMyCommunities().catch(() => undefined);
  }, [loadMyCommunities]);
  const knownLounges = useMemo(
    () => collectKnownLounges(detailBySlug, channelsById, myCommunities),
    [detailBySlug, channelsById, myCommunities]
  );
  const isBoardGroup = useCallback(
    (group: Group) => isHiddenFromChatInbox(group, knownLounges),
    [knownLounges]
  );

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

  const { isConnected } = useNetworkStatus();

  /**
   * True when the server-backed halves of the search bar (people, full message
   * history) came back empty because the request failed rather than because
   * nothing matched. They swallow their own errors so the on-device previews
   * can still answer — but a swallowed error still needs re-running once the
   * radio is back.
   */
  const [userSearchFailed, setUserSearchFailed] = useState(false);
  const [messageSearchFailed, setMessageSearchFailed] = useState(false);
  const searchFailed = userSearchFailed || messageSearchFailed;

  /** Bumped once per reconnection to re-run the two server searches. */
  const [reconnectNonce, setReconnectNonce] = useState(0);

  /**
   * Come back from a dead spot and the pane fixes itself.
   *
   * Before this, a chat list that failed while offline kept its failure on
   * screen after the connection returned, until the student found Retry — the
   * app knew it was back online and said nothing. This is the same auto-retry
   * the SyncStatusIndicator already runs for the auth-offline banner: one
   * shot, a beat after NetInfo says the link is up.
   *
   * ONE shot per reconnection, latched in `reconnectRetried`. The latch is
   * not optional: `groupStore.fetchGroups` clears `listError` when a fetch
   * starts and sets it again when the fetch fails, so to this dependency
   * array a failed retry looks like a brand-new failure ("msg" -> null ->
   * "msg") and would schedule another timer — an unbounded loop whenever
   * Wi-Fi is up but Lantern is not. The latch clears only when NetInfo says
   * the link dropped, so the next real reconnection gets its shot. The rule
   * is in reconnectRetry.ts, where the loop scenario is a test.
   */
  const reconnectRetried = useRef(false);
  useEffect(() => {
    const plan = planReconnectRetry({
      isConnected,
      alreadyRetried: reconnectRetried.current,
      listFailed: !!listError,
      searchFailed,
    });
    if (plan.resetLatch) reconnectRetried.current = false;
    if (!plan.schedule) return;
    const timer = setTimeout(() => {
      reconnectRetried.current = true;
      if (listError) void loadChats();
      if (searchFailed) setReconnectNonce((n) => n + 1);
    }, 1500);
    return () => clearTimeout(timer);
  }, [isConnected, listError, searchFailed, loadChats]);

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
      if (isBoardGroup(group)) continue;
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
        .filter((g) => g.isArchived && !isBoardGroup(g))
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
    rebuilt.push(
      ...openItems.filter((item) => {
        const unread =
          item.kind === 'dm'
            ? item.thread.unreadCount
            : item.kind === 'group'
              ? item.group.unreadCount
              : 0;
        return chatMatchesInboxFilter(unread, inboxFilter);
      }),
    );

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
    isBoardGroup,
    subGroupsMap,
    expandedParentGroups,
    archivedExpanded,
    chatQuery,
    inboxFilter,
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
      setUserSearchFailed(false);
      return;
    }
    const requestId = ++userSearchRef.current;
    const timer = setTimeout(() => {
      void searchUsers(q, 10)
        .then((rows) => {
          if (requestId !== userSearchRef.current) return;
          setUserSearchFailed(false);
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
          if (requestId !== userSearchRef.current) return;
          setUserResults([]);
          // Empty because we could not ask, not because nobody matched.
          setUserSearchFailed(true);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [chatQuery, user?.id, reconnectNonce]);

  // Full-history message search via the server. Older deployments without the
  // endpoint just fail quietly and the latest-message fallback below carries on.
  useEffect(() => {
    const q = chatQuery.trim();
    if (q.length < 2) {
      setMessageResults([]);
      setMessageSearchFailed(false);
      return;
    }
    const requestId = ++messageSearchRef.current;
    const timer = setTimeout(() => {
      void searchMessages(q, 15)
        .then((data) => {
          if (requestId !== messageSearchRef.current) return;
          setMessageSearchFailed(false);
          setMessageResults(data?.results || []);
        })
        .catch(() => {
          if (requestId !== messageSearchRef.current) return;
          setMessageResults([]);
          setMessageSearchFailed(true);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [chatQuery, reconnectNonce]);

  /**
   * What the chat list should render right now, decided by the shared rule so
   * web and mobile cannot drift: a failure outranks both "empty" and
   * "no match", and a search that found nothing says so in the searcher's own
   * words rather than offering to create a group.
   */
  const chatListState = resolveListState({
    loading: isLoading,
    error: listError,
    itemCount: listItems.length,
    query: chatQuery,
  });

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

  const muteOne = async (key: string) => {
    try {
      if (key.startsWith('d:')) await muteDmThread(key.slice(2), '8h');
      else await muteGroupChat(key.slice(2), '8h');
      setMutedKeys((prev) => new Set(prev).add(key));
      useToastStore.getState().showToast('Muted for 8 hours', 'success');
    } catch {
      useToastStore.getState().showToast('Could not mute this chat', 'error');
    }
  };

  const archiveOne = async (item: ListItem) => {
    if (!user?.id) return;
    try {
      const store = useGroupStore.getState();
      if (item.kind === 'dm') await store.archiveDmThread(item.thread.id, user.id);
      else if (item.kind === 'group' && !item.group.isArchived) await store.archiveGroup(item.group.id);
      useToastStore.getState().showToast('Archived', 'success');
    } catch {
      useToastStore.getState().showToast('Could not archive this chat', 'error');
    }
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
    setMutedKeys((prev) => {
      const next = new Set(prev);
      targets.forEach((k, i) => {
        if (results[i]?.status === 'fulfilled') next.add(k);
      });
      return next;
    });
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
        appAlert(
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
        appAlert(
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
    <Screen bottom="none">
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
            <AppIcon name="close" size={24} color={colors.text} />
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
            <AppIcon
              name="pin"
              filled={selectedAllPinned}
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
            <AppIcon name="volume-mute" size={22} color={colors.text} />
          </Pressable>
          <Pressable
            onPress={() => void handleArchiveSelected()}
            className="h-11 w-11 items-center justify-center"
            accessibilityRole="button"
            accessibilityLabel={selectedAllArchived ? 'Unarchive selected' : 'Archive selected'}
          >
            <AppIcon
              name="archive"
              filled={selectedAllArchived}
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
            <AppIcon name="trash" size={22} color={colors.error} />
          </Pressable>
          </View>
        </View>
      ) : (
      <View className="flex-row items-center gap-2 px-4 pt-2 pb-3">
        <View className="flex-1 flex-row items-center gap-2 px-3 rounded-xl border border-lantern-border bg-lantern-surface min-h-[44px]">
          <AppIcon name="search" size={16} color={colors.inputPlaceholder} />
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
              <AppIcon name="close-circle" size={18} color={colors.textTertiary} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => setDmModalOpen(true)}
          className="h-11 w-11 items-center justify-center rounded-xl border border-lantern-border bg-lantern-surface"
          accessibilityRole="button"
          accessibilityLabel="New direct message"
        >
          <AppIcon name="chatbubble" size={18} color={brand.text} />
        </Pressable>
      </View>
      )}
      {!selectionActive ? (
        <View className="flex-row gap-2 px-4 pb-2">
          {(['all', 'unread'] as const).map((id) => (
            <Pressable
              key={id}
              onPress={() => setInboxFilter(id)}
              className={`px-3 py-1.5 rounded-full min-h-[32px] ${
                inboxFilter === id ? 'bg-lantern-ink' : 'bg-lantern-background-secondary'
              }`}
              accessibilityRole="button"
              accessibilityState={{ selected: inboxFilter === id }}
            >
              <Text className={`text-label ${inboxFilter === id ? 'text-lantern-surface' : 'text-lantern-text-secondary'}`}>
                {id === 'all' ? 'All' : 'Unread'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* One decision, made by the shared rule (packages/shared/network):
          failed > stale > loading > ready > noMatch > empty. A load that failed
          never renders as "no conversations yet" or as "no match" — both are
          claims about the data, and a failed request told us nothing about it. */}
      {chatListState === 'loading' ? (
        <LoadingState label="Loading your chats" />
      ) : chatListState === 'failed' ? (
        <ErrorState message={listError ?? 'We couldn’t load your chats.'} onRetry={() => void loadChats()} />
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
          contentContainerStyle={{ paddingBottom: fabClearance }}
          // The live search box sits directly above this list: without this the
          // first tap on a result (a chat, a message hit, a user to DM) is
          // swallowed dismissing the keyboard, so opening one took two taps.
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={brand.text} />
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
            chatListState === 'noMatch' ? (
              <EmptyState
                icon="search"
                title={`No chats match “${chatQuery.trim()}”`}
                description="Try a different name or word, or clear the search to see all your chats."
                action={
                  <Button variant="secondary" onPress={() => setChatQuery('')}>
                    Clear search
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon="people"
                feature="groups"
                title={CHAT_HOME_COPY.firstRunTitle}
                description={CHAT_HOME_COPY.firstRunBody}
                action={
                  <View className="gap-2 w-full items-center">
                    <Button onPress={() => setDmModalOpen(true)}>{CHAT_HOME_COPY.messageSomeone}</Button>
                    <Button variant="secondary" onPress={() => navigation.navigate('CreateGroup')}>
                      {CHAT_HOME_COPY.newGroup}
                    </Button>
                    {myCommunities[0] ? (
                      <Button
                        variant="secondary"
                        onPress={() =>
                          navigation.getParent()?.navigate(
                            'CampusTab',
                            toTab('CommunityDetail', { slug: myCommunities[0].slug }) as never,
                          )
                        }
                      >
                        {CHAT_HOME_COPY.openLounge}
                      </Button>
                    ) : null}
                  </View>
                }
              />
            )
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
                  <AppIcon name="archive" size={16} color={colors.textSecondary} />
                  <Text className="flex-1 text-xs font-semibold uppercase tracking-wider text-lantern-text-secondary">
                    Archived ({item.count})
                  </Text>
                  <AppIcon
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
                  <AppIcon name="chevron-forward" size={16} color={colors.textTertiary} />
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
                  <AppIcon name="chatbubble" size={18} color={brand.text} />
                </Pressable>
              );
            }
            if (item.kind === 'dm') {
              const isMessageRequest =
                item.thread.status === 'pending' &&
                typeof item.thread.requestedBy === 'string' &&
                item.thread.requestedBy !== user?.id;
              const row = (
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
                  muted={mutedKeys.has(`d:${item.thread.id}`)}
                  lowDataMode={lowDataMode}
                  selected={selectedKeys.has(`d:${item.thread.id}`)}
                  pinned={pinnedKeys.has(`d:${item.thread.id}`)}
                  onLongPress={() => toggleSelect(item)}
                  onPress={() => (selectionActive ? toggleSelect(item) : handlePress(item))}
                />
              );
              if (selectionActive) return row;
              return (
                <Swipeable
                  renderRightActions={() => (
                    <View className="flex-row h-full">
                      <Pressable onPress={() => void muteOne(`d:${item.thread.id}`)} className="w-[72px] bg-amber-500 items-center justify-center">
                        <Text className="text-white text-label">Mute</Text>
                      </Pressable>
                      <Pressable onPress={() => void archiveOne(item)} className="w-[72px] bg-slate-500 items-center justify-center">
                        <Text className="text-white text-label">Archive</Text>
                      </Pressable>
                    </View>
                  )}
                >
                  {row}
                </Swipeable>
              );
            }
            const g = item.group;
            const communityName = g.communityId
              ? myCommunities.find((c) => c.id === g.communityId)?.name
              : undefined;
            const groupRow = (
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
                muted={mutedKeys.has(`g:${g.id}`)}
                communityName={communityName}
                onLongPress={() => toggleSelect(item)}
                onPress={() => (selectionActive ? toggleSelect(item) : handlePress(item))}
              />
            );
            if (selectionActive) return groupRow;
            return (
              <Swipeable
                renderRightActions={() => (
                  <View className="flex-row h-full">
                    <Pressable onPress={() => void muteOne(`g:${g.id}`)} className="w-[72px] bg-amber-500 items-center justify-center">
                      <Text className="text-white text-label">Mute</Text>
                    </Pressable>
                    <Pressable onPress={() => void archiveOne(item)} className="w-[72px] bg-slate-500 items-center justify-center">
                      <Text className="text-white text-label">Archive</Text>
                    </Pressable>
                  </View>
                )}
              >
                {groupRow}
              </Swipeable>
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
        className="absolute right-4 items-center justify-center rounded-full bg-lantern-primary-fill"
        style={{
          height: FAB_SIZE,
          width: FAB_SIZE,
          bottom: tabBarClearance - 8,
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.2,
          shadowRadius: 8,
        }}
      >
        <AppIcon name="add" size={28} color="#ffffff" />
      </Pressable>
    </Screen>
  );
}

export default GroupsScreen;
