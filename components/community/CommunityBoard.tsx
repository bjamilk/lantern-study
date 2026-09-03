import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  BellAlertIcon,
  BellSlashIcon,
  EllipsisHorizontalIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import {
  BOARD_NEW_POST_HIGHLIGHT_MS,
  COMMUNITY_BOARD_COPY,
  COMMUNITY_COPY,
  boardDisplayName,
  boardPageSize,
  canPinOnBoard,
  pinnedPostAccessibilityLabel,
  studyGroupNameFromPost,
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
  fetchBoardPosts,
  fetchPinnedMessage,
  fetchUserReactionsForGroup,
  getGroupMuteStatus,
  leaveGroup,
  muteGroupChat,
  removeMessageReaction,
  removeGroupMessage,
  editGroupMessage,
  sendMessage,
  setMessagePin,
  supabase,
  unmuteGroupChat,
} from '../../services/supabase';
import { mergeBoardPosts, toBoardPost } from '../../utils/boardPosts';
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

const SAVED_POSTS_KEY = 'lantern:board:saved';

function readSavedPosts(userId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(`${SAVED_POSTS_KEY}:${userId}`);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeSavedPosts(userId: string, ids: Set<string>): void {
  try {
    window.localStorage.setItem(`${SAVED_POSTS_KEY}:${userId}`, JSON.stringify([...ids]));
  } catch {
    // A personal bookmark is best-effort; a full quota must not break posting.
  }
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
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<
    { type: 'message' | 'group'; id: string; label: string } | null
  >(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [aboutOpen, setAboutOpen] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());
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
  const pageSize = boardPageSize(lowDataMode);
  const userId = currentUser?.id ?? '';

  useEffect(() => {
    if (userId) setSavedIds(readSavedPosts(userId));
  }, [userId]);

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
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load this board');
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
          setPosts((prev) =>
            prev.some((post) => post.id === mapped.id)
              ? prev.map((post) => (post.id === mapped.id ? { ...post, ...mapped } : post))
              : prev
          );
          setPinned((prev) => (prev && prev.id === mapped.id ? { ...prev, ...mapped } : prev));
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

  const handleToggleReaction = async (postId: string, emoji: string, added: boolean) => {
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
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update that reaction', 'error');
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
          sending={!entry.failed}
          failed={entry.failed}
          onRetry={() => void deliverPost(entry)}
          onToggleReaction={() => undefined}
          onOpenComments={() => undefined}
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

  const openPost = openPostId ? posts.find((post) => post.id === openPostId) ?? null : null;
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
    return (
      <BoardPostCard
        key={post.id}
        post={post}
        currentUserId={userId}
        myReactions={myReactions[post.id]}
        canPin={canPin}
        lowDataMode={lowDataMode}
        highlighted={highlightId === post.id}
        saved={savedIds.has(post.id)}
        onToggleReaction={(emoji, added) => void handleToggleReaction(post.id, emoji, added)}
        onOpenComments={() => {
          commentsOpenerRef.current = document.activeElement as HTMLElement | null;
          setOpenPostId(post.id);
        }}
        onCopyText={() => void handleCopyText(post)}
        onToggleSave={() => handleToggleSave(post.id)}
        onReport={() =>
          setReportTarget({ type: 'message', id: post.id, label: post.senderName })
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

      {openPost ? (
        <BoardPostPanel
          groupId={groupId}
          post={openPost}
          lowDataMode={lowDataMode}
          mentionCandidates={mentionCandidates}
          onClose={() => {
            setOpenPostId(null);
            commentsOpenerRef.current?.focus?.();
          }}
          onSendComment={handleComment}
          onReplyCountChange={(postId, replyCount) =>
            setPosts((prev) =>
              prev.map((post) => (post.id === postId ? { ...post, replyCount } : post))
            )
          }
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
