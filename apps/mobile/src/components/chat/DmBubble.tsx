import React, { useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Audio } from 'expo-av';
import { chatMessagePreview, parseChatAudioUrl, segmentMentions } from '@lantern/shared/utils';
import { ResolvedAvatar } from '../ResolvedAvatar';
import { useTheme } from '../../theme';
import { useResolvedStorageUrl } from '../../hooks/useResolvedStorageUrl';
import { ReceiptTicks } from './ReceiptTicks';
import { SwipeToReply } from './SwipeToReply';

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
}: DmBubbleProps) {
  const { colors } = useTheme();
  const timeLabel = useMemo(
    () =>
      new Date(message.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    [message.timestamp]
  );
  const audioUrl = parseChatAudioUrl(message.text);
  const resolvedAudioUrl = useResolvedStorageUrl(audioUrl);
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);

  const toggleAudio = async () => {
    if (!resolvedAudioUrl) return;
    try {
      if (playing && soundRef.current) {
        await soundRef.current.pauseAsync();
        setPlaying(false);
        return;
      }
      if (!soundRef.current) {
        const { sound } = await Audio.Sound.createAsync({ uri: resolvedAudioUrl });
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish) {
            setPlaying(false);
            void sound.setPositionAsync(0);
          }
        });
      }
      const status = await soundRef.current.getStatusAsync();
      if (!status.isLoaded) return;
      const total = status.durationMillis ?? 0;
      const atEnd =
        !!status.didJustFinish ||
        (total > 0 && (status.positionMillis ?? 0) >= total - 40);
      if (atEnd) {
        await soundRef.current.playFromPositionAsync(0);
      } else {
        await soundRef.current.playAsync();
      }
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  };

  const segments = useMemo(
    () => (!audioUrl ? segmentMentions(message.text) : []),
    [audioUrl, message.text]
  );
  const isRemoved = !!message.isRemoved || !!message.removedAt;

  if (isRemoved) {
    return (
      <View className={`max-w-[82%] mb-3 ${isOwn ? 'self-end' : 'self-start'}`}>
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
            <Text className="text-xs font-semibold" style={{ color: colors.primary }}>
              {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <SwipeToReply enabled={!!onSwipeReply} onReply={() => onSwipeReply?.()}>
    <Pressable
      onLongPress={onReply}
      delayLongPress={350}
      accessibilityRole={onReply ? 'button' : 'text'}
      accessibilityLabel={
        `${isOwn ? 'You' : senderName?.trim() || 'Member'} at ${timeLabel}. ${message.text}`
      }
      accessibilityHint={onReply ? 'Double tap and hold for message options' : undefined}
      className={`mb-3 flex-row gap-2 max-w-[92%] ${isOwn ? 'self-end' : 'self-start'}`}
    >
      {!isOwn ? (
        <ResolvedAvatar name={senderName || 'User'} uri={senderAvatar} size={28} />
      ) : null}

      <View className={`flex-1 min-w-0 ${isOwn ? 'items-end' : 'items-start'}`}>
        {!isOwn ? (
          <Text className="text-xs font-semibold mb-1 ml-0.5" style={{ color: colors.primary }}>
            {senderName?.trim() || 'Member'}
          </Text>
        ) : null}

        <View
          className={`px-3.5 py-2.5 rounded-2xl max-w-full shadow-sm ${
            isOwn ? 'rounded-br-md' : 'rounded-bl-md border border-lantern-border'
          }`}
          style={isOwn ? { backgroundColor: colors.primary } : { backgroundColor: colors.card }}
        >
          {message.replyTo ? (
            <Pressable
              onPress={() => message.replyTo?.id && onScrollToMessage?.(message.replyTo.id)}
              accessibilityRole="button"
              accessibilityLabel={`Replying to ${message.replyTo.senderName || 'a message'}. Tap to jump to it.`}
              className="mb-2 rounded-lg px-2.5 py-1.5 border-l-2"
              style={{
                backgroundColor: isOwn ? 'rgba(255,255,255,0.15)' : colors.backgroundSecondary,
                borderLeftColor: isOwn ? '#fff' : colors.primary,
              }}
            >
              <Text
                className="text-[11px] font-semibold"
                numberOfLines={1}
                style={{ color: isOwn ? colors.textInverse : colors.primary }}
              >
                {message.replyTo.senderName || 'Message'}
              </Text>
              <Text
                className="text-xs"
                numberOfLines={1}
                style={{ color: isOwn ? '#c7d2fe' : colors.textSecondary }}
              >
                {message.replyTo.isRemoved
                  ? 'Message removed'
                  : chatMessagePreview(message.replyTo.text, 'Original message').slice(0, 100)}
              </Text>
            </Pressable>
          ) : null}

          {audioUrl ? (
            resolvedAudioUrl === null ? (
              <Text className="text-xs" style={{ color: isOwn ? '#c7d2fe' : colors.textSecondary }}>
                Voice note unavailable
              </Text>
            ) : !resolvedAudioUrl ? (
              <Text className="text-xs" style={{ color: isOwn ? '#c7d2fe' : colors.textSecondary }}>
                Loading voice note…
              </Text>
            ) : (
              <Pressable
                onPress={() => void toggleAudio()}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={playing ? 'Pause voice note' : 'Play voice note'}
                className="flex-row items-center gap-2"
              >
                <Text
                  className="text-xs font-semibold px-2.5 py-1.5 rounded-lg"
                  style={{
                    backgroundColor: isOwn ? 'rgba(255,255,255,0.2)' : colors.primaryBackground,
                    color: isOwn ? colors.textInverse : colors.primary,
                    overflow: 'hidden',
                  }}
                >
                  {playing ? 'Pause' : 'Play'}
                </Text>
                <Text className="text-xs" style={{ color: isOwn ? '#c7d2fe' : colors.textSecondary }}>
                  Voice note
                </Text>
              </Pressable>
            )
          ) : (
            <Text className="text-sm leading-relaxed" style={{ color: isOwn ? colors.textInverse : colors.text }}>
              {segments.map((seg, i) =>
                seg.type === 'mention' ? (
                  <Text key={i} style={{ fontWeight: '700', color: isOwn ? '#fff' : colors.primary }}>
                    {seg.value}
                  </Text>
                ) : (
                  <Text key={i}>{seg.value}</Text>
                )
              )}
            </Text>
          )}
          <View className="flex-row items-center justify-end mt-1.5 gap-0.5">
            <Text
              className="text-[10px]"
              style={{ color: isOwn ? '#c7d2fe' : colors.textTertiary }}
            >
              {timeLabel}
            </Text>
            {message.editedAt ? (
              <Text
                className="text-[10px]"
                style={{ color: isOwn ? '#c7d2fe' : colors.textTertiary }}
              >
                edited
              </Text>
            ) : null}
            {isOwn && message.deliveryState === 'pending' ? (
              <Text className="text-[10px] ml-1" style={{ color: colors.chatBubbleMeta }}>
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
                <Text className="text-[10px] font-semibold" style={{ color: colors.error }}>
                  Not sent · Retry
                </Text>
              </Pressable>
            ) : isOwn ? (
              <ReceiptTicks status={message.receiptStatus || 'sent'} onPrimary />
            ) : null}
          </View>
        </View>

        {(message.replyCount ?? 0) > 0 && onOpenThread ? (
          <Pressable
            onPress={() => onOpenThread(threadRootId || messageId || message.replyTo?.id || '')}
            hitSlop={8}
            className="mt-1.5"
            accessibilityRole="button"
            accessibilityLabel={`${message.replyCount} ${message.replyCount === 1 ? 'reply' : 'replies'}, open thread`}
          >
            <Text className="text-xs font-semibold" style={{ color: colors.primary }}>
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
