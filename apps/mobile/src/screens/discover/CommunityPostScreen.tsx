import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import {
  COMMUNITY_BOARD_COPY,
  boardRelativeTime,
  boardRepostRefusalCopy,
  boardSharePayload,
  BOARD_FAVORITE_EMOJI,
  boardFavoriteAccessibilityLabel,
  boardFavoriteCount,
  canRepostBoardPost,
  isBoardFavorited,
} from '@lantern/shared/network';
import { applyReactionLocally } from '@lantern/shared/chat';
import { resolveAvatarSrc, normalizeStorageUrl } from '@lantern/shared/utils';
import * as api from '../../services/api';
import { useAuthStore } from '../../stores';
import { useBoardStore } from '../../stores/boardStore';
import { useGroupStore, type Message } from '../../stores/groupStore';
import { useToastStore } from '../../stores/toastStore';
import { useLowDataMode } from '../../hooks/useLowDataMode';
import { COMPOSER_KEYBOARD_BEHAVIOR } from '../../components/chat/composerKeyboardBehavior';
import { MentionText } from '../../components/chat/ChatMessageBody';
import { BoardActionRow } from '../../components/board/BoardActionRow';
import { BoardImage } from '../../components/board/BoardImage';
import { BoardQuotedPost } from '../../components/board/BoardQuotedPost';
import { BoardRepostSheet } from '../../components/board/BoardRepostSheet';
import { VoiceNotePlayer } from '../../components/chat/VoiceNotePlayer';
import { ResolvedAvatar } from '../../components/ResolvedAvatar';
import { BackButton } from '../../components/ui';
import { useTheme } from '../../theme';
import { ActionSheet, type ActionSheetItem } from '../../components/ui';
import {
  boardActionTargetId,
  isBoardRepost,
  mergeComments,
  selectPostComments,
  splitBoardBody,
  toBoardPost,
} from '../../utils/boardPosts';
import { AppIcon } from '../../components/ui/AppIcon';

type Params = {
  groupId: string;
  rootId: string;
  communitySlug?: string;
  communityName?: string;
  /** For the share sheet's `Post in # {board}` fallback title. */
  boardName?: string;
};

type Navigation = { goBack: () => void };

/**
 * One board post and its comments (spec §4.1).
 *
 * This is where a post's media actually loads — the board list only ever
 * renders a `Photo · tap to load` chip, so 20 cards a page never cost 20
 * image downloads (§10).
 *
 * Comments are a flat, oldest-first list. There is deliberately no typing
 * indicator, no read receipts and no ticks: those stay in Chat.
 */
