import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  RefreshControl,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BOARD_FAVORITE_EMOJI,
  BOARD_NEW_POST_HIGHLIGHT_MS,
  COMMUNITY_BOARD_COPY,
  COMMUNITY_COPY,
  boardDisplayName,
  boardRepostRefusalCopy,
  boardSharePayload,
  canRepostBoardPost,
  communityDisplayName,
  isBoardFavorited,
  memberCountLabel,
  studyGroupNameFromPost,
  validateBoardSubject,
  COMMUNITY_MODERATION_COPY,
  requestFailureCopy,
  type BoardPostKind,
  type CommunityRole,
} from '@lantern/shared/network';
import { COMMUNITY_NOT_ENABLED_COPY, isNotEnabledError } from '@lantern/shared/api';
import {
  CHAT_MUTE_DURATIONS,
  canEditChatMessage,
  canRemoveChatMessage,
  formatMuteUntilLabel,
  type ChatMuteDurationId,
} from '@lantern/shared/utils';
import * as api from '../../services/api';
import { removeCommunityPost, api as lanternEndpoints } from '../../services/api';
import { uploadChatImage } from '../../services/chatImageUpload';
import { importLocalBookmarksOnce } from '../../services/bookmarkImport';
import { useAuthStore } from '../../stores';
import { useBoardStore } from '../../stores/boardStore';
import { useCommunityStore } from '../../stores/communityStore';
import { useGroupStore, type Message } from '../../stores/groupStore';
import { useToastStore } from '../../stores/toastStore';
import { useLowDataMode } from '../../hooks/useLowDataMode';
import { COMPOSER_KEYBOARD_BEHAVIOR } from '../../components/chat/composerKeyboardBehavior';
import { ReportContentSheet } from '../../components/moderation/ReportContentSheet';
import { ActionSheet, BackButton, type ActionSheetItem } from '../../components/ui';
import { BoardComposer, BoardPostCard, BoardRepostSheet, PinnedBanner } from '../../components/board';
import {
  boardActionTargetId,
  selectBoardPosts,
  splitBoardBody,
  toBoardPost,
} from '../../utils/boardPosts';
import { applyReactionLocally } from '@lantern/shared/chat';
import { AppIcon } from '../../components/ui/AppIcon';
import {
  boardPostActions,
  buildBoardComposerModel,
  resolveComposerKind,
} from './boardComposerModel';
import { usePlatformAdmin } from '../../hooks/usePlatformAdmin';
import { useProfileIdentity } from '../../hooks/useProfileIdentity';

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

/**
 * A moderator's soft removal, as distinct from the author's own Delete. The
 * shared board copy has no word for it: `COMMUNITY_MODERATION_COPY` names the
 * TOMBSTONE ("Removed by a moderator") and the reason placeholder, which are
 * what the reader sees afterwards; this is the moderator's own menu row.
 */
const REMOVE_POST_LABEL = 'Remove post';

/**
 * Un-accepting an answer needs no reply — only the question's id — so a screen
 * that already knows a question is answered can offer it without the thread.
 * ACCEPTING a reply is not here on purpose: you cannot point at a reply the
 * board never shows (see `boardComposerModel`, `replyAnswerMenuAction`), so
 * "Mark as answer" lives on the reply's own long-press in the thread.
 */
const CLEAR_ANSWER_LABEL = 'Clear accepted answer';

/**
 * The accepted-answer id a board row carries. `mapApiMessage` (via
 * `boardActionFields`) now maps `messages.answered_message_id` onto the typed
 * `Message.answeredMessageId` conditionally on presence, so this reads a real
 * field. It still normalises defensively — a cleared answer arrives as `null`,
 * which is not an accepted-answer id — collapsing both "cleared" and "absent"
 * to null for the caller; the seed effect below keys on key PRESENCE, not on
 * this return, to keep those two cases distinct.
 */
