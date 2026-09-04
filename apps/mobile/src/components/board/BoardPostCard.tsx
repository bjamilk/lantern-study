import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  COMMUNITY_BOARD_COPY,
  boardPostAccessibilityLabel,
  boardRelativeTime,
  canRepostBoardPost,
} from '@lantern/shared/network';
import { resolveAvatarSrc } from '@lantern/shared/utils';
import { MentionText } from '../chat/ChatMessageBody';
import { ResolvedAvatar } from '../ResolvedAvatar';
import { RoleBadge } from '../community/RoleBadge';
import { useTheme } from '../../theme';
import { isBoardRepost, splitBoardBody, toBoardPost } from '../../utils/boardPosts';
import { BoardActionRow } from './BoardActionRow';
import { BoardImage } from './BoardImage';
import { BoardQuotedPost } from './BoardQuotedPost';
import { LegacyQuestionCard } from './LegacyQuestionCard';
import type { Message } from '../../stores/groupStore';

/**
 * One card on a board (§4.2).
 *
 * Deliberately NOT a chat bubble: no left/right alignment, no tail, no sender
 * grouping, no date separators, no ticks, no "Seen by N of M". The delivery
 * feedback that matters on patchy data — `Not sent · Retry` — is kept.
 *
 * WHAT THE LIST COSTS, AND WHY IT CHANGED
 * ---------------------------------------
 * Until this phase a post with media rendered a text chip and the list
 * downloaded ZERO bytes of media. It now renders an inline thumbnail
 * (founder decision 6, the Twitter shape) — but only ever the `thumb`
 * variant: the 480px `<path>.thumb.webp` sibling `processImageForUpload`
 * already writes for every chat upload and that, until now, nothing asked
 * for. That is ~15-35 KB rather than 100-250 KB, so 20 cards is roughly
 * 0.3-0.7 MB instead of 2-5 MB.
 *
 * Two escape hatches keep the old guarantee where it mattered most:
 *  - **low-data mode keeps the tap-to-load chip** and downloads nothing;
 *  - **a GIF is never inlined**, in any mode. A GIF's thumb is a static first
 *    frame (useless), and the real file is never resized, so twenty of them
 *    in a list is the reader's whole data bill. It stays a chip.
 */
