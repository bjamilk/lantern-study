import React, { useMemo } from 'react';
import { Pressable, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { chatMessagePreview, parseChatAudioUrl } from '@lantern/shared/utils';
import { ResolvedAvatar } from '../ResolvedAvatar';
import { useTheme } from '../../theme';
import { ChatTextBody } from './ChatMessageBody';
import { ReceiptTicks } from './ReceiptTicks';
import { SwipeToReply } from './SwipeToReply';
import { VoiceNotePlayer } from './VoiceNotePlayer';
import { AppIcon } from '../ui/AppIcon';

interface DmBubbleProps {
  message: {
    text: string;
    timestamp: string;
    editedAt?: string;
    removedAt?: string;
    isRemoved?: boolean;
    replyCount?: number;
    deliveryState?: 'pending' | 'failed';
    receiptStatus?: 'sent' | 'read';
    replyTo?: {
      id: string;
      senderName?: string;
      text?: string;
      isRemoved?: boolean;
    } | null;
  };
  isOwn: boolean;
  senderName?: string;
  senderAvatar?: string | null;
  onReply?: () => void;
  /** Direct reply (no action sheet) — used by swipe-to-reply. */
  onSwipeReply?: () => void;
  onScrollToMessage?: (messageId: string) => void;
  onOpenThread?: (rootId: string) => void;
  threadRootId?: string;
  messageId?: string;
  /** Re-send a message that failed to reach the server. */
  onRetry?: () => void;
  /** Device-local star from the message action sheet. */
  starred?: boolean;
  /**
   * Opaque pill for the text OUTSIDE the bubble — the sender name (shown on
   * every incoming DM) and the thread link. Passed only when a wallpaper is
   * showing; see MessageBubble for why `colors.primary` on a photo cannot be
   * saved by the scrim in either theme.
   */
  wallpaperPillStyle?: ViewStyle;
}

function DmBubbleComponent({
  message,
  isOwn,
  senderName,
  senderAvatar,
  onReply,
  onSwipeReply,
  onScrollToMessage,
  onOpenThread,
  onRetry,
  threadRootId,
  messageId,
  starred = false,
  wallpaperPillStyle,
}: DmBubbleProps) {
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  // `overflow-hidden` so Android clips the pill to its radius.
  const pillClass = wallpaperPillStyle ? ' px-1.5 py-0.5 rounded-md overflow-hidden' : '';
  // On tablets / landscape, cap the row in absolute points so bubbles don't
  // stretch full-bleed. Phones keep the percentage max (max-w-[92%]/[82%]) below.
  const wideMaxWidth = windowWidth >= 768 ? { maxWidth: 520 } : undefined;
  const timeLabel = useMemo(
    () =>
      new Date(message.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    [message.timestamp]
  );
  const audioUrl = parseChatAudioUrl(message.text);
  const isRemoved = !!message.isRemoved || !!message.removedAt;

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
            onPress={() => onOpenThread(threadRootId || messageId || '')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${message.replyCount} ${message.replyCount === 1 ? 'reply' : 'replies'}, open thread`}
            className="mt-1.5"
          >
            <Text className="text-xs font-semibold" style={{ color: colors.primaryText }}>
              {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  // One composed announcement per row — same scheme as MessageBubble. The
  // duplicate child Texts (sender, text, time, state) are silenced below.
  const statusLabel = !isOwn
    ? ''
    : message.deliveryState === 'pending'
      ? '. Sending'
      : message.deliveryState === 'failed'
        ? '. Not sent'
        : (message.receiptStatus || 'sent') === 'read'
          ? '. Read'
          : '. Sent';
  const rowLabel =
    `${isOwn ? 'You' : senderName?.trim() || 'Member'} at ${timeLabel}. ` +
    `${chatMessagePreview(message.text)}${message.editedAt ? '. Edited' : ''}${statusLabel}`;

  return (
    <SwipeToReply enabled={!!onSwipeReply} onReply={() => onSwipeReply?.()}>
    <Pressable
      onLongPress={onReply}
      delayLongPress={350}
      accessibilityRole={onReply ? 'button' : 'text'}
      accessibilityLabel={rowLabel}
      accessibilityHint={onReply ? 'Double tap and hold for message options' : undefined}
      className={`mb-3 flex-row gap-2 max-w-[92%] ${isOwn ? 'self-end' : 'self-start'}`}
      style={wideMaxWidth}
    >
      {!isOwn ? (
        // The row label already names the sender.
        <ResolvedAvatar name={senderName || 'User'} uri={senderAvatar} size={28} decorative />
      ) : null}

      <View className={`flex-1 min-w-0 ${isOwn ? 'items-end' : 'items-start'}`}>
        {!isOwn ? (
          <View className={`mb-1 ml-0.5 self-start${pillClass}`} style={wallpaperPillStyle}>
            <Text
              importantForAccessibility="no"
              className="text-xs font-semibold"
              style={{ color: colors.primaryText }}
            >
              {senderName?.trim() || 'Member'}
            </Text>
          </View>
        ) : null}

        <View
          className={`px-3.5 py-2.5 rounded-2xl max-w-full shadow-sm ${
            isOwn ? 'rounded-br-md' : 'rounded-bl-md'
          }`}
          style={{
            backgroundColor: isOwn ? colors.chatBubbleOwn : colors.chatBubbleOther,
          }}
        >
          {message.replyTo ? (
            <Pressable
              onPress={() => message.replyTo?.id && onScrollToMessage?.(message.replyTo.id)}
              accessibilityRole="button"
              accessibilityLabel={`Replying to ${message.replyTo.senderName || 'a message'}. Tap to jump to it.`}
              className="mb-2 rounded-lg px-2.5 py-1.5 border-l-2"
              style={{
                backgroundColor: isOwn ? `${colors.chatBubbleMeta}26` : colors.backgroundSecondary,
                borderLeftColor: colors.primary,
              }}
            >
              <Text
                className="text-[11px] font-semibold"
                numberOfLines={1}
                style={{ color: isOwn ? colors.chatBubbleText : colors.primary }}
              >
                {message.replyTo.senderName || 'Message'}
              </Text>
              <Text
                className="text-xs"
                numberOfLines={1}
                style={{ color: isOwn ? colors.chatBubbleMeta : colors.textSecondary }}
              >
                {message.replyTo.isRemoved
                  ? 'Message removed'
                  : chatMessagePreview(message.replyTo.text, 'Original message').slice(0, 100)}
              </Text>
            </Pressable>
          ) : null}

          {audioUrl ? (
            <VoiceNotePlayer url={audioUrl} isOwn={isOwn} />
          ) : (
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
              className="text-label"
              style={{ color: isOwn ? colors.chatBubbleMeta : colors.textTertiary }}
            >
              {timeLabel}
            </Text>
            {message.editedAt ? (
              <Text
                importantForAccessibility="no"
                className="text-label ml-1"
                style={{ color: isOwn ? colors.chatBubbleMeta : colors.textTertiary }}
              >
                edited
              </Text>
            ) : null}
            {isOwn && message.deliveryState === 'pending' ? (
              <Text
                importantForAccessibility="no"
                className="text-label ml-1"
                style={{ color: colors.chatBubbleMeta }}
              >
                Sending…
              </Text>
            ) : isOwn && message.deliveryState === 'failed' ? (
              <Pressable
                onPress={onRetry}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Message not sent. Tap to retry."
                className="ml-1"
              >
                <Text className="text-label font-semibold" style={{ color: colors.error }}>
                  Not sent · Retry
                </Text>
              </Pressable>
            ) : isOwn ? (
              // Not `onPrimary`: the own bubble is chatBubbleOwn now, not the indigo primary.
              <ReceiptTicks status={message.receiptStatus || 'sent'} onPrimary={false} />
            ) : null}
          </View>
        </View>

        {(message.replyCount ?? 0) > 0 && onOpenThread ? (
          <Pressable
            onPress={() => onOpenThread(threadRootId || messageId || message.replyTo?.id || '')}
            hitSlop={8}
            className={`mt-1.5${pillClass} ${isOwn ? 'self-end' : 'self-start'}`}
            style={wallpaperPillStyle}
            accessibilityRole="button"
            accessibilityLabel={`${message.replyCount} ${message.replyCount === 1 ? 'reply' : 'replies'}, open thread`}
          >
            <Text className="text-xs font-semibold" style={{ color: colors.primaryText }}>
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
 * Default shallow comparator, same reasoning as MessageBubble. Note that the
 * `message` prop is a projection built by the caller — callers must memoize it
 * (see DmBubbleWrapper) or a fresh object literal defeats this on every render.
 */
export const DmBubble = React.memo(DmBubbleComponent);