export function CommunityPostScreen({
  navigation,
  route,
}: {
  navigation: Navigation;
  route: { params: Params };
}) {
  const { groupId, rootId, communitySlug, boardName } = route.params;
  const { colors } = useTheme();
  const { lowDataMode } = useLowDataMode();
  const user = useAuthStore((s) => s.user);

  const messages = useGroupStore((s) => s.messagesCache[groupId]);
  const fetchThread = useGroupStore((s) => s.fetchThread);
  const patchMessageInState = useGroupStore((s) => s.patchMessageInState);
  const commentOnPost = useBoardStore((s) => s.commentOnPost);
  /**
   * Primitives and arrays only — never an object built inside the selector.
   * A fresh object every render fails zustand's `Object.is` check forever and
   * re-renders the screen without end; that is a production freeze this
   * codebase has already paid for once.
   */
  const bookmarkedIds = useBoardStore((s) => s.bookmarkedByGroup[groupId]);
  const bookmarksSupported = useBoardStore((s) => s.bookmarksSupported[groupId] !== false);
  const loadBookmarks = useBoardStore((s) => s.loadBookmarks);
  const toggleBookmarkOnBoard = useBoardStore((s) => s.toggleBookmark);
  const repostOnBoard = useBoardStore((s) => s.repost);
  const undoRepostOnBoard = useBoardStore((s) => s.undoRepost);

  const [fetched, setFetched] = useState<Message[]>([]);
  /**
   * The post itself, from the thread fetch. `fetchThread` returns it but does
   * not write it into `messagesCache`, and the cache does not hold it at all
   * when the post is older than the board's loaded page (the pinned strip, and
   * every `discover/c/:slug/ch/:groupId/p/:rootId` deep link) — without this
   * the screen rendered comments under no post.
   */
  const [fetchedRoot, setFetchedRoot] = useState<Message | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [myReactions, setMyReactions] = useState<Record<string, string[]>>({});
  const [repostOpen, setRepostOpen] = useState(false);
  const [repostBusy, setRepostBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const root = useMemo(
    () => (messages || []).find((m) => m.id === rootId) ?? fetchedRoot,
    [messages, rootId, fetchedRoot]
  );

  const comments = useMemo(
    () => mergeComments(fetched, selectPostComments(messages, rootId)),
    [fetched, messages, rootId]
  );

  const reload = useCallback(async () => {
    try {
      const thread = (await fetchThread(rootId, { groupId })) as Message[];
      // The root itself comes back inside the thread. Keep it: it is the only
      // copy when the post is off the board's loaded page.
      setFetchedRoot(thread.find((m) => m.id === rootId) ?? null);
      setFetched(thread.filter((m) => m.id !== rootId));
    } catch {
      // Whatever the cache already holds still renders.
    } finally {
      setLoading(false);
    }
  }, [fetchThread, rootId, groupId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    void api
      .fetchUserReactionsForGroup(groupId)
      .then((map) => {
        if (!cancelled) setMyReactions(map || {});
      })
      .catch(() => undefined);
    // Same request the board screen makes on mount, so opening a post from a
    // deep link (where the board was never mounted) still paints the Bookmark
    // icon in the right state on the first frame.
    void loadBookmarks(groupId);
    return () => {
      cancelled = true;
    };
  }, [groupId, loadBookmarks]);

  /** Keep the locally held copy of the post in step with the cached one. */
  const patchFetchedRoot = useCallback(
    (messageId: string, reactions: Record<string, number> | undefined) => {
      setFetchedRoot((prev) =>
        prev && prev.id === messageId ? { ...prev, reactions: reactions ?? {} } : prev
      );
    },
    []
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
      // The post itself may live ONLY in `fetchedRoot` — `fetchThread` does not
      // write it into `messagesCache`, and the cache does not hold it at all
      // when the post is older than the board's loaded page (every deep link,
      // and the pinned strip). `patchMessageInState` cannot reach it there, so
      // the heart filled and the count never moved.
      patchFetchedRoot(message.id, applyReactionLocally(previousCounts, emoji, added));
      try {
        const result = added
          ? await api.addMessageReaction(message.id, emoji)
          : await api.removeMessageReaction(message.id, emoji);
        patchMessageInState(message.id, { reactions: result?.reactions ?? {} });
        patchFetchedRoot(message.id, result?.reactions ?? {});
      } catch (error) {
        setMyReactions((prev) => ({ ...prev, [message.id]: previousMine }));
        patchMessageInState(message.id, { reactions: previousCounts });
        patchFetchedRoot(message.id, previousCounts);
        useToastStore
          .getState()
          .showToast(
            error instanceof Error ? error.message : 'Could not save that reaction',
            'error'
          );
      }
    },
    [myReactions, patchMessageInState, patchFetchedRoot]
  );

  const bookmarked = useMemo(
    () => (bookmarkedIds ?? []).includes(rootId),
    [bookmarkedIds, rootId]
  );

  const toggleBookmark = useCallback(async () => {
    const ok = await toggleBookmarkOnBoard(groupId, rootId, !bookmarked);
    if (!ok) {
      useToastStore.getState().showToast(COMMUNITY_BOARD_COPY.bookmarksUnavailable, 'error');
    }
  }, [toggleBookmarkOnBoard, groupId, rootId, bookmarked]);

  const openRepost = useCallback(() => {
    if (!root) return;
    if (root.repostedByMe) {
      setRepostOpen(true);
      return;
    }
    const verdict = canRepostBoardPost({
      post: toBoardPost(root),
      viewerId: user?.id ?? '',
    });
    if (!verdict.ok) {
      useToastStore.getState().showToast(boardRepostRefusalCopy(verdict.reason), 'error');
      return;
    }
    setRepostOpen(true);
  }, [root, user?.id]);

  const confirmRepost = useCallback(
    async (quote: string) => {
      if (repostBusy) return;
      setRepostBusy(true);
      const error = await repostOnBoard(groupId, rootId, quote);
      setRepostBusy(false);
      if (error) {
        useToastStore.getState().showToast(error, 'error');
        return;
      }
      setRepostOpen(false);
    },
    [repostBusy, repostOnBoard, groupId, rootId]
  );

  const confirmUndoRepost = useCallback(async () => {
    if (repostBusy) return;
    setRepostBusy(true);
    const error = await undoRepostOnBoard(groupId, rootId);
    setRepostBusy(false);
    if (error) {
      useToastStore.getState().showToast(error, 'error');
      return;
    }
    setRepostOpen(false);
  }, [repostBusy, undoRepostOnBoard, groupId, rootId]);

  /**
   * Copy link · Copy text · Share via… — the same three rows, in the same
   * order, with the same words as the board list and as web (§8.1).
   *
   * `boardSharePayload` returns a title and a URL and nothing else. Copy text
   * runs through `splitBoardBody`, so `![image](https://…)` never reaches the
   * clipboard and a members-only signed URL never leaves the board.
   */
  const shareItems: ActionSheetItem[] = useMemo(() => {
    if (!root) return [];
    // A deep link straight to a repost row shares the ORIGINAL's link, so the
    // recipient lands on the post and not on somebody's bump of it.
    const payload = boardSharePayload(
      { ...toBoardPost(root), id: boardActionTargetId(root) },
      {
        slug: communitySlug ?? null,
        groupId,
        boardName: boardName || route.params.communityName || '',
      }
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
    const { body } = splitBoardBody(root.text);
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
        void Share.share({ message: payload.url, title: payload.title }).catch(() =>
          useToastStore.getState().showToast(COMMUNITY_BOARD_COPY.shareFailed, 'error')
        );
      },
    });
    return items;
  }, [root, communitySlug, groupId, boardName, route.params.communityName]);

  const submitComment = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || !user?.id || sending) return;
    setSending(true);
    try {
      await commentOnPost(groupId, { rootId, text: trimmed, senderId: user.id });
      setText('');
      setExpanded(false);
      await reload();
    } catch (error) {
      Alert.alert(
        'Comment failed',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setSending(false);
    }
  }, [text, user?.id, sending, commentOnPost, groupId, rootId, reload]);

  const rootMedia = splitBoardBody(root?.text);
  /**
   * `messages.image_url` FIRST, the markdown inside `text` only as the legacy
   * fallback — the same precedence `BoardPostCard` uses, so a post never shows
   * one photo in the list and a different one on this screen.
   *
   * Stored as-is: `BoardImage` re-signs it on read. Normalising here and
   * handing the result straight to <Image> is what let a day-old photo 400 and
   * vanish with no error anywhere.
   */
  const rootImage = root?.imageUrl ?? rootMedia.imageUrl ?? null;

  const renderComment = ({ item }: { item: Message }) => {
    const media = splitBoardBody(item.text);
    const when = boardRelativeTime(item.createdAt);
    const isRemoved = !!item.isRemoved || !!item.removedAt;
    return (
      // NOT `accessible` on the row: it would collapse the comment into one
      // element and take the photo and the voice player's controls out of the
      // accessibility tree. The composed label sits on the text block instead.
      <View
        accessibilityRole="none"
        className="flex-row px-4 py-2.5 border-b border-lantern-border"
      >
        <ResolvedAvatar
          name={item.senderName}
          uri={resolveAvatarSrc(item.senderAvatar, lowDataMode)}
          size={24}
          decorative
        />
        <View className="ml-2 flex-1 min-w-0">
          <View
            accessible
            accessibilityLabel={`${item.senderName}${when ? `, ${when}` : ''}, ${
              isRemoved ? COMMUNITY_BOARD_COPY.postRemoved : media.body
            }`}
            className="flex-row items-center"
          >
            <Text className="text-[12px] font-semibold text-lantern-text shrink" numberOfLines={1}>
              {item.senderName}
            </Text>
            {when ? (
              <Text className="ml-2 text-[11px] text-lantern-text-tertiary">{when}</Text>
            ) : null}
          </View>
          {isRemoved ? (
            <Text className="mt-0.5 text-[13px] italic text-lantern-text-tertiary">
              {COMMUNITY_BOARD_COPY.postRemoved}
            </Text>
          ) : (
            <>
              {media.imageUrl ? (
                <View className="mt-1">
                  <BoardImage
                    url={media.imageUrl}
                    accessibilityLabel="Comment photo"
                    maxWidth={200}
                    lowDataMode={lowDataMode}
                  />
                </View>
              ) : null}
              {media.audioUrl ? (
                <View className="mt-1">
                  <VoiceNotePlayer url={normalizeStorageUrl(media.audioUrl)} isOwn={false} />
                </View>
              ) : null}
              {/* Already read by the composed label above. */}
              {media.body ? (
                <View
                  importantForAccessibility="no-hide-descendants"
                  accessibilityElementsHidden
                  className="mt-0.5"
                >
                  <MentionText
                    text={media.body}
                    color={colors.text}
                    mentionColor={colors.primary}
                  />
                </View>
              ) : null}
              {/*
                A comment gets Favorite and NOTHING else (§4.5). No repost, no
                bookmark, no share on a comment in any phase: five 44px targets
                do not fit a 24px-avatar comment row on a 320dp screen, and
                every one of them would point at a row that is not a post.
              */}
              <Pressable
                onPress={() =>
                  void toggleReaction(
                    item,
                    BOARD_FAVORITE_EMOJI,
                    !isBoardFavorited(myReactions[item.id])
                  )
                }
                accessibilityRole="button"
                accessibilityState={{ selected: isBoardFavorited(myReactions[item.id]) }}
                accessibilityLabel={boardFavoriteAccessibilityLabel(
                  boardFavoriteCount(item.reactions),
                  isBoardFavorited(myReactions[item.id])
                )}
                className="mt-0.5 min-h-[44px] min-w-[44px] flex-row items-center self-start"
              >
                <AppIcon
                  name="heart"
                  filled={isBoardFavorited(myReactions[item.id])}
                  size={15}
                  color={isBoardFavorited(myReactions[item.id]) ? colors.error : '#94a3b8'}
                />
                {boardFavoriteCount(item.reactions) > 0 ? (
                  <Text className="ml-1 text-[12px] font-medium text-lantern-text-secondary">
                    {boardFavoriteCount(item.reactions)}
                  </Text>
                ) : null}
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top', 'bottom']}>
      <View className="flex-row items-center h-[56px] pr-2 border-b border-lantern-border">
        <BackButton onPress={() => navigation.goBack()} style={{ marginLeft: 4 }} />
        <Text className="flex-1 ml-1 text-base font-semibold text-lantern-text" numberOfLines={1}>
          {COMMUNITY_BOARD_COPY.commentsTitle}
        </Text>
      </View>

      <KeyboardAvoidingView className="flex-1" behavior={COMPOSER_KEYBOARD_BEHAVIOR}>
        <FlatList
          data={comments}
          keyExtractor={(item) => item.id}
          renderItem={renderComment}
          contentContainerStyle={{ paddingBottom: 16, flexGrow: 1 }}
          ListHeaderComponent={
            root ? (
              <View className="border-b border-lantern-border px-4 py-3">
                <View className="flex-row items-center">
                  <ResolvedAvatar
                    name={root.senderName}
                    uri={resolveAvatarSrc(root.senderAvatar, lowDataMode)}
                    size={28}
                    decorative
                  />
                  <Text
                    className="ml-2 flex-1 text-[13px] font-semibold text-lantern-text"
                    numberOfLines={1}
                  >
                    {root.senderName}
                  </Text>
                  <Text className="text-[11px] text-lantern-text-tertiary">
                    {boardRelativeTime(root.createdAt)}
                  </Text>
                </View>

                {root.subject ? (
                  <Text className="mt-2 text-[16px] font-bold text-lantern-text">
                    {root.subject}
                  </Text>
                ) : null}

                {/* Opened from a repost card's Comment control this is the
                    ORIGINAL, so this branch only fires on a direct deep link
                    to a repost row. Render what it points at rather than an
                    empty card. */}
                {isBoardRepost(root) ? (
                  <BoardQuotedPost quoted={root.repostOf ?? null} />
                ) : null}

                {rootImage ? (
                  <View className="mt-2">
                    <BoardImage
                      url={rootImage}
                      accessibilityLabel="Post photo"
                      lowDataMode={lowDataMode}
                    />
                  </View>
                ) : null}

                {rootMedia.audioUrl ? (
                  <View className="mt-2">
                    <VoiceNotePlayer
                      url={normalizeStorageUrl(rootMedia.audioUrl)}
                      isOwn={root.senderId === user?.id}
                    />
                  </View>
                ) : null}

                {rootMedia.body ? (
                  <View className="mt-1">
                    <MentionText
                      text={rootMedia.body}
                      color={colors.text}
                      mentionColor={colors.primary}
                    />
                  </View>
                ) : null}

                {/*
                  The same five controls, in the same order, as the board list
                  — rendered from the shared BOARD_ACTION_ROW_ORDER (§9.1).
                  Favorite replaces the emoji React on BOARD surfaces only: the
                  same message_reactions table and the same endpoints with the
                  emoji pinned, so group chat and DMs keep the full picker.

                  Comment scrolls to the composer rather than navigating: this
                  screen IS the comments.
                */}
                <BoardActionRow
                  favoriteCount={boardFavoriteCount(root.reactions)}
                  favorited={isBoardFavorited(myReactions[root.id])}
                  onFavorite={() =>
                    void toggleReaction(
                      root,
                      BOARD_FAVORITE_EMOJI,
                      !isBoardFavorited(myReactions[root.id])
                    )
                  }
                  repostCount={root.repostCount ?? 0}
                  repostedByMe={!!root.repostedByMe}
                  onRepost={openRepost}
                  canRepost={
                    canRepostBoardPost({ post: toBoardPost(root), viewerId: user?.id ?? '' }).ok
                  }
                  replyCount={comments.length}
                  onComment={() => setExpanded(true)}
                  bookmarked={bookmarked}
                  onBookmark={() => void toggleBookmark()}
                  bookmarksSupported={bookmarksSupported}
                  onShare={() => setShareOpen(true)}
                />
              </View>
            ) : null
          }
          ListEmptyComponent={
            loading ? (
              <View className="py-10 items-center">
                <ActivityIndicator color="#6366f1" />
              </View>
            ) : (
              <Text className="px-4 py-8 text-center text-sm text-lantern-text-tertiary">
                {COMMUNITY_BOARD_COPY.comments(0)}
              </Text>
            )
          }
        />

        <View className="border-t border-lantern-border bg-lantern-background px-3 py-2">
          {expanded ? (
            <View className="flex-row items-end">
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={COMMUNITY_BOARD_COPY.commentPlaceholder}
                placeholderTextColor={colors.inputPlaceholder}
                autoFocus
                multiline
                accessibilityLabel={COMMUNITY_BOARD_COPY.commentPlaceholder}
                className="flex-1 min-h-[44px] rounded-2xl border border-lantern-border bg-lantern-surface px-3 py-2 text-sm text-lantern-text"
                style={{ borderColor: colors.inputBorder, backgroundColor: colors.inputBackground }}
              />
              <Pressable
                onPress={() => void submitComment()}
                disabled={!text.trim() || sending}
                accessibilityRole="button"
                accessibilityLabel={COMMUNITY_BOARD_COPY.comment}
                accessibilityState={{ disabled: !text.trim() || sending, busy: sending }}
                className="ml-2 min-h-[44px] min-w-[44px] items-center justify-center rounded-2xl bg-lantern-primary px-3"
                style={{ opacity: !text.trim() || sending ? 0.5 : 1 }}
              >
                <Text className="text-xs font-semibold text-white">
                  {sending ? COMMUNITY_BOARD_COPY.posting : COMMUNITY_BOARD_COPY.comment}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => setExpanded(true)}
              accessibilityRole="button"
              accessibilityLabel={COMMUNITY_BOARD_COPY.comment}
              accessibilityState={{ expanded: false }}
              className="min-h-[44px] flex-row items-center rounded-full border border-lantern-border bg-lantern-surface px-4"
            >
              <Text className="text-sm text-lantern-text-tertiary">
                {COMMUNITY_BOARD_COPY.commentPlaceholder}
              </Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>

      <ActionSheet
        visible={shareOpen}
        title={COMMUNITY_BOARD_COPY.share}
        items={shareItems.map((item) => ({
          ...item,
          onPress: () => {
            setShareOpen(false);
            item.onPress();
          },
        }))}
        onClose={() => setShareOpen(false)}
      />

      <BoardRepostSheet
        visible={repostOpen}
        authorName={root?.senderName ?? ''}
        subject={root?.subject ?? null}
        body={root?.text ?? ''}
        reposted={!!root?.repostedByMe}
        busy={repostBusy}
        onRepost={(quote) => void confirmRepost(quote)}
        onUndo={() => void confirmUndoRepost()}
        onClose={() => setRepostOpen(false)}
      />
    </SafeAreaView>
  );
}

export default CommunityPostScreen;
