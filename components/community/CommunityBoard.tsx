import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  BellAlertIcon,
  BellSlashIcon,
  BookmarkIcon,
  EllipsisHorizontalIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BOARD_FAVORITE_EMOJI,
  BOARD_NEW_POST_HIGHLIGHT_MS,
  COMMUNITY_BOARD_COPY,
  COMMUNITY_COPY,
  boardDisplayName,
  boardFavoriteCount,
  boardPageSize,
  boardPostDeepLinkPath,
  boardRepostRefusalCopy,
  boardSharePayload,
  canPinOnBoard,
  canRepostBoardPost,
  pinnedPostAccessibilityLabel,
  studyGroupNameFromPost,
  type BoardBookmarkEntry,
  type BoardPost,
  type CommunityRole,
} from '@lantern/shared/network';
import { memberCountLabel } from '@lantern/shared/network';
import {
  CHAT_MUTE_DURATIONS,
  formatMuteUntilLabel,
  type ChatMuteDurationId,
} from '@lantern/shared';
import {
  addMessageReaction,
  createBoardRepost,
  fetchBoardPosts,
  fetchGroupBookmarks,
  fetchGroupThread,
  fetchPinnedMessage,
  fetchUserReactionsForGroup,
  getGroupMuteStatus,
  importMessageBookmarks,
  leaveGroup,
  muteGroupChat,
  removeMessageReaction,
  removeGroupMessage,
  editGroupMessage,
  sendMessage,
  setMessageBookmark,
  setMessagePin,
  supabase,
  undoBoardRepost,
  unmuteGroupChat,
} from '../../services/supabase';
import { mergeBoardPosts, mergeRealtimeBoardPost, toBoardPost } from '../../utils/boardPosts';
import {
  bookmarkImportPayload,
  clearSavedPosts,
  hasImportedBookmarks,
  markBookmarksImported,
  readSavedPosts,
  writeSavedPosts,
} from '../../utils/boardBookmarks';
import { parseAppRoute } from '../../utils/appRoutes';
import { confirmDialog } from '../../stores/confirmStore';
import { useAuthStore } from '../../stores/authStore';
import { useCommunityStore } from '../../stores/communityStore';
import { useGroupStore } from '../../stores/groupStore';
import { useToastStore } from '../../stores/toastStore';
import { useUIStore } from '../../stores/uiStore';
import ReportContentModal from '../moderation/ReportContentModal';
import type { SendMessageOptions } from '../MessageInputBar';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuSubmenu, MenuTrigger, Modal } from '../ui';
import BoardComposer from './BoardComposer';
import BoardPostCard, { boardPostText } from './BoardPostCard';
import BoardPostPanel from './BoardPostPanel';
import LegacyQuestionCard from './LegacyQuestionCard';
import RepostComposer from './RepostComposer';
import SavedPostsPanel from './SavedPostsPanel';

/** A post this viewer has sent that the server has not confirmed yet. */
interface PendingBoardPost {
  post: BoardPost;
  /** The raw body, kept so a retry re-sends exactly what was typed. */
  text: string;
  replyToMessageId?: string;
  mentionedUserIds?: string[];
  failed: boolean;
}

export interface CommunityBoardProps {
  groupId: string;
  communityId: string;
  communitySlug: string;
  communityName: string;
  viewerRole: CommunityRole | null;
  onBack: () => void;
  /** The community home, scrolled to its roster. */
  onOpenMembers: () => void;
  /**
   * "Start a study group" — from the header, a post, or the study nudge (§7).
   * `fromPost` marks entry point 3, the only one that leaves a pointer post on
   * the board. It is an explicit flag, not `!!prefillName`, because a
   * photo-only post yields an empty prefill.
   */
  onStartStudyGroup: (prefillName?: string, fromPost?: boolean) => void;
}

/**
 * A community board (spec §5.1) — the web half of the surface that replaces a
 * community channel's chat. Deliberately NOT `ChatWindow`: eight props instead
 * of forty, and none of `dmThreads`, `onOpenNewDmModal`, `onCreateGroup`,
 * `onDeleteDmThread`, `onArchiveDmThread` or `onSelectChat`. Everything the
 * board removes — study mode, tests, questions, votes, challenges, sub-groups,
 * typing indicators, read receipts — is simply never mounted here, which is
 * what stops the `lg` / below-`lg` split leaving study buttons alive on desktop
 * (§8 parity rule 8).
 */