function readPostAnswerId(post: Message): string | null {
  const raw = (post as { answeredMessageId?: unknown }).answeredMessageId;
  return typeof raw === 'string' && raw ? raw : null;
}

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
  // One name and one face for this student, shared with Me and Settings.
  const identity = useProfileIdentity();
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
  /**
   * Subscribed as an ARRAY and a BOOLEAN, never as a freshly built object.
   * A selector that returns `{ ids, supported }` allocates on every store
   * write, zustand's `Object.is` comparison then always says "changed", and
   * the screen re-renders forever — the production freeze this codebase has
   * already paid for once. The Set below is derived with `useMemo` instead.
   */
  const bookmarkedIds = useBoardStore((s) => s.bookmarkedByGroup[groupId]);
  const bookmarksSupported = useBoardStore((s) => s.bookmarksSupported[groupId] !== false);
  /**
   * `bookmarksSupported` is OPTIMISTIC — it reads `!== false`, so it is true
   * before the server has answered, which is what stops the Bookmark control
   * flashing in. That default is wrong for the one-time import: "not answered
   * yet" is not "the table exists", and firing the import on mount sends a
   * doomed request on every launch against a database without the migration.
   * This one waits for the actual `serverBacked: true`.
   */
  const bookmarksConfirmed = useBoardStore((s) => s.bookmarksSupported[groupId] === true);
  const loadBookmarks = useBoardStore((s) => s.loadBookmarks);
  const toggleBookmarkOnBoard = useBoardStore((s) => s.toggleBookmark);
  const repostOnBoard = useBoardStore((s) => s.repost);
  const undoRepostOnBoard = useBoardStore((s) => s.undoRepost);

  const detail = useCommunityStore((s) => (communitySlug ? s.detailBySlug[communitySlug] : undefined));
  const loadCommunity = useCommunityStore((s) => s.loadCommunity);
  const invalidateCommunity = useCommunityStore((s) => s.invalidate);
  const channelsById = useCommunityStore((s) => s.channelsById);

  const communityId = route.params.communityId ?? detail?.id ?? null;
  // Derived course rooms are stored as `code — title`, which reads
  // "PHARM 212 — PHARM 212" whenever the title is the code again.
  const communityName = communityDisplayName(route.params.communityName ?? detail?.name) || null;
  const viewerRole: CommunityRole | null =
    (communityId ? channelsById[communityId]?.viewer.role : null) ?? detail?.viewerRole ?? null;
  /**
   * A platform admin moderates every community — the only moderation an
   * auto-derived campus room with no owner gets. Passed into the SHARED rules
   * so the card offers exactly what `communityModeration.removePost` allows.
   */
  const isPlatformAdmin = usePlatformAdmin();

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
  /** The uploaded photo waiting to go out WITH the text, as one row (§5.3). */
  const [attachedImageUrl, setAttachedImageUrl] = useState<string | null>(null);
  const [attachingImage, setAttachingImage] = useState(false);
  const [repostTarget, setRepostTarget] = useState<Message | null>(null);
  const [repostBusy, setRepostBusy] = useState(false);
  const [shareTarget, setShareTarget] = useState<Message | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [newPostCount, setNewPostCount] = useState(0);
  /**
   * What the next post IS. Held here rather than in the composer so a kind the
   * viewer may no longer post (a demoted moderator with `announcement`
   * selected) can be dropped by `resolveComposerKind` on the next render.
   */
  const [postKind, setPostKind] = useState<BoardPostKind>('discussion');
  /** A moderator's soft removal, which carries a reason. */
  const [removeTarget, setRemoveTarget] = useState<Message | null>(null);
  const [removeReason, setRemoveReason] = useState('');
  const [removeBusy, setRemoveBusy] = useState(false);
  const [chatMuted, setChatMuted] = useState(false);
  const [chatMutedUntil, setChatMutedUntil] = useState<string | null>(null);
  const [muteBusy, setMuteBusy] = useState(false);
  /**
   * Each question's accepted answer, by post id — the board's own answered
   * state, exactly as web's `CommunityBoard` keeps it, so a card resolves
   * "answered?" without waiting on the store to model the column. Seeded from
   * any row that carries the field (presence is authoritative, even a null
   * clear), then owned by `handleSetAnswer`.
   */
  const [answeredByPost, setAnsweredByPost] = useState<Record<string, string | null>>({});

  const listRef = useRef<FlatList<Message>>(null);
  const atTopRef = useRef(true);
  const newestIdRef = useRef<string | null>(null);

  const allPosts = useMemo(() => selectBoardPosts(messages), [messages]);
  const bookmarkedSet = useMemo(() => new Set(bookmarkedIds ?? []), [bookmarkedIds]);

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

  /**
   * The composer's permissions, from the SHARED rules — `canPostOnBoard` and
   * `canPostBoardKind` via `buildBoardComposerModel`. This replaces the old
   * `canPinOnBoard` + local admin-list check: a board's own `adminIds` are not
   * the community's moderators, and the API decides from the community role,
   * so the two used to disagree on exactly the accounts that matter.
   */
  const composer = useMemo(
    () =>
      buildBoardComposerModel({
        role: viewerRole,
        isMember: !!group,
        mutedUntil: detail?.viewerMutedUntil ?? null,
      }),
    [viewerRole, group, detail?.viewerMutedUntil]
  );
  const selectedKind = resolveComposerKind(postKind, composer);

  /** One post's actions, always from `boardPostRules`. */
  const actionsFor = useCallback(
    (post: Message) =>
      boardPostActions(viewerRole, {
        // The pin endpoint credits a board's own admins as well as the
        // community's moderators; removal and announcements do not.
        boardAdmin: !!user?.id && !!group?.adminIds?.includes(user.id),
        isPlatformAdmin,
        senderId: post.senderId,
        viewerId: user?.id ?? '',
        postKind: post.postKind ?? null,
        pinnedAt: post.pinnedAt ?? null,
        removedAt: post.removedAt ?? (post.isRemoved ? post.createdAt : null),
        // The board's own answered state wins over the row whenever the map
        // HAS an entry for this post — presence, not truthiness. An in-session
        // CLEAR is a `null`, and `??` would fall straight back to the row,
        // which still carries the old answer until it refetches: the reader
        // would tap "Clear accepted answer" and watch the row stay. A post the
        // map has never heard of falls back to whatever the row carries.
        answeredMessageId:
          post.id in answeredByPost
            ? answeredByPost[post.id] ?? null
            : readPostAnswerId(post),
        mutedUntil: detail?.viewerMutedUntil ?? null,
      }),
    [viewerRole, isPlatformAdmin, user?.id, group?.adminIds, detail?.viewerMutedUntil, answeredByPost]
  );

  /**
   * Seed the answered map from whatever the loaded rows carry. Presence of the
   * field — even a null clear — is authoritative; a row that omits it (a
   * pre-migration row, or a realtime patch that did not carry it) leaves a
   * known answer untouched, so a live favorite never blanks it. The store now
   * models `answered_message_id` (mapped on presence by `boardActionFields`),
   * so a loaded question row seeds its answer here; `handleSetAnswer` still
   * drives an in-session mark or clear before the row refetches.
   */
  useEffect(() => {
    setAnsweredByPost((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const post of allPosts) {
        if (!post?.id || !('answeredMessageId' in post)) continue;
        const value = readPostAnswerId(post);
        if (next[post.id] !== value) {
          next[post.id] = value;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [allPosts]);

  /**
   * Accept a reply as a question's answer, or clear it (`null`). The board
   * itself only ever CLEARS (the un-answer path needs no reply); accepting a
   * specific reply is driven from the thread, which calls this same endpoint.
   *
   * Optimistic, then reconciled to the server's own value. The gate is the
   * server's — it re-derives `canMarkAnswered` from the same shared rules — so
   * a refusal reverts the map and speaks the shared failure vocabulary, never a
   * raw message. A pre-migration API's 503 reads as the app's "not switched on
   * yet" copy, never an error the student caused.
   */
  const handleSetAnswer = useCallback(
    async (postId: string, answerMessageId: string | null) => {
      if (!communityId) return;
      const previous = answeredByPost[postId] ?? null;
      setAnsweredByPost((prev) => ({ ...prev, [postId]: answerMessageId }));
      try {
        const result = await lanternEndpoints.markCommunityPostAnswered(
          communityId,
          postId,
          answerMessageId
        );
        setAnsweredByPost((prev) => ({ ...prev, [postId]: result.answeredMessageId }));
      } catch (error) {
        setAnsweredByPost((prev) => ({ ...prev, [postId]: previous }));
        const status =
          error && typeof error === 'object' ? (error as { status?: unknown }).status : undefined;
        const message =
          isNotEnabledError(error) || status === 503
            ? COMMUNITY_NOT_ENABLED_COPY
            : requestFailureCopy(error).title;
        useToastStore.getState().showToast(message, 'error');
      }
    },
    [communityId, answeredByPost]
  );

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
    // Same shape and lifecycle as user-reactions above, so the Bookmark icon
    // paints filled on the first frame instead of flipping a moment later.
    void loadBookmarks(groupId);
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
  }, [groupId, user?.id, loadBookmarks]);

  /**
   * The one-time move of the device-local "Save for me" saves into
   * `message_bookmarks` (§7.3).
   *
   * Gated on a `serverBacked: true` response, so it never fires against a
   * database the founder has not applied the migration to yet — and it only
   * imports from groups resolved as BOARDS, because group chat and DMs write
   * the identical AsyncStorage key shape for their own stars.
   */
  useEffect(() => {
    if (!user?.id || !bookmarksConfirmed) return;
    let cancelled = false;
    void importLocalBookmarksOnce(user.id).then((imported) => {
      if (!cancelled && imported > 0) void loadBookmarks(groupId);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id, bookmarksConfirmed, groupId, loadBookmarks]);

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
    // A photo alone is a post (§5 acceptance 13). Only an EMPTY post is
    // refused, and editing still requires text because the edit endpoint
    // updates `text` and nothing else.
    if (!user?.id || sending) return false;
    if (!trimmed && (editing || !attachedImageUrl)) return false;
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
        // ONE row: the title, the body and the photo, on `messages.image_url`.
        // Attaching used to post the photo as its own separate message.
        imageUrl: attachedImageUrl,
        // Dropped (not rejected) by a pre-migration API, and re-checked there:
        // `announcement` from a plain member is a 403, which is why the picker
        // never offers it to one.
        postKind: selectedKind,
      });
      setText('');
      setSubject('');
      setAttachedImageUrl(null);
      scrollToTop();
      setHighlightId(useGroupStore.getState().messagesCache[groupId]?.slice(-1)[0]?.id ?? null);
      return true;
    } catch (error) {
      appAlert('Post failed', error instanceof Error ? error.message : 'Please try again.');
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
    attachedImageUrl,
    selectedKind,
  ]);

  const sendMediaMarkdown = useCallback(
    async (markdown: string) => {
      if (!user?.id) return;
      await postToBoard(groupId, { text: markdown, senderId: user.id });
      scrollToTop();
    },
    [groupId, postToBoard, user?.id, scrollToTop]
  );

  /**
   * Pick → upload → park the url in composer state. It does NOT send.
   *
   * This is the §5.1 gap: the shipped path was
   * `useChatImageAttach` → `sendMediaMarkdown` → `postToBoard({ text: markdown })`,
   * so attaching a photo posted it as its own separate row and whatever the
   * student had typed stayed in the box. The upload overlaps with typing;
   * `attachingImage` is what the composer chip reports.
   */
  const attachImage = useCallback(
    async (uri: string, mimeType?: string | null) => {
      if (!user?.id) return;
      setAttachingImage(true);
      try {
        const { url } = await uploadChatImage(uri, mimeType, groupId);
        setAttachedImageUrl(url);
        AccessibilityInfo.announceForAccessibility(COMMUNITY_BOARD_COPY.photoAttached);
      } catch (error) {
        // The message names the real reason — an oversized GIF, a HEIC pick —
        // because "Failed to send image" taught the student nothing about
        // what to do differently.
        useToastStore
          .getState()
          .showToast(
            error instanceof Error && error.message
              ? error.message
              : COMMUNITY_BOARD_COPY.invalidImage,
            'error'
          );
      } finally {
        setAttachingImage(false);
      }
    },
    [groupId, user?.id]
  );

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

  /**
   * Every board action except Undo repost targets the ORIGINAL post.
   *
   * On a repost card that is NOT the row you tapped: favoriting, commenting,
   * bookmarking and reporting all act on the post being bumped, so counts
   * never fragment across copies, no comment ever attaches to a repost row,
   * and `content_reports`' UNIQUE (reporter, target_type, target_id) keeps one
   * report covering every copy (§6.5).
   */
  const targetOf = useCallback(
    (post: Message): Message => {
      const id = boardActionTargetId(post);
      if (id === post.id) return post;
      /**
       * The original may be older than the loaded page, so the cache lookup
       * can miss. When it does, keep the resolved ID — it comes from
       * `client_message_id`, not from the cache — and carry only the counts
       * we actually have. Falling back to the repost ROW would send the
       * favorite and the bookmark to the wrong message.
       */
      const cached = (messages || []).find((m) => m.id === id);
      return cached ?? { ...post, id, reactions: post.repostOf ? {} : post.reactions };
    },
    [messages]
  );

  const toggleFavorite = useCallback(
    (post: Message) => {
      const target = targetOf(post);
      void toggleReaction(
        target,
        BOARD_FAVORITE_EMOJI,
        !isBoardFavorited(myReactions[target.id])
      );
    },
    [targetOf, toggleReaction, myReactions]
  );

  const toggleBookmark = useCallback(
    async (post: Message) => {
      const targetId = boardActionTargetId(post);
      const next = !bookmarkedSet.has(targetId);
      const ok = await toggleBookmarkOnBoard(groupId, targetId, next);
      if (!ok) {
        useToastStore.getState().showToast(COMMUNITY_BOARD_COPY.bookmarksUnavailable, 'error');
      }
    },
    [bookmarkedSet, toggleBookmarkOnBoard, groupId]
  );

  /**
   * Open the repost sheet — or refuse before opening it, with the reason.
   *
   * The client checks `canRepostBoardPost` so the student is told why rather
   * than watching a sheet fail; the server re-checks every rule, so calling
   * the endpoint directly with curl is refused too (acceptance 17).
   */
  const openRepost = useCallback(
    (post: Message) => {
      const target = targetOf(post);
      if (target.repostedByMe) {
        setRepostTarget(target);
        return;
      }
      const verdict = canRepostBoardPost({
        post: toBoardPost(target),
        viewerId: user?.id ?? '',
      });
      if (!verdict.ok) {
        useToastStore.getState().showToast(boardRepostRefusalCopy(verdict.reason), 'error');
        return;
      }
      setRepostTarget(target);
    },
    [targetOf, user?.id]
  );

  const confirmRepost = useCallback(
    async (quote: string) => {
      const target = repostTarget;
      if (!target || repostBusy) return;
      setRepostBusy(true);
      const error = await repostOnBoard(groupId, target.id, quote);
      setRepostBusy(false);
      if (error) {
        useToastStore.getState().showToast(error, 'error');
        return;
      }
      setRepostTarget(null);
      // The bump belongs at the top, which is where the board opens.
      scrollToTop();
    },
    [repostTarget, repostBusy, repostOnBoard, groupId, scrollToTop]
  );

  const confirmUndoRepost = useCallback(async () => {
    const target = repostTarget;
    if (!target || repostBusy) return;
    setRepostBusy(true);
    const error = await undoRepostOnBoard(groupId, target.id);
    setRepostBusy(false);
    if (error) {
      useToastStore.getState().showToast(error, 'error');
      return;
    }
    setRepostTarget(null);
  }, [repostTarget, repostBusy, undoRepostOnBoard, groupId]);

  /**
   * The share sheet's three rows: Copy link, Copy text, Share via… (§8.1).
   *
   * The payload is `boardSharePayload` and nothing else — a title and a URL.
   * Never `post.text`, never a body snippet, never a media URL: a signed
   * storage URL in a share payload is a members-only object leaving the board.
   * The link itself carries no preview either; the recipient's own membership
   * is what decides whether they see anything.
   */
  const shareItems: ActionSheetItem[] = useMemo(() => {
    const post = shareTarget;
    if (!post) return [];
    const target = targetOf(post);
    // The ORIGINAL's id, even when the original is older than the loaded page
    // and `targetOf` had to fall back to the repost row: the link is minted
    // from the id in `client_message_id`, not from whatever is in the cache.
    const payload = boardSharePayload(
      { ...toBoardPost(target), id: boardActionTargetId(post) },
      { slug: communitySlug ?? null, groupId, boardName: displayName }
    );
    const items: ActionSheetItem[] = [
      {
        label: COMMUNITY_BOARD_COPY.copyLink,
        icon: 'link',
        onPress: () => {
          void Clipboard.setStringAsync(payload.url)
            .then(() => AccessibilityInfo.announceForAccessibility(COMMUNITY_BOARD_COPY.linkCopied))
            .catch(() =>
              useToastStore.getState().showToast(COMMUNITY_BOARD_COPY.shareFailed, 'error')
            );
        },
      },
    ];
    // "Copy text" moves out of the card overflow into this sheet, on both
    // platforms in the same commit. It keeps using `splitBoardBody`, so
    // `![image](https://…)` never reaches the clipboard, and it is omitted on
    // a media-only post exactly as the overflow does today.
    const { body } = splitBoardBody(target.text);
    if (body) {
      items.push({
        label: COMMUNITY_BOARD_COPY.copyText,
        icon: 'copy',
        onPress: () => {
          void Clipboard.setStringAsync(body)
            .then(() => AccessibilityInfo.announceForAccessibility('Post copied'))
            .catch(() =>
              useToastStore.getState().showToast(COMMUNITY_BOARD_COPY.shareFailed, 'error')
            );
        },
      });
    }
    items.push({
      label: `${COMMUNITY_BOARD_COPY.share} via…`,
      icon: 'share',
      onPress: () => {
        // The same `Share.share` call the community invite already makes.
        // `message` is the URL alone: Android has no title field and would
        // otherwise paste the two concatenated.
        void Share.share({ message: payload.url, title: payload.title }).catch(() =>
          useToastStore.getState().showToast(COMMUNITY_BOARD_COPY.shareFailed, 'error')
        );
      },
    });
    return items;
  }, [shareTarget, targetOf, communitySlug, groupId, displayName]);

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
        appAlert('Mute failed', 'Could not mute notifications for this board.');
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
      appAlert('Unmute failed', 'Could not unmute notifications for this board.');
    } finally {
      setMuteBusy(false);
    }
  }, [groupId, muteBusy]);

  const showAbout = useCallback(() => {
    appAlert(
      displayName,
      [
        group?.description?.trim() || null,
        memberCountLabel(memberCount),
        communityName ? COMMUNITY_COPY.inCommunity(communityName) : null,
      ]
        .filter(Boolean)
        .join('\n')
    );
  }, [displayName, group?.description, memberCount, communityName]);

  const confirmLeave = useCallback(() => {
    if (!user?.id) return;
    appAlert(COMMUNITY_BOARD_COPY.leaveBoard, `Leave ${displayName}?`, [
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
              appAlert(
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
        icon: 'search',
        onPress: () => setSearchOpen(true),
      },
      // Second row, both platforms, same words (§3.4). Hidden when the
      // migration is not applied: an entry that opens a screen which can only
      // say "not available yet" is worse than no entry.
      ...(bookmarksSupported
        ? [
            {
              label: COMMUNITY_BOARD_COPY.savedPosts,
              icon: 'bookmark' as const,
              onPress: () => navigation.navigate('SavedPosts'),
            },
          ]
        : []),
      {
        label: chatMuted
          ? formatMuteUntilLabel(chatMutedUntil)
            ? `Unmute (until ${formatMuteUntilLabel(chatMutedUntil)})`
            : 'Unmute notifications'
          : COMMUNITY_BOARD_COPY.muteBoard,
        icon: chatMuted ? 'notifications' : 'notifications-off',
        disabled: muteBusy,
        onPress: () => {
          if (chatMuted) void clearMute();
          else setMuteMenuOpen(true);
        },
      },
      {
        label: COMMUNITY_COPY.startStudyGroup,
        icon: 'people',
        onPress: () => startStudyGroup(),
      },
      { label: COMMUNITY_BOARD_COPY.aboutBoard, icon: 'information-circle', onPress: showAbout },
      {
        label: COMMUNITY_BOARD_COPY.reportBoard,
        icon: 'flag',
        onPress: () => setReportTarget({ type: 'group', id: groupId, label: displayName }),
      },
      {
        label: COMMUNITY_BOARD_COPY.leaveBoard,
        icon: 'exit',
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
      bookmarksSupported,
      navigation,
    ]
  );

  /**
   * The moderator's soft removal. The card STAYS, as a tombstone carrying the
   * reason — a reader who already saw the post is told what happened instead
   * of watching it vanish — so the local row is patched rather than dropped.
   *
   * The reason is optional: demanding one would make the fastest possible
   * takedown the slowest, and the shared cap
   * (`COMMUNITY_MUTE_REASON_MAX`-style trimming) is applied server-side.
   */
  const confirmRemovePost = useCallback(async () => {
    const target = removeTarget;
    if (!target || !communityId || removeBusy) return;
    setRemoveBusy(true);
    try {
      const reason = removeReason.trim();
      const result = await removeCommunityPost(communityId, target.id, {
        ...(reason ? { reason } : {}),
      });
      patchMessageInState(target.id, {
        removedAt: result.removedAt,
        isRemoved: true,
        text: '',
        ...(reason ? { removedReason: reason } : {}),
      });
      if (pinnedPost?.id === target.id) clearPinned(groupId);
      setRemoveTarget(null);
      setRemoveReason('');
    } catch (error) {
      useToastStore
        .getState()
        .showToast(
          error instanceof Error && error.message ? error.message : 'Could not remove that post',
          'error'
        );
    } finally {
      setRemoveBusy(false);
    }
  }, [
    removeTarget,
    communityId,
    removeBusy,
    removeReason,
    patchMessageInState,
    pinnedPost?.id,
    clearPinned,
    groupId,
  ]);

  const postMenuItems: ActionSheetItem[] = useMemo(() => {
    const target = postMenuTarget;
    if (!target) return [];
    const { body } = splitBoardBody(target.text);
    const items: ActionSheetItem[] = [];
    // `Copy text` has MOVED to the share sheet (§8.1 row 2) so the overflow
    // does not carry two ways to copy the same words. Edit/Delete/Pin still
    // act on the row itself; Report acts on the ORIGINAL when this is a
    // repost, so one report covers every copy.
    const reportTargetId = boardActionTargetId(target);
    // `Save for me` LEAVES the overflow in the same release Bookmark enters
    // the action row — one save, not two that cannot read each other. It
    // survives only while the server cannot back a bookmark, so a student on
    // a database without the migration is not left with no way to keep a post.
    if (!bookmarksSupported) {
      const starred = starredIds.has(target.id);
      items.push({
        label: starred ? COMMUNITY_BOARD_COPY.saved : COMMUNITY_BOARD_COPY.saveForMe,
        icon: 'star',
        iconFilled: starred,
        hint: 'Only on this device',
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
    }
    // Every permission below comes from `boardPostRules` — the same helper the
    // API decides with. Reporting your own post is refused there (it only ever
    // costs a moderator a queue item), as is anything on a removed post.
    const rules = actionsFor(target);
    if (rules.canReport) {
      items.push({
        label: COMMUNITY_BOARD_COPY.reportPost,
        icon: 'flag',
        onPress: () =>
          setReportTarget({
            type: 'message',
            id: reportTargetId,
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
        icon: 'create',
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
        icon: 'trash',
        destructive: true,
        onPress: () => {
          appAlert(COMMUNITY_BOARD_COPY.deletePost, 'This cannot be undone.', [
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
    // `canPin` and `canUnpin` are never both true, so this is one row whose
    // WORD comes from the rules rather than from what the board happens to
    // hold. A pin also has to reflect the post's own `pinned_at`, not only
    // "is this the board's one pinned post".
    if (rules.canPin || rules.canUnpin) {
      const isPinned = rules.canUnpin || pinnedPost?.id === target.id;
      items.push({
        label: isPinned ? COMMUNITY_BOARD_COPY.unpin : COMMUNITY_BOARD_COPY.pin,
        icon: 'pin',
        disabled: pinBusy,
        onPress: () => void setPin(groupId, target.id, !isPinned),
      });
    }
    // Un-accept an answered question. Only shown when the shared rule allows
    // it AND a reply is actually accepted — clearing nothing changes nothing,
    // and a row that changes nothing is the dead feature we do not ship.
    // Accepting a reply is not here: that points at ONE reply, which the board
    // never shows, so it lives on the reply's long-press in the thread.
    if (rules.canMarkAnswered && rules.isAnswered) {
      items.push({
        label: CLEAR_ANSWER_LABEL,
        icon: 'checkmark-circle',
        iconFilled: true,
        onPress: () => void handleSetAnswer(target.id, null),
      });
    }
    /**
     * A MODERATOR taking down someone else's post: a soft removal that carries
     * a reason (`DELETE /communities/:id/posts/:postId`). The author's own
     * Delete above stays on the message endpoint — one is moderation, with an
     * audit trail and a tombstone the reader can understand; the other is a
     * person changing their mind.
     */
    if (rules.canModerateRemove && communityId) {
      items.push({
        label: REMOVE_POST_LABEL,
        icon: 'trash',
        destructive: true,
        onPress: () => {
          setRemoveReason('');
          setRemoveTarget(target);
        },
      });
    }
    items.push({
      label: COMMUNITY_BOARD_COPY.openStudyGroup,
      icon: 'school',
      onPress: () => startStudyGroup(target),
    });
    return items;
  }, [
    postMenuTarget,
    starredIds,
    user?.id,
    groupId,
    actionsFor,
    communityId,
    pinnedPost?.id,
    pinBusy,
    setPin,
    clearPinned,
    removeGroupMessage,
    startStudyGroup,
    bookmarksSupported,
    handleSetAnswer,
  ]);

  // ----------------------------------------------------------------- render

  const openComments = useCallback(
    (post: Message) => {
      navigation.navigate('CommunityPost', {
        // A comment never attaches to a repost row: opening the comments of a
        // repost card opens the ORIGINAL's thread (§6.5).
        rootId: boardActionTargetId(post),
        groupId,
        communitySlug,
        communityName: communityName ?? undefined,
        // So the post screen's share sheet can fall back to `Post in # {board}`
        // for a post with no title, exactly as the list does.
        boardName: displayName,
      });
    },
    [navigation, groupId, communitySlug, communityName, displayName]
  );

  /**
   * The board's own answer to "who is this?", by author id. A removed post is
   * re-delivered without the profile join every live card resolved from, so
   * the tombstone used to draw whatever identity its payload happened to
   * carry. This is the source the rest of the board agrees on — see
   * `components/board/boardAuthorIdentity.ts`.
   */
  const authorsById = useMemo(() => {
    const map = new Map<string, { name?: string | null; avatarUrl?: string | null }>();
    for (const member of group?.members ?? []) {
      const id = member.userId || member.id;
      if (id) map.set(id, { name: member.name, avatarUrl: member.avatarUrl });
    }
    return map;
  }, [group?.members]);

  const renderPost = useCallback(
    ({ item }: { item: Message }) => {
      // Favorite / Comment / Bookmark on a REPOST card read the ORIGINAL's
      // state, so the two cards for one post never show different numbers.
      const actionId = boardActionTargetId(item);
      return (
        <BoardPostCard
          post={item}
          now={Date.now()}
          isOwn={item.senderId === user?.id}
          viewerId={user?.id ?? ''}
          authorIsAdmin={!!group?.adminIds?.includes(item.senderId)}
          favorited={isBoardFavorited(myReactions[actionId])}
          bookmarked={bookmarkedSet.has(actionId)}
          bookmarksSupported={bookmarksSupported}
          lowDataMode={lowDataMode}
          highlighted={highlightId === item.id}
          knownAuthor={authorsById.get(item.senderId) ?? null}
          onOpenComments={() => openComments(item)}
          onToggleFavorite={() => toggleFavorite(item)}
          onRepost={() => openRepost(item)}
          onToggleBookmark={() => void toggleBookmark(item)}
          onShare={() => setShareTarget(item)}
          onOverflow={() => setPostMenuTarget(item)}
          onRetry={
            item.deliveryState === 'failed' && user?.id
              ? () => void retryFailedMessage(groupId, item.id, user.id).catch(() => undefined)
              : undefined
          }
          onStartStudyGroup={() => startStudyGroup(item)}
        />
      );
    },
    [
      user?.id,
      group?.adminIds,
      myReactions,
      bookmarkedSet,
      bookmarksSupported,
      lowDataMode,
      highlightId,
      authorsById,
      openComments,
      toggleFavorite,
      openRepost,
      toggleBookmark,
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
          <Text className="text-xs text-lantern-primary-text" numberOfLines={1}>
            {/* `${n} members` read "1 members" on a one-person board while
                the Communities list one screen back said "1 member". */}
            {[communityName, memberCount > 0 ? memberCountLabel(memberCount) : null]
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
          <AppIcon name="ellipsis-vertical" size={20} color="#64748b" />
        </Pressable>
      </View>

      {searchOpen ? (
        <View className="flex-row items-center gap-2 border-b border-lantern-border bg-lantern-surface px-3 py-2">
          <AppIcon name="search" size={16} color="#94a3b8" />
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
            <AppIcon name="close" size={18} color="#94a3b8" />
          </Pressable>
        </View>
      ) : null}

      {pinnedPost ? (
        <PinnedBanner
          post={pinnedPost}
          canUnpin={actionsFor(pinnedPost).canUnpin || actionsFor(pinnedPost).canPin}
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
          className="mx-auto mt-2 min-h-[44px] justify-center rounded-full bg-lantern-primary-fill px-4"
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
                  <Text className="text-center text-sm font-semibold text-lantern-primary-text">
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
                  <Text className="text-sm font-semibold text-lantern-primary-text">
                    {COMMUNITY_BOARD_COPY.loadOlder}
                  </Text>
                )}
              </Pressable>
            ) : null
          }
        />

        <BoardComposer
          groupId={groupId}
          // The composer wore a different face from the post it was about to
          // make: it read auth metadata only and fell back to the literal
          // "You", which the avatar drew as a "YO" chip above the same
          // student's real photo. Both now come from `useProfileIdentity`.
          avatarUrl={identity.avatarUrl}
          authorName={identity.displayName}
          text={text}
          onChangeText={setText}
          subject={subject}
          onChangeSubject={setSubject}
          sending={sending}
          lowDataMode={lowDataMode}
          mentionCandidates={mentionCandidates}
          onPost={submitPost}
          onAttachImage={attachImage}
          attachedImageUrl={attachedImageUrl}
          attachingImage={attachingImage}
          onRemoveAttachedImage={() => setAttachedImageUrl(null)}
          onSendAudioMarkdown={sendMediaMarkdown}
          editing={editing}
          onCancelEdit={() => {
            setEditing(null);
            setText('');
            setAttachedImageUrl(null);
          }}
          postKind={selectedKind}
          postKinds={composer.kinds}
          onChangePostKind={setPostKind}
        />
        {/* A refusal is SAID, never left as a composer that silently does
            nothing: a muted member reads the whole board and is told a
            moderator can lift it. */}
        {/* Only once the group has actually loaded: `group` is undefined for a
            moment on a cold open, and telling a member "Join this community to
            post" while their own membership is still being fetched is worse
            than saying nothing. */}
        {group && composer.refusal ? (
          <Text
            accessibilityLiveRegion="polite"
            className="px-4 pb-2 text-caption text-lantern-text-secondary"
          >
            {composer.refusal}
          </Text>
        ) : null}
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
          icon: 'notifications-off' as const,
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

      <ActionSheet
        visible={!!shareTarget}
        title={COMMUNITY_BOARD_COPY.share}
        items={shareItems.map((item) => ({
          ...item,
          onPress: () => {
            setShareTarget(null);
            item.onPress();
          },
        }))}
        onClose={() => setShareTarget(null)}
      />

      <BoardRepostSheet
        visible={!!repostTarget}
        authorName={repostTarget?.senderName ?? ''}
        subject={repostTarget?.subject ?? null}
        body={repostTarget?.text ?? ''}
        reposted={!!repostTarget?.repostedByMe}
        busy={repostBusy}
        onRepost={(quote) => void confirmRepost(quote)}
        onUndo={() => void confirmUndoRepost()}
        onClose={() => setRepostTarget(null)}
      />

      {/* Removal carries a REASON, so it cannot be an Alert: `Alert.prompt`
          is iOS-only and this app's students are on Android. */}
      <Modal
        visible={!!removeTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setRemoveTarget(null)}
      >
        <Pressable
          onPress={() => setRemoveTarget(null)}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          className="flex-1 bg-black/40"
        />
        <View className="absolute inset-x-4 top-1/3 rounded-2xl bg-lantern-surface p-4">
          <Text className="text-heading font-semibold text-lantern-text">{REMOVE_POST_LABEL}</Text>
          <Text className="mt-1 text-caption text-lantern-text-secondary">
            {COMMUNITY_MODERATION_COPY.removedByModerator}
          </Text>
          <TextInput
            value={removeReason}
            onChangeText={setRemoveReason}
            placeholder={COMMUNITY_MODERATION_COPY.removeReasonPlaceholder}
            placeholderTextColor="#94a3b8"
            multiline
            accessibilityLabel={COMMUNITY_MODERATION_COPY.removeReasonPlaceholder}
            className="mt-3 min-h-[64px] rounded-xl border border-lantern-border px-3 py-2 text-body text-lantern-text"
          />
          <View className="mt-3 flex-row justify-end gap-2">
            <Pressable
              onPress={() => setRemoveTarget(null)}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              className="min-h-[44px] justify-center px-4"
            >
              <Text className="text-body font-semibold text-lantern-text-secondary">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => void confirmRemovePost()}
              disabled={removeBusy}
              accessibilityRole="button"
              accessibilityLabel={REMOVE_POST_LABEL}
              accessibilityState={{ disabled: removeBusy, busy: removeBusy }}
              className="min-h-[44px] justify-center rounded-xl bg-lantern-error px-4"
              style={{ opacity: removeBusy ? 0.6 : 1 }}
            >
              <Text className="text-body font-semibold text-white">
                {removeBusy ? COMMUNITY_BOARD_COPY.posting : REMOVE_POST_LABEL}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

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
