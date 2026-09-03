import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BOARD_NEW_POST_HIGHLIGHT_MS,
  COMMUNITY_BOARD_COPY,
  COMMUNITY_COPY,
  boardDisplayName,
  canPinOnBoard,
  studyGroupNameFromPost,
  validateBoardSubject,
  type CommunityRole,
} from '@lantern/shared/network';
import {
  CHAT_MUTE_DURATIONS,
  canEditChatMessage,
  canRemoveChatMessage,
  formatMuteUntilLabel,
  type ChatMuteDurationId,
} from '@lantern/shared/utils';
import * as api from '../../services/api';
import { useAuthStore } from '../../stores';
import { useBoardStore } from '../../stores/boardStore';
import { useCommunityStore } from '../../stores/communityStore';
import { useGroupStore, type Message } from '../../stores/groupStore';
import { useToastStore } from '../../stores/toastStore';
import { useChatImageAttach } from '../../hooks/useChatImageAttach';
import { useLowDataMode } from '../../hooks/useLowDataMode';
import { COMPOSER_KEYBOARD_BEHAVIOR } from '../../components/chat/composerKeyboardBehavior';
import { ReportContentSheet } from '../../components/moderation/ReportContentSheet';
import { ActionSheet, BackButton, type ActionSheetItem } from '../../components/ui';
import { BoardComposer, BoardPostCard, PinnedBanner } from '../../components/board';
import { selectBoardPosts, splitBoardBody, toBoardPost } from '../../utils/boardPosts';
import { applyReactionLocally } from '@lantern/shared/chat';

export type BoardNavigation = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  getParent?: () => { navigate: (tab: string, params?: Record<string, unknown>) => void } | undefined;
};

type Params = {
  groupId: string;
  groupName?: string;
  /** A deep link carries only the slug; the rest is resolved from the store. */
  communitySlug?: string;
  communityName?: string;
  communityId?: string;
};

const TOP_THRESHOLD_PX = 80;

/** `@username` mentions in the body → the user ids the API notifies. */
function resolveMentionedUserIds(
  text: string,
  candidates: Array<{ id: string; username: string }>
): string[] {
  const mentioned = new Set(
    [...text.matchAll(/@([a-zA-Z0-9_]{2,32})\b/g)].map((m) => m[1]!.toLowerCase())
  );
  const canMentionAll = candidates.some((c) => c.id === '__all__');
  if (mentioned.has('all') && canMentionAll) {
    return candidates.filter((c) => c.id !== '__all__').map((c) => c.id);
  }
  return candidates
    .filter((c) => mentioned.has(c.username.toLowerCase()) && c.id !== '__all__')
    .map((c) => c.id);
}

/**
 * A community BOARD (spec §4.1) — the body of what used to be
 * `CommunityChannelScreen`. The filename and the route name `CommunityChannel`
 * are kept so deep links and existing navigation params keep working.
 *
 * There is deliberately NO `canAccessDiscoverHub` gate here: rendering a board
 * for a group the viewer already belongs to is authorised by group membership,
 * and refusing it would strand members behind `DiscoverComingSoon` — which is
 * exactly what would force the chat fallback this change exists to close.
 */
