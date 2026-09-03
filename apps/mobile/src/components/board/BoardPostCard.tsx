import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  COMMUNITY_BOARD_COPY,
  boardPostAccessibilityLabel,
  reactionAccessibilityLabel,
  boardRelativeTime,
} from '@lantern/shared/network';
import { resolveAvatarSrc } from '@lantern/shared/utils';
import { MentionText } from '../chat/ChatMessageBody';
import { MessageReactions, ReactionPickerRow } from '../chat/MessageReactions';
import { ResolvedAvatar } from '../ResolvedAvatar';
import { RoleBadge } from '../community/RoleBadge';
import { useTheme } from '../../theme';
import { splitBoardBody, toBoardPost } from '../../utils/boardPosts';
import { LegacyQuestionCard } from './LegacyQuestionCard';
import type { Message } from '../../stores/groupStore';

/**
 * One card on a board (§4.2).
 *
 * Deliberately NOT a chat bubble: no left/right alignment, no tail, no sender
 * grouping, no date separators, no ticks, no "Seen by N of M". The delivery
 * feedback that matters on patchy data — `Not sent · Retry` — is kept.
 *
 * The list never downloads an image: a post with media renders a text chip
 * (`Photo · tap to load` / `Voice note`) and the media itself loads on the
 * post screen. At 20 cards a page that is a materially different cost from 20
 * chat rows (§10).
 */
export function BoardPostCard({
  post,
  now,
  isOwn,
  authorIsAdmin,
  myReactions,
  lowDataMode,
  highlighted,
  onOpenComments,
  onToggleReaction,
  onOverflow,
  onRetry,
  onStartStudyGroup,
}: {
  post: Message;
  now: number;
  isOwn: boolean;
  /** Board admins get the same badge the community roster uses. */
  authorIsAdmin: boolean;
  myReactions?: string[];
  lowDataMode: boolean;
  /** The freshly posted card, held for BOARD_NEW_POST_HIGHLIGHT_MS. */
  highlighted?: boolean;
  onOpenComments: () => void;
  onToggleReaction: (message: Message, emoji: string, added: boolean) => void;
  onOverflow: () => void;
  onRetry?: () => void;
  onStartStudyGroup: () => void;
}) {
  const { colors } = useTheme();
  const [pickerOpen, setPickerOpen] = useState(false);
  const boardPost = useMemo(() => toBoardPost(post), [post]);
  const { body, imageUrl, audioUrl } = useMemo(() => splitBoardBody(post.text), [post.text]);
  const when = boardRelativeTime(post.createdAt, now);
  const replyCount = typeof post.replyCount === 'number' ? post.replyCount : 0;
  const isRemoved = !!post.isRemoved || !!post.removedAt;

  if (boardPost.isLegacyQuestion && !isRemoved) {
    return (
      <LegacyQuestionCard
        stem={boardPost.legacyQuestionStem || ''}
        authorName={post.senderName}
        relativeTime={when}
        hasImage={!!post.imageUrl || !!imageUrl}
        onStartStudyGroup={onStartStudyGroup}
      />
    );
  }

  return (
    // NOT `accessible`: that makes the card ONE element and, on VoiceOver,
    // removes every control inside it from the accessibility tree — the ⋯
    // overflow, the media chip, Retry, React, `N comments` and the reaction
    // chips' pressed state all become unreachable (§9). The composed card
    // label lives on the non-interactive header block below instead.
    <View
      accessibilityRole="none"
      className={`mx-3 my-1.5 rounded-2xl border p-3 ${
        highlighted
          ? 'border-lantern-primary bg-lantern-primary-background'
          : 'border-lantern-border bg-lantern-surface'
      }`}
    >
      <View className="flex-row items-center">
        <ResolvedAvatar
          name={post.senderName}
          uri={resolveAvatarSrc(post.senderAvatar, lowDataMode)}
          size={28}
          decorative
        />
        <View
          accessible
          accessibilityLabel={boardPostAccessibilityLabel(boardPost, now)}
          className="ml-2 flex-1 min-w-0 flex-row items-center"
        >
          <Text className="text-[13px] font-semibold text-lantern-text shrink" numberOfLines={1}>
            {post.senderName}
          </Text>
          {authorIsAdmin ? <RoleBadge role="admin" /> : null}
          {when ? (
            <Text className="ml-2 text-[11px] text-lantern-text-tertiary">{when}</Text>
          ) : null}
          {post.editedAt && !isRemoved ? (
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

          {imageUrl || audioUrl ? (
            <Pressable
              onPress={onOpenComments}
              accessibilityRole="button"
              accessibilityLabel={
                imageUrl ? COMMUNITY_BOARD_COPY.photoTapToLoad : COMMUNITY_BOARD_COPY.voiceNote
              }
              className="mt-2 self-start min-h-[44px] flex-row items-center rounded-full border border-lantern-border px-3"
            >
              <Ionicons
                name={imageUrl ? 'image-outline' : 'mic-outline'}
                size={14}
                color="#94a3b8"
              />
              <Text className="ml-1.5 text-[12px] text-lantern-text-secondary">
                {imageUrl ? COMMUNITY_BOARD_COPY.photoTapToLoad : COMMUNITY_BOARD_COPY.voiceNote}
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
        <>
          <MessageReactions
            reactions={post.reactions}
            mine={myReactions}
            onToggle={(emoji, added) => onToggleReaction(post, emoji, added)}
            size="touch"
            labelFor={reactionAccessibilityLabel}
          />

          {pickerOpen ? (
            <ReactionPickerRow
              mine={myReactions}
              onPick={(emoji, added) => {
                setPickerOpen(false);
                onToggleReaction(post, emoji, added);
              }}
            />
          ) : null}

          <View className="mt-2 flex-row items-center">
            <Pressable
              onPress={() => setPickerOpen((open) => !open)}
              accessibilityRole="button"
              accessibilityLabel={COMMUNITY_BOARD_COPY.react}
              accessibilityState={{ expanded: pickerOpen }}
              className="min-h-[44px] min-w-[44px] flex-row items-center justify-center pr-3"
            >
              <Ionicons name="happy-outline" size={16} color="#94a3b8" />
              <Text className="ml-1 text-[12px] font-medium text-lantern-text-secondary">
                {COMMUNITY_BOARD_COPY.react}
              </Text>
            </Pressable>

            <Pressable
              onPress={onOpenComments}
              accessibilityRole="button"
              accessibilityLabel={COMMUNITY_BOARD_COPY.comments(replyCount)}
              className="min-h-[44px] flex-1 flex-row items-center justify-start"
            >
              <Ionicons name="chatbubble-outline" size={16} color="#94a3b8" />
              <Text className="ml-1 text-[12px] font-medium text-lantern-text-secondary">
                {COMMUNITY_BOARD_COPY.comments(replyCount)}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

export default BoardPostCard;