export function BoardPostCard({
  post,
  now,
  isOwn,
  viewerId,
  authorIsAdmin,
  favorited,
  bookmarked,
  bookmarksSupported,
  lowDataMode,
  highlighted,
  onOpenComments,
  onToggleFavorite,
  onRepost,
  onToggleBookmark,
  onShare,
  onOverflow,
  onRetry,
  onStartStudyGroup,
}: {
  post: Message;
  now: number;
  isOwn: boolean;
  viewerId: string;
  /** Board admins get the same badge the community roster uses. */
  authorIsAdmin: boolean;
  favorited: boolean;
  bookmarked: boolean;
  bookmarksSupported: boolean;
  lowDataMode: boolean;
  /** The freshly posted card, held for BOARD_NEW_POST_HIGHLIGHT_MS. */
  highlighted?: boolean;
  onOpenComments: () => void;
  onToggleFavorite: () => void;
  onRepost: () => void;
  onToggleBookmark: () => void;
  onShare: () => void;
  onOverflow: () => void;
  onRetry?: () => void;
  onStartStudyGroup: () => void;
}) {
  const { colors } = useTheme();
  const boardPost = useMemo(
    () => toBoardPost(post, { favorited, bookmarked }),
    [post, favorited, bookmarked]
  );
  const { body, imageUrl: markdownImage, audioUrl } = useMemo(
    () => splitBoardBody(post.text),
    [post.text]
  );
  const when = boardRelativeTime(post.createdAt, now);
  const replyCount = typeof post.replyCount === 'number' ? post.replyCount : 0;
  const isRemoved = !!post.isRemoved || !!post.removedAt;
  const isRepost = isBoardRepost(post);

  /**
   * `messages.image_url` is the FIRST encoding, not a third one: a post made
   * in ONE action carries its photo there and its body stays free of markdown,
   * while every legacy post keeps its `![image](…)` inside `text`, which
   * `splitBoardBody` still parses (§5.2).
   */
  const imageUrl = post.imageUrl ?? markdownImage;

  const repostable = useMemo(
    () => canRepostBoardPost({ post: boardPost, viewerId, now }),
    [boardPost, viewerId, now]
  );

  // Founder decision 4: a repost keeps the ORIGINAL author, with the
  // reposter's name only in the attribution line above.
  const headerName = isRepost ? (post.repostOf?.senderName ?? post.senderName) : post.senderName;
  const headerWhen = isRepost
    ? boardRelativeTime(post.repostOf?.timestamp ?? post.createdAt, now)
    : when;

  /**
   * A screen reader must hear the ORIGINAL on a repost card, not the
   * reposter's row. `boardPostAccessibilityLabel` reads `senderName` and
   * `text` off the row it is given, which on a repost are the reposter and
   * their optional comment — so the quoted post is substituted first. The
   * "{name} reposted" line above is its own accessible element and is not
   * repeated here.
   */
  const headerLabel = useMemo(
    () =>
      boardPostAccessibilityLabel(
        isRepost
          ? {
              ...boardPost,
              senderName: headerName,
              timestamp: post.repostOf?.timestamp ?? boardPost.timestamp,
              subject: post.repostOf?.subject ?? null,
              text: post.repostOf?.snippet ?? '',
              removedAt: post.repostOf?.removedAt ?? boardPost.removedAt,
            }
          : boardPost,
        now
      ),
    [boardPost, isRepost, headerName, post.repostOf, now]
  );

  if (boardPost.isLegacyQuestion && !isRemoved) {
    return (
      <LegacyQuestionCard
        stem={boardPost.legacyQuestionStem || ''}
        authorName={post.senderName}
        relativeTime={when}
        hasImage={!!imageUrl}
        onStartStudyGroup={onStartStudyGroup}
      />
    );
  }

  return (
    // NOT `accessible`: that makes the card ONE element and, on VoiceOver,
    // removes every control inside it from the accessibility tree — the ⋯
    // overflow, the media, Retry and all five actions in the row below become
    // unreachable (§9.2). Five controls makes that temptation stronger, not
    // weaker. The composed card label lives on the non-interactive header
    // block instead.
    <View
      accessibilityRole="none"
      className={`mx-3 my-1.5 rounded-2xl border p-3 ${
        highlighted
          ? 'border-lantern-primary bg-lantern-primary-background'
          : 'border-lantern-border bg-lantern-surface'
      }`}
    >
      {/* The repost attribution line: an icon AND the words, never colour
          alone (§9.2). Everything below it belongs to the ORIGINAL. */}
      {isRepost && !isRemoved ? (
        <View
          accessible
          accessibilityLabel={COMMUNITY_BOARD_COPY.repostedBy(post.senderName)}
          className="mb-1.5 flex-row items-center"
        >
          <Ionicons name="repeat" size={13} color="#94a3b8" />
          <Text className="ml-1.5 text-[11px] font-semibold text-lantern-text-tertiary">
            {COMMUNITY_BOARD_COPY.repostedBy(post.senderName)}
          </Text>
        </View>
      ) : null}

      {/* The reposter's own comment, in its own block ABOVE the original —
          so it is never mistaken for the original author's words (§6.5). */}
      {isRepost && !isRemoved && body ? (
        <View className="mb-1.5 rounded-xl border-l-2 border-lantern-border pl-2">
          <MentionText text={body} color={colors.text} mentionColor={colors.primary} />
        </View>
      ) : null}

      <View className="flex-row items-center">
        <ResolvedAvatar
          name={headerName}
          // A repost keeps the ORIGINAL author's identity. The quoted embed
          // carries a name but no avatar url, so this falls back to initials
          // rather than showing the reposter's face over someone else's post.
          uri={isRepost ? undefined : resolveAvatarSrc(post.senderAvatar, lowDataMode)}
          size={28}
          decorative
        />
        <View
          accessible
          accessibilityLabel={headerLabel}
          className="ml-2 flex-1 min-w-0 flex-row items-center"
        >
          <Text className="text-[13px] font-semibold text-lantern-text shrink" numberOfLines={1}>
            {headerName}
          </Text>
          {authorIsAdmin && !isRepost ? <RoleBadge role="admin" /> : null}
          {headerWhen ? (
            <Text className="ml-2 text-[11px] text-lantern-text-tertiary">{headerWhen}</Text>
          ) : null}
          {post.editedAt && !isRemoved && !isRepost ? (
            <Text className="ml-1 text-[11px] text-lantern-text-tertiary">· edited</Text>
          ) : null}
        </View>
        <Pressable
          onPress={onOverflow}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="More actions for this post"
          className="min-h-[44px] min-w-[44px] items-center justify-center -mr-2"
        >
          <Ionicons name="ellipsis-horizontal" size={18} color="#94a3b8" />
        </Pressable>
      </View>

      {isRemoved ? (
        <Text className="mt-2 text-[14px] italic text-lantern-text-tertiary">
          {COMMUNITY_BOARD_COPY.postRemoved}
        </Text>
      ) : isRepost ? (
        /*
          A repost renders the ORIGINAL as a text-only embed with a media CHIP,
          never the media itself. A takedown of the original therefore reaches
          every repost of it ("This post was removed") with zero writes to the
          repost rows, and a repost card still downloads 0 bytes of media.
        */
        <BoardQuotedPost quoted={post.repostOf ?? null} now={now} />
      ) : (
        <>
          {/* The card label above already reads the title and the opening of
              the body, so the same words are not announced twice. */}
          {post.subject ? (
            <Text
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
              className="mt-2 text-[15px] font-bold text-lantern-text"
            >
              {post.subject}
            </Text>
          ) : null}

          {body ? (
            <View
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
              className="mt-1"
            >
              <MentionText text={body} color={colors.text} mentionColor={colors.primary} />
            </View>
          ) : null}

          {imageUrl ? (
            <View className="mt-2">
              <BoardImage
                url={imageUrl}
                accessibilityLabel={COMMUNITY_BOARD_COPY.photoAttached}
                lowDataMode={lowDataMode}
                variant="thumb"
                maxWidth={280}
                maxHeight={200}
              />
            </View>
          ) : null}

          {audioUrl ? (
            <Pressable
              onPress={onOpenComments}
              accessibilityRole="button"
              accessibilityLabel={COMMUNITY_BOARD_COPY.voiceNote}
              className="mt-2 self-start min-h-[44px] flex-row items-center rounded-full border border-lantern-border px-3"
            >
              <Ionicons name="mic-outline" size={14} color="#94a3b8" />
              <Text className="ml-1.5 text-[12px] text-lantern-text-secondary">
                {COMMUNITY_BOARD_COPY.voiceNote}
              </Text>
            </Pressable>
          ) : null}
        </>
      )}

      {isOwn && post.deliveryState ? (
        <Pressable
          onPress={onRetry}
          disabled={!onRetry || post.deliveryState === 'pending'}
          accessibilityRole="button"
          accessibilityLabel={COMMUNITY_BOARD_COPY.notSent}
          className="mt-2 self-start min-h-[44px] justify-center"
        >
          <Text className="text-[12px] font-semibold text-lantern-error">
            {post.deliveryState === 'pending'
              ? COMMUNITY_BOARD_COPY.posting
              : COMMUNITY_BOARD_COPY.notSent}
          </Text>
        </Pressable>
      ) : null}

      {isRemoved ? null : (
        <BoardActionRow
          favoriteCount={boardPost.favoriteCount}
          favorited={boardPost.favorited}
          onFavorite={onToggleFavorite}
          repostCount={boardPost.repostCount}
          repostedByMe={boardPost.repostedByMe}
          onRepost={onRepost}
          canRepost={repostable.ok}
          replyCount={replyCount}
          onComment={onOpenComments}
          bookmarked={boardPost.bookmarked}
          onBookmark={onToggleBookmark}
          bookmarksSupported={bookmarksSupported}
          onShare={onShare}
        />
      )}
    </View>
  );
}

export default BoardPostCard;