export function CommunityBoardScreen({
  navigation,
  route,
}: {
  navigation: BoardNavigation;
  route: { params: Params };
}) {
  const { groupId, groupName, communitySlug } = route.params;
  const user = useAuthStore((s) => s.user);
  const { lowDataMode } = useLowDataMode();

  const groups = useGroupStore((s) => s.groups);
  const messages = useGroupStore((s) => s.messagesCache[groupId]);
  const isLoadingMore = useGroupStore((s) => s.isLoadingMore);
  const pagination = useGroupStore((s) => s.messagePagination[groupId]);
  const markGroupAsRead = useGroupStore((s) => s.markGroupAsRead);
  const patchMessageInState = useGroupStore((s) => s.patchMessageInState);
  const editGroupMessage = useGroupStore((s) => s.editGroupMessage);
  const removeGroupMessage = useGroupStore((s) => s.removeGroupMessage);
  const retryFailedMessage = useGroupStore((s) => s.retryFailedMessage);
  const leaveGroup = useGroupStore((s) => s.leaveGroup);
  const hydrateGroup = useGroupStore((s) => s.hydrateGroup);

  const rawPinnedPost = useBoardStore((s) => s.pinnedByGroup[groupId] ?? null);
  const pinBusy = useBoardStore((s) => !!s.pinBusyByGroup[groupId]);
  const pinError = useBoardStore((s) => s.pinErrorByGroup[groupId] ?? null);
  // The board's own spinner: the group store clears `isLoadingMessages` only
  // for the ACTIVE chat group, which a board never is.
  const isLoadingPosts = useBoardStore((s) => !!s.postsLoadingByGroup[groupId]);
  const loadPinned = useBoardStore((s) => s.loadPinned);
  const clearPinned = useBoardStore((s) => s.clearPinned);
  const clearPinError = useBoardStore((s) => s.clearPinError);
  const setPin = useBoardStore((s) => s.setPin);
  const loadPosts = useBoardStore((s) => s.loadPosts);
  const loadOlderPosts = useBoardStore((s) => s.loadOlderPosts);
  const postToBoard = useBoardStore((s) => s.postToBoard);

  const detail = useCommunityStore((s) => (communitySlug ? s.detailBySlug[communitySlug] : undefined));
  const loadCommunity = useCommunityStore((s) => s.loadCommunity);
  const invalidateCommunity = useCommunityStore((s) => s.invalidate);
  const channelsById = useCommunityStore((s) => s.channelsById);

  const communityId = route.params.communityId ?? detail?.id ?? null;
  const communityName = route.params.communityName ?? detail?.name ?? null;
  const viewerRole: CommunityRole | null =
    (communityId ? channelsById[communityId]?.viewer.role : null) ?? detail?.viewerRole ?? null;

  const group = useMemo(() => groups.find((g) => g.id === groupId), [groups, groupId]);
  const displayName = boardDisplayName({ isLounge: false, name: group?.name || groupName || 'Board' });

  const [refreshing, setRefreshing] = useState(false);
  const [text, setText] = useState('');
  const [subject, setSubject] = useState('');
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [muteMenuOpen, setMuteMenuOpen] = useState(false);
  const [postMenuTarget, setPostMenuTarget] = useState<Message | null>(null);
  const [reportTarget, setReportTarget] = useState<{ type: 'group' | 'message'; id: string; label?: string } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [myReactions, setMyReactions] = useState<Record<string, string[]>>({});
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [newPostCount, setNewPostCount] = useState(0);
  const [chatMuted, setChatMuted] = useState(false);
  const [chatMutedUntil, setChatMutedUntil] = useState<string | null>(null);
  const [muteBusy, setMuteBusy] = useState(false);

  const listRef = useRef<FlatList<Message>>(null);
  const atTopRef = useRef(true);
  const newestIdRef = useRef<string | null>(null);

  const allPosts = useMemo(() => selectBoardPosts(messages), [messages]);

  /**
   * A pin outlives the post it points at: the removal RPC predates `pinned_at`
   * and never cleared it, so a deleted pinned post used to sit at the top of
   * the board as a blank, permanent tombstone. Trust the freshest copy — a
   * realtime removal lands in `messagesCache` long before the pin is refetched.
   */
  const pinnedPost = useMemo(() => {
    if (!rawPinnedPost || rawPinnedPost.removedAt) return null;
    const cached = messages?.find((m) => m.id === rawPinnedPost.id);
    if (cached && (cached.removedAt || cached.isRemoved)) return null;
    return rawPinnedPost;
  }, [rawPinnedPost, messages]);
  const posts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return allPosts;
    return allPosts.filter((p) =>
      `${p.subject ?? ''} ${p.text ?? ''}`.toLowerCase().includes(query)
    );
  }, [allPosts, searchQuery]);

  const memberCount = group?.memberCount ?? group?.members?.length ?? 0;
  const canPin = canPinOnBoard({
    role: viewerRole,
    adminIds: group?.adminIds ?? [],
    userId: user?.id ?? '',
  });

  const mentionCandidates = useMemo(() => {
    const roster = group?.members ?? [];
    const members = roster
      .filter((m) => m.userId !== user?.id && m.username)
      .map((m) => ({ id: m.userId, username: m.username!, name: m.name }));
    const isAdmin =
      !!user?.id && (group?.ownerId === user.id || !!group?.adminIds?.includes(user.id));
    // `@all` stays owner/admin-only, exactly as it is in Chat.
    return isAdmin
      ? [{ id: '__all__', username: 'all', name: 'Everyone in this board' }, ...members]
      : members;
  }, [group?.members, group?.ownerId, group?.adminIds, user?.id]);

  // ---------------------------------------------------------------- loading

  useEffect(() => {
    if (!group) void hydrateGroup(groupId).catch(() => undefined);
  }, [group, groupId, hydrateGroup]);

  useEffect(() => {
    if (!communitySlug || detail || route.params.communityName) return;
    void loadCommunity(communitySlug).catch(() => undefined);
  }, [communitySlug, detail, route.params.communityName, loadCommunity]);

  useEffect(() => {
    // `pinErrorByGroup` lives in a module-level store, so a failure from an
    // earlier visit would otherwise render as fixed chrome on this one.
    clearPinError(groupId);
    void loadPosts(groupId, { refresh: true, lowDataMode });
    void loadPinned(groupId);
    // The unread badge on the community page is the board's ONLY signal now
    // (§3.9), so opening it has to clear it.
    if (user?.id) void markGroupAsRead(groupId, user.id).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, lowDataMode]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void api
      .fetchUserReactionsForGroup(groupId)
      .then((map) => {
        if (!cancelled) setMyReactions(map || {});
      })
      .catch(() => undefined);
    void AsyncStorage.getItem(`lantern_starred_msgs:${user.id}:${groupId}`).then((raw) => {
      if (cancelled || !raw) return;
      try {
        setStarredIds(new Set(JSON.parse(raw) as string[]));
      } catch {
        /* corrupt cache: start clean */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [groupId, user?.id]);

  useEffect(() => {
    let cancelled = false;
    void api
      .getGroupMuteStatus(groupId)
      .then((status) => {
        if (cancelled) return;
        setChatMuted(!!status?.muted);
        setChatMutedUntil(status?.mutedUntil ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  // A post arriving over realtime while scrolled down shows a pill —
  // the board never auto-jumps (§4.1).
  useEffect(() => {
    const newestId = allPosts[0]?.id ?? null;
    if (newestId === newestIdRef.current) return;
    const hadOne = newestIdRef.current !== null;
    newestIdRef.current = newestId;
    if (hadOne && newestId && !atTopRef.current) setNewPostCount((n) => n + 1);
  }, [allPosts]);

  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => setHighlightId(null), BOARD_NEW_POST_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightId]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadPosts(groupId, { refresh: true, lowDataMode });
      await loadPinned(groupId);
    } finally {
      setRefreshing(false);
    }
  }, [groupId, lowDataMode, loadPosts, loadPinned]);

  const scrollToTop = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    setNewPostCount(0);
    atTopRef.current = true;
  }, []);

  // ---------------------------------------------------------------- posting

  const submitPost = useCallback(async (): Promise<boolean> => {
    const trimmed = text.trim();
    if (!trimmed || !user?.id || sending) return false;
    const validated = validateBoardSubject(subject);
    if (validated.error) {
      useToastStore.getState().showToast(validated.error, 'error');
      return false;
    }
    setSending(true);
    try {
      if (editing) {
        await editGroupMessage(groupId, editing.id, trimmed);
        setEditing(null);
        setText('');
        setSubject('');
        return true;
      }
      await postToBoard(groupId, {
        text: trimmed,
        subject: validated.subject,
        senderId: user.id,
        mentionedUserIds: resolveMentionedUserIds(trimmed, mentionCandidates),
      });
      setText('');
      setSubject('');
      scrollToTop();
      setHighlightId(useGroupStore.getState().messagesCache[groupId]?.slice(-1)[0]?.id ?? null);
      return true;
    } catch (error) {
      Alert.alert('Post failed', error instanceof Error ? error.message : 'Please try again.');
      return false;
    } finally {
      setSending(false);
    }
  }, [
    text,
    subject,
    user?.id,
    sending,
    editing,
    editGroupMessage,
    groupId,
    postToBoard,
    mentionCandidates,
    scrollToTop,
  ]);

  const sendMediaMarkdown = useCallback(
    async (markdown: string) => {
      if (!user?.id) return;
      await postToBoard(groupId, { text: markdown, senderId: user.id });
      scrollToTop();
    },
    [groupId, postToBoard, user?.id, scrollToTop]
  );

  const attachImage = useChatImageAttach({
    chatId: groupId,
    onSendMarkdown: sendMediaMarkdown,
    enabled: !!user?.id,
  });

  const toggleReaction = useCallback(
    async (message: Message, emoji: string, added: boolean) => {
      const previousMine = myReactions[message.id] ? [...myReactions[message.id]!] : [];
      const previousCounts = message.reactions;
      setMyReactions((prev) => {
        const mine = new Set(prev[message.id] || []);
        if (added) mine.add(emoji);
        else mine.delete(emoji);
        return { ...prev, [message.id]: [...mine] };
      });
      patchMessageInState(message.id, {
        reactions: applyReactionLocally(previousCounts, emoji, added),
      });
      try {
        const result = added
          ? await api.addMessageReaction(message.id, emoji)
          : await api.removeMessageReaction(message.id, emoji);
        patchMessageInState(message.id, { reactions: result?.reactions ?? {} });
      } catch (error) {
        setMyReactions((prev) => ({ ...prev, [message.id]: previousMine }));
        patchMessageInState(message.id, { reactions: previousCounts });
        useToastStore
          .getState()
          .showToast(
            error instanceof Error ? error.message : 'Could not save that reaction',
            'error'
          );
      }
    },
    [myReactions, patchMessageInState]
  );

  // ------------------------------------------------------------ study group

  const startStudyGroup = useCallback(
    (fromPost?: Message) => {
      if (!communityId || !communityName) {
        useToastStore.getState().showToast(COMMUNITY_BOARD_COPY.studyGroupsUnavailable, 'error');
        return;
      }
      navigation.navigate('CreateGroup', {
        communityId,
        communityName,
        communitySlug,
        communitySurface: 'study_group',
        // §7 entry point 3 ONLY: a group started from a POST leaves a plain
        // TEXT pointer on the board. One started from the header overflow or
        // the study nudge does not. Web applies the same rule.
        ...(fromPost
          ? {
              announceInGroupId: groupId,
              seedName: studyGroupNameFromPost(toBoardPost(fromPost)),
            }
          : {}),
      });
    },
    [communityId, communityName, communitySlug, groupId, navigation]
  );

  // --------------------------------------------------------------- overflow

  const openMembers = useCallback(() => {
    if (!communitySlug) return;
    navigation.navigate('CommunityDetail', { slug: communitySlug });
  }, [communitySlug, navigation]);

  const applyMute = useCallback(
    async (duration: ChatMuteDurationId) => {
      if (muteBusy) return;
      setMuteBusy(true);
      try {
        const status = await api.muteGroupChat(groupId, duration);
        setChatMuted(!!status?.muted);
        setChatMutedUntil(status?.mutedUntil ?? null);
      } catch {
        Alert.alert('Mute failed', 'Could not mute notifications for this board.');
      } finally {
        setMuteBusy(false);
      }
    },
    [groupId, muteBusy]
  );

  const clearMute = useCallback(async () => {
    if (muteBusy) return;
    setMuteBusy(true);
    try {
      await api.unmuteGroupChat(groupId);
      setChatMuted(false);
      setChatMutedUntil(null);
    } catch {
      Alert.alert('Unmute failed', 'Could not unmute notifications for this board.');
    } finally {
      setMuteBusy(false);
    }
  }, [groupId, muteBusy]);

  const showAbout = useCallback(() => {
    Alert.alert(
      displayName,
      [
        group?.description?.trim() || null,
        `${memberCount.toLocaleString()} ${memberCount === 1 ? 'member' : 'members'}`,
        communityName ? COMMUNITY_COPY.inCommunity(communityName) : null,
      ]
        .filter(Boolean)
        .join('\n')
    );
  }, [displayName, group?.description, memberCount, communityName]);

  const confirmLeave = useCallback(() => {
    if (!user?.id) return;
    Alert.alert(COMMUNITY_BOARD_COPY.leaveBoard, `Leave ${displayName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: COMMUNITY_BOARD_COPY.leaveBoard,
        style: 'destructive',
        onPress: () => {
          void leaveGroup(groupId, user.id)
            .then(() => {
              if (communityId) invalidateCommunity(communityId);
              navigation.goBack();
            })
            .catch((error: unknown) => {
              Alert.alert(
                'Could not leave',
                error instanceof Error ? error.message : 'Try again.'
              );
            });
        },
      },
    ]);
  }, [user?.id, displayName, leaveGroup, groupId, communityId, invalidateCommunity, navigation]);

  // §8 parity rule 7: this order is binding and mirrors web exactly.
  const menuItems: ActionSheetItem[] = useMemo(
    () => [
      {
        label: COMMUNITY_BOARD_COPY.searchBoard,
        icon: 'search-outline',
        onPress: () => setSearchOpen(true),
      },
      {
        label: chatMuted
          ? formatMuteUntilLabel(chatMutedUntil)
            ? `Unmute (until ${formatMuteUntilLabel(chatMutedUntil)})`
            : 'Unmute notifications'
          : COMMUNITY_BOARD_COPY.muteBoard,
        icon: chatMuted ? 'notifications-outline' : 'notifications-off-outline',
        disabled: muteBusy,
        onPress: () => {
          if (chatMuted) void clearMute();
          else setMuteMenuOpen(true);
        },
      },
      {
        label: COMMUNITY_COPY.startStudyGroup,
        icon: 'people-outline',
        onPress: () => startStudyGroup(),
      },
      { label: COMMUNITY_BOARD_COPY.aboutBoard, icon: 'information-circle-outline', onPress: showAbout },
      {
        label: COMMUNITY_BOARD_COPY.reportBoard,
        icon: 'flag-outline',
        onPress: () => setReportTarget({ type: 'group', id: groupId, label: displayName }),
      },
      {
        label: COMMUNITY_BOARD_COPY.leaveBoard,
        icon: 'exit-outline',
        destructive: true,
        onPress: confirmLeave,
      },
    ],
    [
      chatMuted,
      chatMutedUntil,
      muteBusy,
      clearMute,
      startStudyGroup,
      showAbout,
      groupId,
      displayName,
      confirmLeave,
    ]
  );

  const postMenuItems: ActionSheetItem[] = useMemo(() => {
    const target = postMenuTarget;
    if (!target) return [];
    const { body } = splitBoardBody(target.text);
    const items: ActionSheetItem[] = [];
    if (body) {
      items.push({
        label: COMMUNITY_BOARD_COPY.copyText,
        icon: 'copy-outline',
        onPress: () => {
          void Clipboard.setStringAsync(body)
            .then(() => AccessibilityInfo.announceForAccessibility('Post copied'))
            .catch(() => Alert.alert('Copy failed', 'Could not copy the post text.'));
        },
      });
    }
    const starred = starredIds.has(target.id);
    items.push({
      label: starred ? COMMUNITY_BOARD_COPY.saved : COMMUNITY_BOARD_COPY.saveForMe,
      icon: starred ? 'star' : 'star-outline',
      hint: 'Only you can see this',
      onPress: () => {
        if (!user?.id) return;
        const next = new Set(starredIds);
        if (starred) next.delete(target.id);
        else next.add(target.id);
        setStarredIds(next);
        void AsyncStorage.setItem(
          `lantern_starred_msgs:${user.id}:${groupId}`,
          JSON.stringify([...next])
        );
      },
    });
    // Reporting your own post is not a thing anywhere else in the product
    // (`MessageItem.tsx`, `GroupChatScreen`'s long-press menu) and web's board
    // card already hides it — §8 parity rule 7 makes the row order binding.
    if (target.senderId !== user?.id) {
      items.push({
        label: COMMUNITY_BOARD_COPY.reportPost,
        icon: 'flag-outline',
        onPress: () =>
          setReportTarget({
            type: 'message',
            id: target.id,
            label: body.slice(0, 120) || undefined,
          }),
      });
    }
    if (
      canEditChatMessage(
        {
          id: target.id,
          senderId: target.senderId,
          timestamp: target.createdAt,
          type: target.type,
          text: target.text,
          isRemoved: target.isRemoved,
          removedAt: target.removedAt,
        },
        user?.id
      )
    ) {
      items.push({
        label: COMMUNITY_BOARD_COPY.editPost,
        icon: 'create-outline',
        onPress: () => {
          setEditing({ id: target.id, text: body });
          setText(body);
        },
      });
    }
    if (
      canRemoveChatMessage(
        {
          id: target.id,
          senderId: target.senderId,
          timestamp: target.createdAt,
          type: target.type,
          isRemoved: target.isRemoved,
          removedAt: target.removedAt,
        },
        user?.id
      )
    ) {
      items.push({
        label: COMMUNITY_BOARD_COPY.deletePost,
        icon: 'trash-outline',
        destructive: true,
        onPress: () => {
          Alert.alert(COMMUNITY_BOARD_COPY.deletePost, 'This cannot be undone.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                if (pinnedPost?.id === target.id) clearPinned(groupId);
                void removeGroupMessage(groupId, target.id).catch(() => undefined);
              },
            },
          ]);
        },
      });
    }
    if (canPin) {
      const isPinned = pinnedPost?.id === target.id;
      items.push({
        label: isPinned ? COMMUNITY_BOARD_COPY.unpin : COMMUNITY_BOARD_COPY.pin,
        icon: 'pin-outline',
        disabled: pinBusy,
        onPress: () => void setPin(groupId, target.id, !isPinned),
      });
    }
    items.push({
      label: COMMUNITY_BOARD_COPY.openStudyGroup,
      icon: 'school-outline',
      onPress: () => startStudyGroup(target),
    });
    return items;
  }, [
    postMenuTarget,
    starredIds,
    user?.id,
    groupId,
    canPin,
    pinnedPost?.id,
    pinBusy,
    setPin,
    clearPinned,
    removeGroupMessage,
    startStudyGroup,
  ]);

  // ----------------------------------------------------------------- render

  const openComments = useCallback(
    (post: Message) => {
      navigation.navigate('CommunityPost', {
        groupId,
        rootId: post.id,
        communitySlug,
        communityName: communityName ?? undefined,
      });
    },
    [navigation, groupId, communitySlug, communityName]
  );

  const renderPost = useCallback(
    ({ item }: { item: Message }) => (
      <BoardPostCard
        post={item}
        now={Date.now()}
        isOwn={item.senderId === user?.id}
        authorIsAdmin={!!group?.adminIds?.includes(item.senderId)}
        myReactions={myReactions[item.id]}
        lowDataMode={lowDataMode}
        highlighted={highlightId === item.id}
        onOpenComments={() => openComments(item)}
        onToggleReaction={(message, emoji, added) => void toggleReaction(message, emoji, added)}
        onOverflow={() => setPostMenuTarget(item)}
        onRetry={
          item.deliveryState === 'failed' && user?.id
            ? () => void retryFailedMessage(groupId, item.id, user.id).catch(() => undefined)
            : undefined
        }
        onStartStudyGroup={() => startStudyGroup(item)}
      />
    ),
    [
      user?.id,
      group?.adminIds,
      myReactions,
      lowDataMode,
      highlightId,
      openComments,
      toggleReaction,
      retryFailedMessage,
      groupId,
      startStudyGroup,
    ]
  );

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top', 'bottom']}>
      <View className="flex-row items-center h-[56px] pr-2 border-b border-lantern-border">
        <BackButton onPress={() => navigation.goBack()} style={{ marginLeft: 4 }} />
        <Pressable
          onPress={openMembers}
          disabled={!communitySlug}
          accessibilityRole={communitySlug ? 'link' : undefined}
          accessibilityLabel={
            communityName ? `${displayName}, ${COMMUNITY_COPY.inCommunity(communityName)}` : displayName
          }
          className="flex-1 min-w-0 ml-1 justify-center min-h-[44px]"
        >
          <Text className="text-base font-semibold text-lantern-text" numberOfLines={1}>
            {displayName}
          </Text>
          {/* Low-data mode keeps naming the community: it is the only
              community affordance on this screen (§4.1 / §10). */}
          <Text className="text-xs text-lantern-primary" numberOfLines={1}>
            {[communityName, memberCount > 0 ? `${memberCount.toLocaleString()} members` : null]
              .filter(Boolean)
              .join(' · ') || COMMUNITY_COPY.membersOnly}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setMenuOpen(true)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="More actions"
          className="min-h-[44px] min-w-[44px] items-center justify-center"
        >
          <Ionicons name="ellipsis-vertical" size={20} color="#64748b" />
        </Pressable>
      </View>

      {searchOpen ? (
        <View className="flex-row items-center gap-2 border-b border-lantern-border bg-lantern-surface px-3 py-2">
          <Ionicons name="search" size={16} color="#94a3b8" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={COMMUNITY_BOARD_COPY.searchBoard}
            placeholderTextColor="#94a3b8"
            autoFocus
            accessibilityLabel={COMMUNITY_BOARD_COPY.searchBoard}
            className="flex-1 min-h-[44px] text-sm text-lantern-text"
          />
          <Pressable
            onPress={() => {
              setSearchOpen(false);
              setSearchQuery('');
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close search"
            className="min-h-[44px] min-w-[44px] items-center justify-center"
          >
            <Ionicons name="close" size={18} color="#94a3b8" />
          </Pressable>
        </View>
      ) : null}

      {pinnedPost ? (
        <PinnedBanner
          post={pinnedPost}
          canUnpin={canPin}
          busy={pinBusy}
          onPress={() => openComments(pinnedPost)}
          onUnpin={() => void setPin(groupId, pinnedPost.id, false)}
        />
      ) : null}

      {pinError ? <Text className="px-4 pt-2 text-xs text-lantern-error">{pinError}</Text> : null}

      {newPostCount > 0 ? (
        <Pressable
          onPress={scrollToTop}
          accessibilityRole="button"
          accessibilityLiveRegion="polite"
          accessibilityLabel={COMMUNITY_BOARD_COPY.newPosts(newPostCount)}
          className="mx-auto mt-2 min-h-[44px] justify-center rounded-full bg-lantern-primary px-4"
        >
          <Text className="text-xs font-semibold text-white">
            {COMMUNITY_BOARD_COPY.newPosts(newPostCount)}
          </Text>
        </Pressable>
      ) : null}

      <KeyboardAvoidingView
        className="flex-1"
        behavior={COMPOSER_KEYBOARD_BEHAVIOR}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={posts}
          keyExtractor={(item) => item.id}
          renderItem={renderPost}
          onScroll={(event) => {
            atTopRef.current = event.nativeEvent.contentOffset.y <= TOP_THRESHOLD_PX;
            if (atTopRef.current && newPostCount > 0) setNewPostCount(0);
          }}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
          }
          contentContainerStyle={{ paddingVertical: 8, flexGrow: 1 }}
          ListEmptyComponent={
            isLoadingPosts ? (
              <View className="py-10 items-center">
                <ActivityIndicator color="#6366f1" />
              </View>
            ) : (
              <View className="px-6 py-10">
                <Text className="text-center text-sm text-lantern-text-secondary">
                  {COMMUNITY_BOARD_COPY.emptyBoard}
                </Text>
                <Pressable
                  onPress={() => startStudyGroup()}
                  accessibilityRole="button"
                  accessibilityLabel={COMMUNITY_BOARD_COPY.studyNudge}
                  className="mt-3 min-h-[44px] justify-center"
                >
                  <Text className="text-center text-sm font-semibold text-lantern-primary">
                    {COMMUNITY_BOARD_COPY.studyNudge}
                  </Text>
                </Pressable>
              </View>
            )
          }
          ListFooterComponent={
            pagination?.hasMore && !searchQuery ? (
              <Pressable
                onPress={() => void loadOlderPosts(groupId, { lowDataMode })}
                disabled={isLoadingMore}
                accessibilityRole="button"
                accessibilityLabel={COMMUNITY_BOARD_COPY.loadOlder}
                accessibilityState={{ disabled: isLoadingMore, busy: isLoadingMore }}
                className="mx-3 my-3 min-h-[44px] items-center justify-center rounded-xl border border-lantern-border"
              >
                {isLoadingMore ? (
                  <ActivityIndicator color="#6366f1" />
                ) : (
                  <Text className="text-sm font-semibold text-lantern-primary">
                    {COMMUNITY_BOARD_COPY.loadOlder}
                  </Text>
                )}
              </Pressable>
            ) : null
          }
        />

        <BoardComposer
          groupId={groupId}
          avatarUrl={user?.user_metadata?.avatar_url ?? null}
          authorName={user?.user_metadata?.name || 'You'}
          text={text}
          onChangeText={setText}
          subject={subject}
          onChangeSubject={setSubject}
          sending={sending}
          lowDataMode={lowDataMode}
          mentionCandidates={mentionCandidates}
          onPost={submitPost}
          onAttachImage={attachImage}
          onSendAudioMarkdown={sendMediaMarkdown}
          editing={editing}
          onCancelEdit={() => {
            setEditing(null);
            setText('');
          }}
        />
      </KeyboardAvoidingView>

      <ActionSheet
        visible={menuOpen}
        title={displayName}
        items={menuItems.map((item) => ({
          ...item,
          onPress: () => {
            setMenuOpen(false);
            item.onPress();
          },
        }))}
        onClose={() => setMenuOpen(false)}
      />

      <ActionSheet
        visible={muteMenuOpen}
        title={COMMUNITY_BOARD_COPY.muteBoard}
        items={CHAT_MUTE_DURATIONS.map((option) => ({
          label: option.label,
          icon: 'notifications-off-outline' as const,
          onPress: () => {
            setMuteMenuOpen(false);
            void applyMute(option.id);
          },
        }))}
        onClose={() => setMuteMenuOpen(false)}
      />

      <ActionSheet
        visible={!!postMenuTarget}
        title={COMMUNITY_BOARD_COPY.post}
        items={postMenuItems.map((item) => ({
          ...item,
          onPress: () => {
            setPostMenuTarget(null);
            item.onPress();
          },
        }))}
        onClose={() => setPostMenuTarget(null)}
      />

      <ReportContentSheet
        visible={!!reportTarget}
        targetType={reportTarget?.type === 'group' ? 'group' : 'message'}
        targetId={reportTarget?.id ?? ''}
        targetLabel={reportTarget?.label}
        onClose={() => setReportTarget(null)}
      />
    </SafeAreaView>
  );
}

export default CommunityBoardScreen;
