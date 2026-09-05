import React, { useMemo } from 'react';
import { Pressable, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import type { GroupMember, Message } from '../../stores/groupStore';
import { useTheme } from '../../theme';
import { flattenColor } from '../../utils/color';
import {
  chatMessagePreview,
  parseChatAudioUrl,
  resolveGroupChatAvatarUrl,
  resolveGroupChatMentionUsername,
  resolveGroupChatSenderLabel,
} from '@lantern/shared/utils';
import { ResolvedAvatar } from '../ResolvedAvatar';
import { getQuestionTypeLabel } from './chatDateHelpers';
import { ChatImageThumbnail, ChatTextBody } from './ChatMessageBody';
import { QuestionVoteBar } from './QuestionVoteBar';
import { ReceiptTicks } from './ReceiptTicks';
import { SwipeToReply } from './SwipeToReply';
import { VoiceNotePlayer } from './VoiceNotePlayer';
import { useResolvedStorageUrl } from '../../hooks/useResolvedStorageUrl';
import { AppIcon } from '../ui/AppIcon';

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  userVote?: 'up' | 'down';
  memberCount: number;
  /**
   * Group roster, used to resolve the author label / mention handle / avatar.
   * Passed down rather than read from the store: a per-row subscription meant N
   * store subscriptions plus N `groups.find()` scans on every store mutation.
   * Must be a referentially stable array or it defeats the memo below.
   */
  members?: GroupMember[];
  onVote?: (vote: 'up' | 'down') => void;
  flagCount?: number;
  userFlagged?: boolean;
  onFlag?: () => void;
  canFlag?: boolean;
  isGroupedWithPrevious?: boolean;
  onReply?: (message: Message) => void;
  /** Direct reply (no action sheet) — used by swipe-to-reply. */
  onSwipeReply?: (message: Message) => void;
  onMentionUser?: (username: string) => void;
  onScrollToMessage?: (messageId: string) => void;
  onOpenThread?: (rootId: string) => void;
  /** Re-send a message that failed to reach the server. */
  onRetry?: (message: Message) => void;
  /** Device-local star from the message action sheet. */
  starred?: boolean;
  /**
   * Opaque pill for the text that renders OUTSIDE the bubble — the author name
   * and the thread link. Passed (and only passed) when a chat wallpaper is
   * showing, because that text would otherwise sit straight on the student's
   * photo: `colors.primary` is a mid-luminance indigo in BOTH themes, so no
   * scrim value can rescue it — a dark photo kills it in light mode and a
   * bright one kills it in dark. Same object the date separators use.
   */
  wallpaperPillStyle?: ViewStyle;
}