export const CommunityBoard: React.FC<CommunityBoardProps> = ({
  groupId,
  communityId,
  communitySlug,
  communityName,
  viewerRole,
  onBack,
  onOpenMembers,
  onStartStudyGroup,
}) => {
  const currentUser = useAuthStore((s) => s.currentUser);
  const lowDataMode = useUIStore((s) => s.lowDataMode);
  const groups = useGroupStore((s) => s.groups);
  const showToast = useToastStore((s) => s.showToast);
  const invalidateCommunity = useCommunityStore((s) => s.invalidate);
  const payload = useCommunityStore((s) => s.channelsById[communityId]);

  const group = useMemo(() => groups.find((g) => g.id === groupId), [groups, groupId]);
  const board = useMemo(
    () => (payload?.boards ?? payload?.channels ?? []).find((b) => b.id === groupId) ?? null,
    [payload, groupId]
  );

  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [pinned, setPinned] = useState<BoardPost | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [myReactions, setMyReactions] = useState<Record<string, string[]>>({});
  const [newPostIds, setNewPostIds] = useState<string[]>([]);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<
    { type: 'message' | 'group'; id: string; label: string } | null
  >(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [aboutOpen, setAboutOpen] = useState(false);
  /** The device-local save. Only reachable while `message_bookmarks` is absent. */
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());
  /** Account-level bookmarks on this board. */
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(() => new Set());
  /**
   * Whether `message_bookmarks` exists yet. The founder applies migrations by
   * hand, after the deploy, so the board has to render correctly on a database
   * that has not had this one: Bookmark and "Saved posts" are hidden and the
   * device-local save stays in the overflow, with no 500 and no 503 anywhere
   * the student can see.
   */
  const [bookmarksAvailable, setBookmarksAvailable] = useState(false);
  const [savedPanelOpen, setSavedPanelOpen] = useState(false);
  const [repostTarget, setRepostTarget] = useState<BoardPost | null>(null);
  const [repostBusy, setRepostBusy] = useState(false);
  /** A post opened by link that is not on any loaded page (see `openedPost`). */
  const [linkedPost, setLinkedPost] = useState<BoardPost | null>(null);
  const [muted, setMuted] = useState(false);
  const [mutedUntil, setMutedUntil] = useState<string | null>(null);
  const [muteBusy, setMuteBusy] = useState(false);
  const [muteDurationsOpen, setMuteDurationsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /**
   * Posts this viewer has sent that the server has not confirmed yet. Without
   * them a post on a patchy connection showed nothing at all until the round
   * trip finished, and a failure lost the typed text with only a toast — on a
   * product whose users are on exactly those connections. Session-scoped: this
   * is optimistic rendering plus an in-place retry, not an offline outbox.
   */
  const [pendingPosts, setPendingPosts] = useState<PendingBoardPost[]>([]);

  const listTopRef = useRef<HTMLDivElement>(null);
  const commentsOpenerRef = useRef<HTMLElement | null>(null);
  const savedOpenerRef = useRef<HTMLElement | null>(null);
  /** Did THIS board push the open-post URL, or did the reader arrive on it? */
  const pushedOpenPostRef = useRef(false);
  const repostOpenerRef = useRef<HTMLElement | null>(null);
  const pageSize = boardPageSize(lowDataMode);
  const userId = currentUser?.id ?? '';

  /**
   * The open post is read from the URL, not from state.
   *
   * That makes `/discover/c/:slug/ch/:groupId/p/:postId` — the link Share
   * mints and mobile already routes — open that exact post, and it makes the
   * browser Back button close the panel instead of leaving the board. One
   * source of truth, so the two cannot disagree.
   */
  const location = useLocation();
  const navigate = useNavigate();
  const openPostId = parseAppRoute(location.pathname).params.postId ?? null;
  const boardPath = boardPostDeepLinkPath(communitySlug, groupId);
  const openPostPath = useCallback(
    (postId: string) => boardPostDeepLinkPath(communitySlug, groupId, postId),
    [communitySlug, groupId]
  );

  useEffect(() => {
    if (userId) setSavedIds(readSavedPosts(userId));
  }, [userId]);

  /**
   * The viewer's saved ids on this board, so a bookmark icon renders filled on
   * first paint rather than after the first interaction. The same request
   * answers "does `message_bookmarks` exist yet" — `serverBacked: false` is
   * what hides the control everywhere.
   */
  useEffect(() => {
    let cancelled = false;
    void fetchGroupBookmarks(groupId).then((result) => {
      if (cancelled) return;
      setBookmarksAvailable(result.serverBacked);
      setBookmarkedIds(new Set(result.messageIds));
    });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  /**
   * The one-time hand-over of this device's local saves.
   *
   * Runs only once a `serverBacked: true` response has been seen, and deletes
   * the local key ONLY on a 2xx: on a 503 the saves stay exactly where they
   * are and the next launch tries again. The server upserts, so re-running it
   * is harmless — which is what makes "keep the key until it lands" safe.
   */
  useEffect(() => {
    if (!userId || !bookmarksAvailable) return;
    if (hasImportedBookmarks(userId)) return;
    const local = readSavedPosts(userId);
    if (local.size === 0) {
      markBookmarksImported(userId);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await importMessageBookmarks(bookmarkImportPayload(local));
        if (cancelled || !result.serverBacked) return;
        markBookmarksImported(userId);
        clearSavedPosts(userId);
        setSavedIds(new Set());
        const refreshed = await fetchGroupBookmarks(groupId);
        if (cancelled) return;
        setBookmarkedIds(new Set(refreshed.messageIds));
      } catch {
        // Keep the local key and try again next launch.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, bookmarksAvailable, groupId]);

  /**
   * Resolve a post named in the URL but absent from every loaded page.
   *
   * `fetchGroupThread` returns the root alongside its comments and 404s for a
   * non-member, so this is the same members-only guard every other board call
   * relies on: a link is an address, never a preview.
   */
  useEffect(() => {
    if (!openPostId) {
      setLinkedPost(null);
      // Browser Back can close the post without going through `closeOpenPost`,
      // so the "we pushed this" flag is cleared wherever the post ends up shut.
      pushedOpenPostRef.current = false;
      return undefined;
    }
    if (posts.some((post) => post.id === openPostId)) return undefined;
    if (linkedPost?.id === openPostId) return undefined;
    let cancelled = false;
    void fetchGroupThread(groupId, openPostId)
      .then((rows: any[]) => {
        if (cancelled) return;
        const root = (Array.isArray(rows) ? rows : []).find(
          (row: any) => String(row?.id) === openPostId
        );
        setLinkedPost(root ? toBoardPost(root, groupId) : null);
      })
      .catch(() => {
        if (!cancelled) setLinkedPost(null);
      });
    return () => {
      cancelled = true;
    };
  }, [openPostId, groupId, posts, linkedPost?.id]);

  const loadPage = useCallback(
    async (nextPage: number, replace: boolean) => {
      const rows = await fetchBoardPosts(groupId, { page: nextPage, limit: pageSize });
      const mapped = (Array.isArray(rows) ? rows : []).map((row: any) => toBoardPost(row, groupId));
      setHasMore(mapped.length >= pageSize);
      setPosts((prev) => (replace ? mergeBoardPosts([], mapped) : mergeBoardPosts(prev, mapped)));
      setPage(nextPage);
    },
    [groupId, pageSize]
  );

  // First page + the pin. The pin is its own request because it can be older
  // than any loaded page; it resolves to null pre-migration rather than 500.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPosts([]);
    setNewPostIds([]);
    setError(null);
    (async () => {
      try {
        await loadPage(1, true);
        if (cancelled) return;
        const pinnedRow = await fetchPinnedMessage(groupId);
        if (cancelled) return;
        setPinned(pinnedRow ? toBoardPost(pinnedRow, groupId) : null);
      } catch (err) {
        if (cancelled) return;
        // A 404 here is the members-only guard, not a broken screen: a shared
        // link opened by someone who is not in this board must say so in the
        // shared words, and must not leak a title, an author or a count.
        const status = (err as { status?: number } | null)?.status;
        setError(
          status === 404
            ? COMMUNITY_BOARD_COPY.notAMemberUnknown
            : err instanceof Error
              ? err.message
              : 'Could not load this board'
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId, loadPage]);

  // The viewer's own reaction chips ("mine"), so a chip renders pressed.
  useEffect(() => {
    let cancelled = false;
    void fetchUserReactionsForGroup(groupId).then((map) => {
      if (!cancelled) setMyReactions(map || {});
    });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  useEffect(() => {
    let cancelled = false;
    void getGroupMuteStatus(groupId)
      .then((status) => {
        if (cancelled) return;
        setMuted(!!status?.muted);
        setMutedUntil(status?.mutedUntil ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setMuted(false);
        setMutedUntil(null);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  // Realtime: a new root post raises the `N new posts` pill — it NEVER
  // auto-scrolls (§4.1). Updates (reactions, edits, removals, pins) patch in
  // place. Off in low-data mode, like every other subscription (§10).
  useEffect(() => {
    if (lowDataMode || !groupId) return undefined;
    const channel = supabase
      .channel(`board:${groupId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_id=eq.${groupId}` },
        (payloadRow) => {
          const row = payloadRow.new as Record<string, any>;
          if (row.thread_root_id) return;
          if (row.sender_id === userId) return;
          setNewPostIds((prev) => (prev.includes(row.id) ? prev : [...prev, String(row.id)]));
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `group_id=eq.${groupId}` },
        (payloadRow) => {
          const row = payloadRow.new as Record<string, any>;
          if (row.thread_root_id) return;
          const mapped = toBoardPost(row, groupId);
          // A realtime row is the raw `messages` record: it carries `reactions`
          // (REPLICA IDENTITY FULL) but none of the hydration the API adds, so
          // a plain spread would un-bookmark a saved post and blank a repost's
          // embed the moment anyone reacted to it.
          setPosts((prev) =>
            prev.some((post) => post.id === mapped.id)
              ? prev.map((post) =>
                  post.id === mapped.id ? mergeRealtimeBoardPost(post, mapped) : post
                )
              : prev
          );
          setPinned((prev) =>
            prev && prev.id === mapped.id ? mergeRealtimeBoardPost(prev, mapped) : prev
          );
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId, lowDataMode, userId]);

  const mentionCandidates = useMemo(() => {
    const members = (group?.members ?? [])
      .filter((m) => m.id !== userId && m.username)
      .map((m) => ({ id: m.id, username: m.username!, name: m.name }));
    if (group?.adminIds?.includes(userId)) {
      return [{ id: '__all__', username: 'all', name: 'Everyone in this board' }, ...members];
    }
    return members;
  }, [group, userId]);

  const canPin = canPinOnBoard({
    role: viewerRole,
    adminIds: group?.adminIds ?? [],
    userId,
  });

  const memberCount = board?.memberCount ?? group?.members?.length ?? 0;
  const title = board
    ? boardDisplayName(board)
    : boardDisplayName({ isLounge: false, name: group?.name || 'Board' });

  const showNewPosts = async () => {
    setNewPostIds([]);
    try {
      await loadPage(1, false);
      listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      showToast('Could not load the new posts', 'error');
    }
  };

  /** Deliver one pending post; the client id is stable so a retry cannot double-post. */
  const deliverPost = useCallback(
    async (entry: PendingBoardPost) => {
      setPendingPosts((prev) =>
        prev.map((item) => (item.post.id === entry.post.id ? { ...item, failed: false } : item))
      );
      try {
        const created = await sendMessage(groupId, userId, entry.text, entry.post.id, {
          replyToMessageId: entry.replyToMessageId,
          mentionedUserIds: entry.mentionedUserIds,
          subject: entry.post.subject,
          // The title, the body and the one photo go up as ONE row — a retry
          // re-sends the same photo rather than uploading it again.
          imageUrl: entry.post.imageUrl,
        });
        setPendingPosts((prev) => prev.filter((item) => item.post.id !== entry.post.id));
        await loadPage(1, false);
        const createdId = created?.id ? String(created.id) : null;
        if (createdId) {
          setHighlightId(createdId);
          window.setTimeout(() => setHighlightId(null), BOARD_NEW_POST_HIGHLIGHT_MS);
        }
        listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        // The card stays, now reading `Not sent · Retry`, so the text is never
        // lost and the retry is one click.
        setPendingPosts((prev) =>
          prev.map((item) => (item.post.id === entry.post.id ? { ...item, failed: true } : item))
        );
        showToast(err instanceof Error ? err.message : 'Could not post', 'error');
      }
    },
    [groupId, userId, loadPage, showToast]
  );

  const handlePost = async (
    text: string,
    options: SendMessageOptions & { subject: string | null }
  ) => {
    if (!userId) return;
    const clientMessageId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const entry: PendingBoardPost = {
      post: {
        id: clientMessageId,
        groupId,
        senderId: userId,
        senderName: currentUser?.name || 'You',
        senderAvatarUrl: currentUser?.avatarUrl ?? null,
        subject: options.subject,
        text,
        timestamp: new Date().toISOString(),
        editedAt: null,
        removedAt: null,
        replyCount: 0,
        reactions: {},
        pinnedAt: null,
        pinnedBy: null,
        isLegacyQuestion: false,
        legacyQuestionStem: null,
        // The photo IS known optimistically — it was uploaded while the
        // student was still typing, so the card can show it immediately.
        imageUrl: options.imageUrl ?? null,
        favoriteCount: 0,
        favorited: false,
        bookmarked: false,
        repostCount: 0,
        repostedByMe: false,
        repostOf: null,
      },
      text,
      replyToMessageId: options.replyToMessageId,
      mentionedUserIds: options.mentionedUserIds,
      failed: false,
    };
    setPendingPosts((prev) => [entry, ...prev]);
    listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    await deliverPost(entry);
  };

  const handleComment = async (text: string, options: SendMessageOptions) => {
    if (!userId) return;
    await sendMessage(groupId, userId, text, undefined, {
      replyToMessageId: options.replyToMessageId,
      mentionedUserIds: options.mentionedUserIds,
    });
  };

  const handleToggleReaction = async (
    postId: string,
    emoji: string,
    added: boolean
  ): Promise<Record<string, number> | null> => {
    setMyReactions((prev) => {
      const mine = new Set(prev[postId] || []);
      if (added) mine.add(emoji);
      else mine.delete(emoji);
      return { ...prev, [postId]: [...mine] };
    });
    try {
      const reactions = added
        ? await addMessageReaction(postId, emoji)
        : await removeMessageReaction(postId, emoji);
      setPosts((prev) =>
        prev.map((post) => (post.id === postId ? { ...post, reactions } : post))
      );
      setPinned((prev) => (prev && prev.id === postId ? { ...prev, reactions } : prev));
      // Returned rather than only stored: a COMMENT is not in `posts`, so the
      // panel patches its own row from this instead of refetching the thread
      // on every heart.
      return reactions;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update that reaction', 'error');
      return null;
    }
  };

  const handleTogglePin = async (post: BoardPost) => {
    const nextPinned = !post.pinnedAt;
    try {
      const updated = await setMessagePin(post.id, nextPinned);
      const mapped = updated ? toBoardPost(updated, groupId) : { ...post, pinnedAt: nextPinned ? new Date().toISOString() : null };
      setPinned(nextPinned ? mapped : null);
      setPosts((prev) =>
        prev.map((item) =>
          item.id === post.id
            ? { ...item, pinnedAt: mapped.pinnedAt, pinnedBy: mapped.pinnedBy }
            : { ...item, pinnedAt: nextPinned ? null : item.pinnedAt }
        )
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : COMMUNITY_BOARD_COPY.pinUnavailable,
        'error'
      );
    }
  };

  const handleEditPost = async (post: BoardPost, text: string) => {
    try {
      await editGroupMessage(post.id, text);
      setPosts((prev) =>
        prev.map((item) =>
          item.id === post.id ? { ...item, text, editedAt: new Date().toISOString() } : item
        )
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not edit that post', 'error');
    }
  };

  const handleDeletePost = async (post: BoardPost) => {
    const ok = await confirmDialog({
      title: 'Delete this post?',
      message: 'It will be removed for everyone in this board.',
      danger: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await removeGroupMessage(post.id);
      setPosts((prev) =>
        prev.map((item) =>
          item.id === post.id ? { ...item, removedAt: new Date().toISOString(), text: '' } : item
        )
      );
      if (pinned?.id === post.id) setPinned(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete that post', 'error');
    }
  };

  const handleToggleSave = (postId: string) => {
    if (!userId) return;
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      writeSavedPosts(userId, next);
      return next;
    });
  };

  /**
   * Save this post to the account, not to this browser.
   *
   * Optimistic, then reconciled: the icon fills immediately because that is
   * what makes the control feel like a bookmark, and a refusal puts it back
   * rather than leaving a lie on screen. A 503 means the migration is not
   * applied — the control disappears and the local save takes over again,
   * which is the same state the board booted in.
   */
  const handleToggleBookmark = async (postId: string, next: boolean) => {
    setBookmarkedIds((prev) => {
      const ids = new Set(prev);
      if (next) ids.add(postId);
      else ids.delete(postId);
      return ids;
    });
    try {
      const result = await setMessageBookmark(postId, next);
      if (!result.serverBacked) {
        setBookmarksAvailable(false);
        setBookmarkedIds(new Set());
        showToast(COMMUNITY_BOARD_COPY.bookmarksUnavailable, 'info');
        return;
      }
      setBookmarkedIds((prev) => {
        const ids = new Set(prev);
        if (result.bookmarked) ids.add(postId);
        else ids.delete(postId);
        return ids;
      });
    } catch (err) {
      setBookmarkedIds((prev) => {
        const ids = new Set(prev);
        if (next) ids.delete(postId);
        else ids.add(postId);
        return ids;
      });
      showToast(err instanceof Error ? err.message : 'Could not update that bookmark', 'error');
    }
  };

  /**
   * Repost, undo, or refuse — decided here so the refusal is the same typed
   * reason and the same words the server would answer with. The server
   * re-checks every rule, so calling the endpoint directly is refused too.
   */
  const handleRepostAction = (post: BoardPost) => {
    // `repostedByMe` is set on the ORIGINAL's row, never on the repost row —
    // the server asks "have I reposted this post", and nobody reposts a
    // repost. So the undo affordance on your own bump has to be recognised by
    // shape, or Undo would be reachable only from the original's card.
    if (post.repostedByMe || (post.repostOf && post.senderId === userId)) {
      void handleUndoRepost(post);
      return;
    }
    const verdict = canRepostBoardPost({ post, viewerId: userId });
    // `'reason' in verdict` rather than `!verdict.ok`: the root tsconfig runs
    // without strictNullChecks, where narrowing a boolean discriminant is not
    // reliable, and this file is compiled under both.
    if ('reason' in verdict) {
      showToast(boardRepostRefusalCopy(verdict.reason), 'info');
      return;
    }
    repostOpenerRef.current = document.activeElement as HTMLElement | null;
    setRepostTarget(post);
  };

  const submitRepost = async (post: BoardPost, quote: string) => {
    setRepostBusy(true);
    try {
      await createBoardRepost(post.id, quote);
      setRepostTarget(null);
      // The bump belongs at the top of the board, which is where page 1 is.
      await loadPage(1, false);
      listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : COMMUNITY_BOARD_COPY.repostUnavailable,
        'error'
      );
    } finally {
      setRepostBusy(false);
      repostOpenerRef.current?.focus?.();
    }
  };

  const handleUndoRepost = async (post: BoardPost) => {
    try {
      // The ORIGINAL's id, on both verbs: the client never has to hold the
      // repost row's id, and the server scopes the delete to the caller.
      await undoBoardRepost(post.repostOf ? post.repostOf.id : post.id);
      await loadPage(1, true);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : COMMUNITY_BOARD_COPY.repostUnavailable,
        'error'
      );
    }
  };

  /**
   * Share is a LINK and nothing else — never the body, never a snippet, never
   * a signed media URL, because a members-only object in a share payload has
   * left the board. `boardSharePayload` returns exactly `{ title, url }`.
   *
   * The one permitted platform asymmetry (§9.3 rule 7): a browser with
   * `navigator.share` opens the OS sheet, and one without copies the link and
   * says so. A dead "Share via…" row would be worse than either.
   */
  const handleShare = async (post: BoardPost) => {
    const payload = boardSharePayload(post, {
      slug: communitySlug,
      groupId,
      boardName: board?.name || group?.name || '',
    });
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share(payload);
        return;
      }
      await navigator.clipboard.writeText(payload.url);
      showToast(COMMUNITY_BOARD_COPY.linkCopied, 'success');
    } catch (err) {
      // Dismissing the OS sheet is not a failure.
      if (err instanceof Error && err.name === 'AbortError') return;
      showToast(COMMUNITY_BOARD_COPY.shareFailed, 'error');
    }
  };

  /** Open a post's comments, and put that post in the URL so Back closes it. */
  const openPost = (postId: string) => {
    commentsOpenerRef.current = document.activeElement as HTMLElement | null;
    pushedOpenPostRef.current = true;
    navigate(openPostPath(postId));
  };

  /**
   * Closing pops the entry opening the post pushed, so Back does not walk
   * straight back INTO the post you just closed. A reader who arrived on the
   * post URL directly — a shared link — pushed nothing, so their close
   * replaces instead: `navigate(-1)` there would leave the app entirely.
   */
  const closeOpenPost = () => {
    if (pushedOpenPostRef.current) {
      pushedOpenPostRef.current = false;
      navigate(-1);
    } else {
      navigate(boardPath, { replace: true });
    }
    commentsOpenerRef.current?.focus?.();
  };

  /**
   * One saved post, on whichever board it lives — bookmarks span boards, which
   * is why each entry carries its own community slug. The CURRENT slug is only
   * a fallback for a post on THIS board: pairing it with another board's group
   * id would build a link to a community that post is not in.
   */
  const handleOpenSavedPost = (entry: BoardBookmarkEntry) => {
    const slug = entry.communitySlug ?? (entry.groupId === groupId ? communitySlug : null);
    if (!slug) {
      showToast('Could not open that post', 'error');
      return;
    }
    setSavedPanelOpen(false);
    pushedOpenPostRef.current = true;
    navigate(boardPostDeepLinkPath(slug, entry.groupId, entry.post.id));
  };

  const handleCopyText = async (post: BoardPost) => {
    try {
      // The stripped body, not the raw row: copying `![image](https://…)` puts
      // a signed CDN URL on the clipboard. Mobile copies the same string.
      const body = boardPostText(post.text);
      await navigator.clipboard.writeText(body);
      showToast('Copied', 'success');
    } catch {
      showToast('Could not copy this post', 'error');
    }
  };

  const handleMuteFor = async (duration: ChatMuteDurationId) => {
    if (muteBusy) return;
    setMuteBusy(true);
    try {
      const status = await muteGroupChat(groupId, duration);
      if (!status?.muted) {
        showToast('Could not mute notifications.', 'error');
        return;
      }
      setMuted(true);
      setMutedUntil(status.mutedUntil);
    } finally {
      setMuteBusy(false);
    }
  };

  const handleUnmute = async () => {
    if (muteBusy) return;
    setMuteBusy(true);
    try {
      const status = await unmuteGroupChat(groupId);
      if (!status || status.muted) {
        showToast('Could not unmute notifications.', 'error');
        return;
      }
      setMuted(false);
      setMutedUntil(null);
    } finally {
      setMuteBusy(false);
    }
  };

  const handleLeaveBoard = async () => {
    const ok = await confirmDialog({
      title: 'Leave this board?',
      message: 'You stay in the community — you can rejoin the board from its page.',
      confirmLabel: 'Leave',
    });
    if (!ok) return;
    try {
      await leaveGroup(groupId);
      useGroupStore.getState().updateGroups((prev) => prev.filter((g) => g.id !== groupId));
      invalidateCommunity(communityId);
      onBack();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not leave this board', 'error');
    }
  };

  const loadOlder = async () => {
    if (loadingOlder) return;
    setLoadingOlder(true);
    try {
      await loadPage(page + 1, false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not load older posts', 'error');
    } finally {
      setLoadingOlder(false);
    }
  };

  const visiblePosts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return posts;
    return posts.filter(
      (post) =>
        (post.subject || '').toLowerCase().includes(term) ||
        (post.text || '').toLowerCase().includes(term)
    );
  }, [posts, search]);

  // An unconfirmed post is never hidden by a search: it is the viewer's own
  // work in flight, and losing sight of it is exactly the failure this fixes.
  const pendingCards = useMemo(
    () =>
      pendingPosts.map((entry) => (
        <BoardPostCard
          key={entry.post.id}
          post={entry.post}
          currentUserId={userId}
          canPin={false}
          lowDataMode={lowDataMode}
          saved={false}
          // An unconfirmed post has no server-side row to act on yet, so every
          // action on it is inert until the send resolves.
          bookmarked={false}
          bookmarksAvailable={false}
          favoriteCount={0}
          commentCount={0}
          sending={!entry.failed}
          failed={entry.failed}
          onRetry={() => void deliverPost(entry)}
          onToggleReaction={() => undefined}
          onOpenComments={() => undefined}
          onRepost={() => undefined}
          onToggleBookmark={() => undefined}
          onShare={() => undefined}
          onCopyText={() => void handleCopyText(entry.post)}
          onToggleSave={() => undefined}
          onReport={() => undefined}
          onEdit={() => undefined}
          onDelete={() =>
            setPendingPosts((prev) => prev.filter((item) => item.post.id !== entry.post.id))
          }
          onTogglePin={() => undefined}
          onStartStudyGroup={() => onStartStudyGroup(studyGroupNameFromPost(entry.post), false)}
        />
      )),
    [pendingPosts, userId, lowDataMode, deliverPost, onStartStudyGroup]
  );

  /**
   * On a repost card, Favorite, Comment, Bookmark and Report all act on the
   * ORIGINAL (§6.5): counts never fragment across copies, no comment ever
   * attaches to a repost row, and `content_reports` — which is
   * UNIQUE(reporter, target_type, target_id) — keeps one report covering every
   * copy instead of one per bump. Only Undo repost acts on the repost row.
   *
   * The original is usually loaded on the same page, in which case its live
   * counts are used. When it is not, the embed is all we have, so the counts
   * read zero and are hidden rather than invented.
   */
  const actionTargetFor = (post: BoardPost): BoardPost => {
    if (!post.repostOf) return post;
    return posts.find((candidate) => candidate.id === post.repostOf!.id) ?? {
      ...post,
      id: post.repostOf.id,
      senderName: post.repostOf.senderName,
      subject: post.repostOf.subject,
      text: post.repostOf.snippet,
      timestamp: post.repostOf.timestamp,
      removedAt: post.repostOf.removedAt,
      reactions: {},
      replyCount: 0,
      repostOf: null,
    };
  };

  /**
   * A shared link can name a post that is not on the first page — that is the
   * normal case for "this timetable from three weeks ago". `linkedPost` is the
   * row fetched for exactly that, so the link opens the post rather than the
   * board with nothing on it.
   */
  const openedPost = openPostId
    ? posts.find((post) => post.id === openPostId) ??
      (pinned && pinned.id === openPostId ? pinned : linkedPost)
    : null;
  const muteUntilLabel = formatMuteUntilLabel(mutedUntil);

  const renderPost = (post: BoardPost) => {
    if (post.isLegacyQuestion) {
      return (
        <LegacyQuestionCard
          key={post.id}
          post={post}
          lowDataMode={lowDataMode}
          onStartStudyGroup={() => onStartStudyGroup(studyGroupNameFromPost(post), true)}
        />
      );
    }
    const target = actionTargetFor(post);
    return (
      <BoardPostCard
        key={post.id}
        post={
          // Same reason as `handleRepostAction`: the row for my own bump does
          // not carry `repostedByMe`, so the icon would read "not reposted".
          post.repostOf && post.senderId === userId ? { ...post, repostedByMe: true } : post
        }
        currentUserId={userId}
        myReactions={myReactions[target.id]}
        canPin={canPin}
        lowDataMode={lowDataMode}
        highlighted={highlightId === post.id}
        saved={savedIds.has(post.id)}
        bookmarked={bookmarkedIds.has(target.id)}
        bookmarksAvailable={bookmarksAvailable}
        favoriteCount={boardFavoriteCount(target.reactions)}
        commentCount={target.replyCount}
        onToggleReaction={(emoji, added) => void handleToggleReaction(target.id, emoji, added)}
        onOpenComments={() => openPost(target.id)}
        onRepost={() => handleRepostAction(post)}
        onToggleBookmark={() =>
          void handleToggleBookmark(target.id, !bookmarkedIds.has(target.id))
        }
        onShare={() => void handleShare(target)}
        onCopyText={() => void handleCopyText(post)}
        onToggleSave={() => handleToggleSave(post.id)}
        onReport={() =>
          setReportTarget({ type: 'message', id: target.id, label: target.senderName })
        }
        onEdit={(text) => handleEditPost(post, text)}
        onDelete={() => void handleDeletePost(post)}
        onTogglePin={() => void handleTogglePin(post)}
        onStartStudyGroup={() => onStartStudyGroup(studyGroupNameFromPost(post), true)}
      />
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-lantern-background">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-lantern-border bg-lantern-surface px-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to community"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lantern text-lantern-text-secondary hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
        >
          <ArrowLeftIcon className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-lantern-text">{title}</h1>
          {/* The subtitle names the community in EVERY mode, low-data included (§10). */}
          <button
            type="button"
            onClick={onOpenMembers}
            className="truncate text-xs text-lantern-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
          >
            {COMMUNITY_BOARD_COPY.boardOf(communityName)} · {memberCountLabel(memberCount)}
          </button>
        </div>
        <Menu open={menuOpen} onOpenChange={setMenuOpen}>
          <MenuTrigger
            aria-label="Board options"
            title="Board options"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lantern text-lantern-text-secondary hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
          >
            <EllipsisHorizontalIcon className="h-5 w-5" aria-hidden="true" />
          </MenuTrigger>
          <MenuContent align="end" className="w-60">
            <MenuItem
              onSelect={() => setSearchOpen((open) => !open)}
              icon={<MagnifyingGlassIcon className="h-4 w-4 text-lantern-text-tertiary" aria-hidden="true" />}
            >
              {COMMUNITY_BOARD_COPY.searchBoard}
            </MenuItem>
            {/*
              Second row, on both platforms, in the same words. Hidden — not
              disabled — where `message_bookmarks` has not been applied, since
              nothing could be listed there. Deliberately NOT gated behind
              `canAccessDiscoverHub`: the board screen carries no such gate, so
              gating this would break it for exactly the pilot cohort that has
              bookmarks.
            */}
            {bookmarksAvailable ? (
              <MenuItem
                onSelect={() => {
                  savedOpenerRef.current = document.activeElement as HTMLElement | null;
                  setSavedPanelOpen(true);
                }}
                icon={<BookmarkIcon className="h-4 w-4 text-lantern-text-tertiary" aria-hidden="true" />}
              >
                {COMMUNITY_BOARD_COPY.savedPosts}
              </MenuItem>
            ) : null}
            {muted ? (
              <MenuItem
                onSelect={() => void handleUnmute()}
                disabled={muteBusy}
                icon={<BellAlertIcon className="h-4 w-4 text-lantern-text-tertiary" aria-hidden="true" />}
              >
                Unmute{muteUntilLabel ? ` (until ${muteUntilLabel})` : ''}
              </MenuItem>
            ) : (
              <MenuSubmenu
                label={COMMUNITY_BOARD_COPY.muteBoard}
                icon={<BellSlashIcon className="h-4 w-4 text-lantern-text-tertiary" aria-hidden="true" />}
                open={muteDurationsOpen}
                onOpenChange={setMuteDurationsOpen}
              >
                {CHAT_MUTE_DURATIONS.map((opt) => (
                  <MenuItem
                    key={opt.id}
                    onSelect={() => void handleMuteFor(opt.id)}
                    disabled={muteBusy}
                    className="pl-8"
                  >
                    {opt.label}
                  </MenuItem>
                ))}
              </MenuSubmenu>
            )}
            <MenuItem onSelect={() => onStartStudyGroup()}>
              {COMMUNITY_COPY.startStudyGroup}
            </MenuItem>
            <MenuItem onSelect={() => setAboutOpen(true)}>
              {COMMUNITY_BOARD_COPY.aboutBoard}
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              onSelect={() =>
                setReportTarget({ type: 'group', id: groupId, label: group?.name || title })
              }
            >
              {COMMUNITY_BOARD_COPY.reportBoard}
            </MenuItem>
            <MenuItem destructive onSelect={() => void handleLeaveBoard()}>
              {COMMUNITY_BOARD_COPY.leaveBoard}
            </MenuItem>
          </MenuContent>
        </Menu>
      </header>

      {searchOpen ? (
        <div className="shrink-0 border-b border-lantern-border bg-lantern-surface px-4 py-2">
          <label htmlFor="board-search" className="sr-only">
            {COMMUNITY_BOARD_COPY.searchBoard}
          </label>
          <input
            id="board-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={COMMUNITY_BOARD_COPY.searchBoard}
            className="w-full min-h-[44px] rounded-lantern border border-lantern-border bg-lantern-background px-3 text-sm text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
          />
        </div>
      ) : null}

      {pinned && !pinned.removedAt ? (
        <div className="sticky top-0 z-10 shrink-0 border-b border-lantern-border bg-lantern-background-secondary px-4 py-2">
          <div className="mx-auto flex max-w-2xl items-center gap-2">
            <span className="shrink-0 text-[10px] font-bold tracking-wide text-lantern-text-tertiary">
              {COMMUNITY_BOARD_COPY.pinnedLabel}
            </span>
            <p
              className="min-w-0 flex-1 truncate text-xs text-lantern-text-secondary"
              aria-label={pinnedPostAccessibilityLabel(pinned)}
            >
              <span className="font-semibold text-lantern-text">{pinned.senderName}</span>
              {' · '}
              {pinned.subject || pinned.text}
            </p>
            {canPin ? (
              <button
                type="button"
                onClick={() => void handleTogglePin(pinned)}
                className="min-h-[44px] shrink-0 px-2 text-xs font-semibold text-lantern-primary hover:underline"
              >
                {COMMUNITY_BOARD_COPY.unpin}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div ref={listTopRef} className="mx-auto max-w-2xl space-y-3">
          {newPostIds.length > 0 ? (
            <button
              type="button"
              role="status"
              onClick={() => void showNewPosts()}
              className="mx-auto block min-h-[44px] rounded-full bg-lantern-primary px-4 text-sm font-semibold text-white"
            >
              {COMMUNITY_BOARD_COPY.newPosts(newPostIds.length)}
            </button>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-lantern-error">
              {error}
            </p>
          ) : null}

          {pendingCards}

          {loading ? (
            <p role="status" className="text-sm text-lantern-text-secondary">
              Loading…
            </p>
          ) : visiblePosts.length === 0 && pendingCards.length === 0 ? (
            <div className="rounded-lantern-xl border border-dashed border-lantern-border p-6 text-center">
              <p className="text-sm text-lantern-text-secondary">
                {search.trim() ? 'No posts match that search.' : COMMUNITY_BOARD_COPY.emptyBoard}
              </p>
              {search.trim() ? null : (
                <button
                  type="button"
                  onClick={() => onStartStudyGroup()}
                  className="mt-3 min-h-[44px] rounded-lantern px-3 text-sm font-semibold text-lantern-primary hover:bg-lantern-primary-background"
                >
                  {COMMUNITY_BOARD_COPY.studyNudge}
                </button>
              )}
            </div>
          ) : (
            visiblePosts.map(renderPost)
          )}

          {!loading && hasMore && !search.trim() ? (
            <button
              type="button"
              onClick={() => void loadOlder()}
              disabled={loadingOlder}
              className="mx-auto block min-h-[44px] rounded-lantern border border-lantern-border px-4 text-sm font-medium text-lantern-text-secondary hover:bg-lantern-background-secondary disabled:opacity-60"
            >
              {loadingOlder ? 'Loading…' : COMMUNITY_BOARD_COPY.loadOlder}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl shrink-0">
        <BoardComposer
          groupId={groupId}
          authorName={currentUser?.name || 'You'}
          authorAvatarUrl={currentUser?.avatarUrl}
          lowDataMode={lowDataMode}
          mentionCandidates={mentionCandidates}
          onPost={handlePost}
        />
      </div>

      {openedPost ? (
        <BoardPostPanel
          groupId={groupId}
          post={openedPost}
          lowDataMode={lowDataMode}
          mentionCandidates={mentionCandidates}
          onClose={closeOpenPost}
          myReactions={myReactions}
          onToggleFavorite={(messageId, added) =>
            handleToggleReaction(messageId, BOARD_FAVORITE_EMOJI, added)
          }
          onSendComment={handleComment}
          onReplyCountChange={(postId, replyCount) =>
            setPosts((prev) =>
              prev.map((post) => (post.id === postId ? { ...post, replyCount } : post))
            )
          }
        />
      ) : null}

      {savedPanelOpen ? (
        <SavedPostsPanel
          onClose={() => {
            setSavedPanelOpen(false);
            savedOpenerRef.current?.focus?.();
          }}
          onOpenPost={handleOpenSavedPost}
        />
      ) : null}

      {repostTarget ? (
        <RepostComposer
          post={repostTarget}
          busy={repostBusy}
          onCancel={() => {
            setRepostTarget(null);
            repostOpenerRef.current?.focus?.();
          }}
          onSubmit={(quote) => void submitRepost(repostTarget, quote)}
        />
      ) : null}

      {aboutOpen ? (
        <Modal
          isOpen
          onClose={() => setAboutOpen(false)}
          ariaLabelledBy="board-about-title"
          maxWidthClass="max-w-md"
        >
          <h2 id="board-about-title" className="text-lg font-semibold text-lantern-text">
            {COMMUNITY_BOARD_COPY.aboutBoard}
          </h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-lantern-text-tertiary">Board</dt>
              <dd className="text-lantern-text">{title}</dd>
            </div>
            {group?.description ? (
              <div>
                <dt className="text-xs uppercase tracking-wide text-lantern-text-tertiary">Topic</dt>
                <dd className="text-lantern-text">{group.description}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs uppercase tracking-wide text-lantern-text-tertiary">
                Community
              </dt>
              <dd className="text-lantern-text">
                {communityName} · {memberCountLabel(memberCount)}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-lantern-text-tertiary">{COMMUNITY_COPY.listedIn(communityName)}</p>
        </Modal>
      ) : null}

      {reportTarget ? (
        <ReportContentModal
          isOpen
          onClose={() => setReportTarget(null)}
          targetType={reportTarget.type}
          targetId={reportTarget.id}
          targetLabel={reportTarget.label}
        />
      ) : null}
    </div>
  );
};

export default CommunityBoard;