function MessageBubbleComponent({
  message,
  isOwn,
  userVote,
  memberCount,
  members,
  onVote,
  flagCount,
  userFlagged,
  onFlag,
  canFlag,
  isGroupedWithPrevious = false,
  onReply,
  onSwipeReply,
  onMentionUser,
  onScrollToMessage,
  onOpenThread,
  onRetry,
  starred = false,
  wallpaperPillStyle,
}: MessageBubbleProps) {
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  // On tablets / landscape, cap the row in absolute points so bubbles don't
  // stretch full-bleed. Phones keep the percentage max (max-w-[92%]/[82%]) below.
  const wideMaxWidth = windowWidth >= 768 ? { maxWidth: 520 } : undefined;
  // `overflow-hidden` so Android actually clips the pill to its radius.
  const pillClass = wallpaperPillStyle ? ' px-1.5 py-0.5 rounded-md overflow-hidden' : '';
  const isQuestion = message.type === 'question';
  const audioUrl = !isQuestion ? parseChatAudioUrl(message.text) : null;
  const isRemoved = !!message.isRemoved || !!message.removedAt;
  // Everything below must run before the `isRemoved` early return — removed vs
  // normal messages must not change the hook count.
  const questionImageUri = useResolvedStorageUrl(message.imageUrl);

  const timeLabel = useMemo(
    () =>
      new Date(message.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    [message.createdAt]
  );

  const optionItems = useMemo(
    () =>
      message.optionItems?.length
        ? message.optionItems
        : (message.options || []).map((opt, i) =>
            typeof opt === 'string'
              ? { id: String(i), text: opt }
              : {
                  id: (opt as { id?: string }).id || String(i),
                  text: (opt as { text?: string }).text || String(opt),
                }
          ),
    [message.optionItems, message.options]
  );

  const { authorLabel, mentionUsername, avatarUrl } = useMemo(() => {
    const storedLabel = message.senderName?.trim() || '';
    const sender = {
      id: message.senderId,
      username: storedLabel.startsWith('@') ? storedLabel.slice(1) : undefined,
      name: storedLabel && !storedLabel.startsWith('@') ? storedLabel : undefined,
    };
    return {
      authorLabel: resolveGroupChatSenderLabel(sender, members),
      mentionUsername: resolveGroupChatMentionUsername(sender, members),
      avatarUrl: resolveGroupChatAvatarUrl(
        { id: message.senderId, avatarUrl: message.senderAvatar },
        members
      ),
    };
  }, [message.senderId, message.senderName, message.senderAvatar, members]);

  if (isRemoved) {
    return (
      <View
        className={`max-w-[82%] mb-3 ${isOwn ? 'self-end' : 'self-start'}`}
        style={wideMaxWidth}
      >
        <View
          className="px-3 py-2 rounded-xl bg-lantern-background-secondary"
          style={{ borderColor: colors.border, borderWidth: 1, borderStyle: 'dashed' }}
        >
          <Text className="text-sm italic text-lantern-text-secondary">Message removed</Text>
        </View>
        {(message.replyCount ?? 0) > 0 && onOpenThread ? (
          <Pressable
            onPress={() => onOpenThread(message.threadRootId || message.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${message.replyCount} ${message.replyCount === 1 ? 'reply' : 'replies'}, open thread`}
            className={`mt-1.5 self-start${pillClass}`}
            style={wallpaperPillStyle}
          >
            <Text className="text-xs font-semibold" style={{ color: colors.primary }}>
              {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const ownTextBubbleStyle = { backgroundColor: colors.chatBubbleOwn };
  const ownQuestionBubbleStyle = {
    // FLATTENED, not `colors.primaryBackground` raw: the dark token is the
    // alpha-baked `#6366f120`, i.e. 12.5% opaque. Every other bubble resolves to
    // an opaque token, so this was the one surface a wallpaper showed straight
    // through — taking the option letters, the vote row and the timestamp below
    // AA with it. Compositing it over the ground it already sits on is a no-op
    // visually (and a literal no-op in light mode, where the token is opaque).
    backgroundColor: flattenColor(colors.primaryBackground, colors.chatBackground),
    borderColor: colors.primary,
    borderWidth: 1,
  };
  const otherQuestionBubbleStyle = {
    backgroundColor: colors.card,
    borderColor: colors.warning,
    borderWidth: 1,
  };

  const otherTextBubbleStyle = {
    backgroundColor: colors.chatBubbleOther,
  };

  // One composed announcement per row: speaker, time, content, then state.
  // The child Texts that used to repeat each part are marked not-important
  // below, so a TalkBack swipe hears each message once instead of four times.
  // `chatMessagePreview` keeps media markers readable ("Voice note", "Photo")
  // instead of dumping a signed URL into the label.
  const contentLabel = isQuestion
    ? message.questionStem || message.text
    : chatMessagePreview(message.text);
  const statusLabel = !isOwn
    ? ''
    : message.deliveryState === 'pending'
      ? '. Sending'
      : message.deliveryState === 'failed'
        ? '. Not sent'
        : typeof message.seenByTotal === 'number' && message.seenByTotal > 0
          ? `. Seen by ${message.seenByCount ?? 0} of ${message.seenByTotal}`
          : (message.receiptStatus || 'sent') === 'read'
            ? '. Read'
            : '. Sent';
  const rowLabel =
    `${isOwn ? 'You' : authorLabel} at ${timeLabel}. ${contentLabel}` +
    `${message.editedAt ? '. Edited' : ''}${statusLabel}`;

  return (
    <SwipeToReply
      enabled={!!onSwipeReply}
      onReply={() => onSwipeReply?.(message)}
    >
    <Pressable
      onLongPress={onReply ? () => onReply(message) : undefined}
      delayLongPress={350}
      accessibilityRole={onReply ? 'button' : 'text'}
      accessibilityLabel={rowLabel}
      accessibilityHint={onReply ? 'Double tap and hold for message options' : undefined}
      className={`flex-row gap-2 max-w-[92%] ${isOwn ? 'self-end' : 'self-start'} ${isGroupedWithPrevious ? 'mb-1' : 'mb-3'}`}
      style={wideMaxWidth}
    >
      {!isOwn ? (
        isGroupedWithPrevious ? (
          <View style={{ width: 28 }} />
        ) : (
          // The row label already names the author.
          <ResolvedAvatar name={authorLabel} uri={avatarUrl} size={28} decorative />
        )
      ) : null}

      <View className={`flex-1 min-w-0 ${isOwn ? 'items-end' : 'items-start'}`}>
        {!isOwn && !isGroupedWithPrevious ? (
          onMentionUser && mentionUsername ? (
            // Kept as a stop: "Mention X" is an action, not a repeat of the row label.
            <Pressable
              onPress={() => onMentionUser(mentionUsername)}
              accessibilityRole="button"
              accessibilityLabel={`Mention ${authorLabel}`}
              className={`mb-1 ml-0.5 self-start${pillClass}`}
              style={wallpaperPillStyle}
            >
              <Text
                importantForAccessibility="no"
                className="text-xs font-semibold"
                style={{ color: colors.primary }}
                numberOfLines={1}
              >
                {authorLabel}
              </Text>
            </Pressable>
          ) : (
            <View className={`mb-1 ml-0.5 self-start${pillClass}`} style={wallpaperPillStyle}>
              <Text
                importantForAccessibility="no"
                className="text-xs font-semibold"
                style={{ color: colors.primary }}
                numberOfLines={1}
              >
                {authorLabel}
              </Text>
            </View>
          )
        ) : null}

        <View
          className={`px-3.5 py-2.5 rounded-2xl max-w-full shadow-sm ${
            isQuestion
              ? isOwn
                ? 'rounded-br-md'
                : 'rounded-bl-md'
              : isOwn
                ? 'rounded-br-md'
                : 'rounded-bl-md'
          }`}
          style={
            isQuestion
              ? isOwn
                ? ownQuestionBubbleStyle
                : otherQuestionBubbleStyle
              : isOwn
                ? ownTextBubbleStyle
                : otherTextBubbleStyle
          }
        >
          {message.replyTo ? (
            <Pressable
              onPress={() => message.replyTo?.id && onScrollToMessage?.(message.replyTo.id)}
              accessibilityRole="button"
              accessibilityLabel={`Replying to ${message.replyTo.senderName || 'a message'}. Tap to jump to it.`}
              className="mb-2 rounded-lg px-2.5 py-1.5 border-l-2"
              style={{
                backgroundColor: isOwn && !isQuestion ? `${colors.chatBubbleMeta}26` : colors.backgroundSecondary,
                borderLeftColor: colors.primary,
              }}
            >
              <Text
                className="text-[11px] font-semibold"
                numberOfLines={1}
                style={{ color: isOwn && !isQuestion ? colors.chatBubbleText : colors.primary }}
              >
                {message.replyTo.senderName || 'Message'}
              </Text>
              <Text
                className="text-xs"
                numberOfLines={1}
                style={{ color: isOwn && !isQuestion ? colors.chatBubbleMeta : colors.textSecondary }}
              >
                {message.replyTo.isRemoved
                  ? 'Message removed'
                  : (message.replyTo.questionStem
                      ? message.replyTo.questionStem
                      : chatMessagePreview(message.replyTo.text, 'Original message')
                    ).slice(0, 100)}
              </Text>
            </Pressable>
          ) : null}

          {isQuestion ? (
            <View className="gap-2">
              <View className="flex-row items-center flex-wrap gap-1.5">
                <View
                  className="px-2 py-0.5 rounded-md"
                  style={{
                    backgroundColor: isOwn ? `${colors.primary}22` : colors.primaryBackground,
                  }}
                >
                  <Text
                    className="text-[11px] font-semibold"
                    style={{ color: isOwn ? colors.primaryDark : colors.primary }}
                  >
                    {getQuestionTypeLabel(message.questionType)}
                  </Text>
                </View>
              </View>

              {/* The stem is spoken by the row label; the type chip and options
                  below stay announced — they aren't in it. */}
              <Text
                importantForAccessibility="no"
                className="text-sm leading-relaxed"
                style={{ color: isOwn ? colors.text : colors.text }}
              >
                {message.questionStem || message.text}
              </Text>

              {questionImageUri ? (
                <ChatImageThumbnail
                  uri={questionImageUri}
                  accessibilityLabel="Question visual"
                  maxWidth={260}
                  maxHeight={220}
                  borderColor={colors.border}
                  borderWidth={1}
                  borderRadius={8}
                />
              ) : null}

              {optionItems.length > 0 ? (
                <View className="gap-1.5 mt-0.5">
                  {optionItems.map((opt, i) => (
                    <View key={opt.id || i} className="flex-row items-start gap-2">
                      <View
                        className="w-5 h-5 rounded items-center justify-center"
                        style={{ backgroundColor: isOwn ? `${colors.primary}18` : colors.backgroundSecondary }}
                      >
                        <Text className="text-[10px] font-semibold" style={{ color: colors.textSecondary }}>
                          {String.fromCharCode(65 + i)}
                        </Text>
                      </View>
                      <Text className="flex-1 text-sm" style={{ color: colors.text }}>
                        {opt.text}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <QuestionVoteBar
                upvotes={message.upvotes ?? 0}
                downvotes={message.downvotes ?? 0}
                userVote={userVote}
                questionStatus={message.questionStatus}
                peerUpvotes={message.peerUpvotes}
                memberCount={memberCount}
                isOwn={isOwn}
                onVote={onVote}
                flagCount={flagCount}
                userFlagged={userFlagged}
                onFlag={onFlag}
                canFlag={canFlag}
              />
            </View>
          ) : audioUrl ? (
            <VoiceNotePlayer url={audioUrl} isOwn={isOwn} />
          ) : (
            // Only reached when !isQuestion, so the bubble is always a chatBubble* surface.
            <ChatTextBody
              text={message.text}
              textColor={colors.chatBubbleText}
              mentionColor={isOwn ? colors.chatBubbleText : colors.primary}
            />
          )}

          {/* Time / edited / delivery are spoken once as part of the row label;
              only the Retry action stays as its own stop. */}
          <View className="flex-row items-center justify-end mt-1.5 gap-0.5">
            {starred ? (
              <AppIcon
                name="star"
                size={10}
                color="#f59e0b"
                style={{ marginRight: 2 }}
                importantForAccessibility="no"
              />
            ) : null}
            <Text
              importantForAccessibility="no"
              className="text-[10px]"
              style={{
                color: isOwn
                  ? isQuestion
                    ? colors.textTertiary
                    : colors.chatBubbleMeta
                  : colors.textTertiary,
              }}
            >
              {timeLabel}
            </Text>
            {message.editedAt ? (
              <Text
                importantForAccessibility="no"
                className="text-[10px] ml-1"
                style={{ color: isOwn && !isQuestion ? colors.chatBubbleMeta : colors.textTertiary }}
              >
                edited
              </Text>
            ) : null}
            {isOwn && message.deliveryState === 'pending' ? (
              <Text
                importantForAccessibility="no"
                className="text-[10px] ml-1"
                style={{ color: colors.chatBubbleMeta }}
              >
                Sending…
              </Text>
            ) : isOwn && message.deliveryState === 'failed' ? (
              <Pressable
                onPress={() => onRetry?.(message)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Message not sent. Tap to retry."
                className="ml-1"
              >
                <Text className="text-[10px] font-semibold" style={{ color: colors.error }}>
                  Not sent · Retry
                </Text>
              </Pressable>
            ) : isOwn ? (
              <ReceiptTicks
                status={message.receiptStatus || 'sent'}
                seenByCount={message.seenByCount}
                seenByTotal={message.seenByTotal}
                isGroupChat
                onPrimary={false}
              />
            ) : null}
          </View>
        </View>

        {(message.replyCount ?? 0) > 0 && onOpenThread ? (
          <Pressable
            onPress={() => onOpenThread(message.threadRootId || message.id)}
            hitSlop={8}
            className={`mt-1.5${pillClass} ${isOwn ? 'self-end' : 'self-start'}`}
            style={wallpaperPillStyle}
            accessibilityRole="button"
            accessibilityLabel={`${message.replyCount} ${message.replyCount === 1 ? 'reply' : 'replies'}, open thread`}
          >
            <Text
              className="text-xs font-semibold"
              style={{ color: isOwn ? colors.primary : colors.primary }}
            >
              {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {isOwn ? <View className="w-7" /> : null}
    </Pressable>
    </SwipeToReply>
  );
}

/**
 * Default shallow comparator on purpose. A hand-written one is a silent
 * correctness bug waiting to happen — it only has to forget `userVote`,
 * `isGroupedWithPrevious` or `flagCount` for votes and grouping to go stale.
 * The cost of that is that callers must pass stable callbacks and a stable
 * `members` array; see MessageRow in GroupChatScreen.
 */
export const MessageBubble = React.memo(MessageBubbleComponent);
