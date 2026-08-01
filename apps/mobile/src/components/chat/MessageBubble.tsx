import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useGroupStore, type Message } from '../../stores/groupStore';
import { useTheme } from '../../theme';
import {
  normalizeStorageUrl,
  parseChatAudioUrl,
  resolveGroupChatAvatarUrl,
  resolveGroupChatMentionUsername,
  resolveGroupChatSenderLabel,
  segmentMentions,
} from '@lantern/shared/utils';
import { ResolvedAvatar } from '../ResolvedAvatar';
import { getQuestionTypeLabel } from './chatDateHelpers';
import { QuestionVoteBar } from './QuestionVoteBar';
import { ReceiptTicks } from './ReceiptTicks';
import { SwipeToReply } from './SwipeToReply';
import { useResolvedStorageUrl } from '../../hooks/useResolvedStorageUrl';

function formatChatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  userVote?: 'up' | 'down';
  memberCount: number;
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
}

function MentionText({
  text,
  color,
  mentionColor,
}: {
  text: string;
  color: string;
  mentionColor: string;
}) {
  const segments = segmentMentions(text);
  return (
    <Text className="text-sm leading-relaxed" style={{ color }}>
      {segments.map((seg, i) =>
        seg.type === 'mention' ? (
          <Text key={i} style={{ color: mentionColor, fontWeight: '700' }}>
            {seg.value}
          </Text>
        ) : (
          <Text key={i}>{seg.value}</Text>
        )
      )}
    </Text>
  );
}

function VoiceNotePlayer({ url, isOwn, colors }: { url: string; isOwn: boolean; colors: any }) {
  // Re-sign embedded storage URLs — chat messages keep a short-lived signed link.
  const resolvedUrl = useResolvedStorageUrl(url);
  const soundRef = useRef<Audio.Sound | null>(null);
  const trackWidthRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [positionMs, setPositionMs] = useState(0);
  const [loadError, setLoadError] = useState(false);

  const onStatus = useCallback((status: Audio.AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    if (typeof status.durationMillis === 'number' && status.durationMillis > 0) {
      setDurationMs(status.durationMillis);
    }
    if (status.didJustFinish) {
      setPlaying(false);
      setPositionMs(0);
      void soundRef.current?.setPositionAsync(0);
      return;
    }
    setPositionMs(status.positionMillis ?? 0);
    setPlaying(status.isPlaying);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    setPlaying(false);
    setDurationMs(0);
    setPositionMs(0);

    const previous = soundRef.current;
    soundRef.current = null;
    if (previous) void previous.unloadAsync();

    if (!resolvedUrl) {
      if (resolvedUrl === null) setLoadError(true);
      return;
    }

    const load = async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          playThroughEarpieceAndroid: false,
        });
        const { sound } = await Audio.Sound.createAsync(
          { uri: resolvedUrl },
          { shouldPlay: false, progressUpdateIntervalMillis: 100 },
          onStatus
        );
        if (cancelled) {
          await sound.unloadAsync();
          return;
        }
        soundRef.current = sound;
        const status = await sound.getStatusAsync();
        if (status.isLoaded && typeof status.durationMillis === 'number') {
          setDurationMs(status.durationMillis);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      }
    };

    void load();

    return () => {
      cancelled = true;
      const sound = soundRef.current;
      soundRef.current = null;
      if (sound) void sound.unloadAsync();
    };
  }, [resolvedUrl, onStatus]);

  const ensureSound = async (): Promise<Audio.Sound | null> => {
    if (!resolvedUrl) return null;
    let sound = soundRef.current;
    if (sound) return sound;
    try {
      const created = await Audio.Sound.createAsync(
        { uri: resolvedUrl },
        { shouldPlay: false, progressUpdateIntervalMillis: 100 },
        onStatus
      );
      sound = created.sound;
      soundRef.current = sound;
      return sound;
    } catch {
      setLoadError(true);
      return null;
    }
  };

  const seekToRatio = async (ratio: number) => {
    const sound = await ensureSound();
    if (!sound) return;
    const status = await sound.getStatusAsync();
    if (!status.isLoaded) return;
    const total =
      (typeof status.durationMillis === 'number' && status.durationMillis > 0
        ? status.durationMillis
        : durationMs) || 0;
    if (!(total > 0)) return;
    const next = Math.max(0, Math.min(total, Math.floor(ratio * total)));
    // Avoid leaving the player stuck in the finished state after scrubbing to the tail.
    const clamped = next >= total - 40 ? Math.max(0, total - 40) : next;
    await sound.setPositionAsync(clamped);
    setPositionMs(clamped);
  };

  const toggle = async () => {
    try {
      const sound = await ensureSound();
      if (!sound) return;
      const status = await sound.getStatusAsync();
      if (!status.isLoaded) return;
      if (status.isPlaying) {
        await sound.pauseAsync();
        return;
      }
      const total = status.durationMillis ?? durationMs;
      const atEnd =
        !!status.didJustFinish ||
        (typeof total === 'number' && total > 0 && (status.positionMillis ?? 0) >= total - 40);
      if (atEnd) {
        await sound.playFromPositionAsync(0);
      } else {
        await sound.playAsync();
      }
    } catch {
      setPlaying(false);
    }
  };

  const durationSec = durationMs / 1000;
  const positionSec = positionMs / 1000;
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  const iconColor = isOwn ? '#ffffff' : colors.primary;
  const trackColor = isOwn ? 'rgba(255,255,255,0.25)' : colors.primaryBackground;
  const fillColor = isOwn ? '#ffffff' : colors.primary;
  const timeColor = isOwn ? 'rgba(255,255,255,0.8)' : colors.textSecondary;

  if (loadError || resolvedUrl === null) {
    return (
      <Text className="text-xs py-1" style={{ color: timeColor }}>
        Voice note unavailable
      </Text>
    );
  }

  if (!resolvedUrl) {
    return (
      <Text className="text-xs py-1" style={{ color: timeColor }}>
        Loading voice note…
      </Text>
    );
  }

  return (
    <View className="flex-row items-center gap-2.5 py-1 min-w-0 w-full" style={{ maxWidth: 260 }}>
      <Pressable
        onPress={() => void toggle()}
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause voice note' : 'Play voice note'}
        className="items-center justify-center rounded-full"
        style={{
          width: 36,
          height: 36,
          backgroundColor: isOwn ? 'rgba(255,255,255,0.2)' : colors.primaryBackground,
        }}
      >
        <Ionicons
          name={playing ? 'pause' : 'play'}
          size={18}
          color={iconColor}
          style={playing ? undefined : { marginLeft: 2 }}
        />
      </Pressable>
      <View className="flex-1 min-w-0" style={{ gap: 6 }}>
        <Pressable
          onLayout={(e) => {
            trackWidthRef.current = e.nativeEvent.layout.width;
          }}
          onPress={(e) => {
            const width = trackWidthRef.current;
            if (!(width > 0)) return;
            const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / width));
            void seekToRatio(ratio);
          }}
          style={{
            height: 16,
            justifyContent: 'center',
          }}
          accessibilityRole="adjustable"
          accessibilityLabel="Seek voice note"
          accessibilityValue={{
            min: 0,
            max: Math.round(durationSec),
            now: Math.round(positionSec),
          }}
        >
          <View
            style={{
              height: 6,
              borderRadius: 999,
              overflow: 'hidden',
              backgroundColor: trackColor,
            }}
          >
            <View
              style={{
                height: '100%',
                width: `${progress * 100}%`,
                borderRadius: 999,
                backgroundColor: fillColor,
              }}
            />
          </View>
        </Pressable>
        <View className="flex-row items-center justify-between">
          <Text style={{ color: timeColor, fontSize: 11, fontVariant: ['tabular-nums'] }}>
            {formatChatAudioTime(positionSec)}
          </Text>
          <Text style={{ color: timeColor, fontSize: 11, fontVariant: ['tabular-nums'] }}>
            {formatChatAudioTime(durationSec)}
          </Text>
        </View>
      </View>
    </View>
  );
}

export function MessageBubble({
  message,
  isOwn,
  userVote,
  memberCount,
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
}: MessageBubbleProps) {
  const { colors } = useTheme();
  const messageGroup = useGroupStore((state) =>
    state.currentGroup?.id === message.groupId
      ? state.currentGroup
      : state.groups.find((group) => group.id === message.groupId)
  );
  const [imageFailed, setImageFailed] = useState(false);
  const isQuestion = message.type === 'question';
  const timeLabel = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const audioUrl = !isQuestion ? parseChatAudioUrl(message.text) : null;
  const isRemoved = !!message.isRemoved || !!message.removedAt;
  // Must run before any early return — removed vs normal messages must not change hook count.
  const questionImageUri = useResolvedStorageUrl(message.imageUrl);

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
            onPress={() => onOpenThread(message.threadRootId || message.id)}
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

  const optionItems =
    message.optionItems?.length
      ? message.optionItems
      : (message.options || []).map((opt, i) =>
          typeof opt === 'string'
            ? { id: String(i), text: opt }
            : { id: (opt as { id?: string }).id || String(i), text: (opt as { text?: string }).text || String(opt) }
        );

  const ownTextBubbleStyle = { backgroundColor: colors.primary };
  const ownQuestionBubbleStyle = {
    backgroundColor: colors.primaryBackground,
    borderColor: colors.primary,
    borderWidth: 1,
  };
  const otherQuestionBubbleStyle = {
    backgroundColor: colors.card,
    borderColor: colors.warning,
    borderWidth: 1,
  };

  const otherTextBubbleStyle = {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
  };
  const storedLabel = message.senderName?.trim() || '';
  const authorLabel = resolveGroupChatSenderLabel(
    {
      id: message.senderId,
      username: storedLabel.startsWith('@') ? storedLabel.slice(1) : undefined,
      name: storedLabel && !storedLabel.startsWith('@') ? storedLabel : undefined,
    },
    messageGroup?.members
  );
  const mentionUsername = resolveGroupChatMentionUsername(
    {
      id: message.senderId,
      username: storedLabel.startsWith('@') ? storedLabel.slice(1) : undefined,
    },
    messageGroup?.members
  );

  return (
    <SwipeToReply
      enabled={!!onSwipeReply}
      onReply={() => onSwipeReply?.(message)}
    >
    <Pressable
      onLongPress={onReply ? () => onReply(message) : undefined}
      delayLongPress={350}
      className={`flex-row gap-2 max-w-[92%] ${isOwn ? 'self-end' : 'self-start'} ${isGroupedWithPrevious ? 'mb-1' : 'mb-3'}`}
    >
      {!isOwn ? (
        isGroupedWithPrevious ? (
          <View style={{ width: 28 }} />
        ) : (
          <ResolvedAvatar
            name={authorLabel}
            uri={resolveGroupChatAvatarUrl(
              { id: message.senderId, avatarUrl: message.senderAvatar },
              messageGroup?.members
            )}
            size={28}
          />
        )
      ) : null}

      <View className={`flex-1 min-w-0 ${isOwn ? 'items-end' : 'items-start'}`}>
        {!isOwn && !isGroupedWithPrevious ? (
          onMentionUser && mentionUsername ? (
            <Pressable
              onPress={() => onMentionUser(mentionUsername)}
              accessibilityRole="button"
              accessibilityLabel={`Mention ${authorLabel}`}
              className="mb-1 ml-0.5"
            >
              <Text
                className="text-xs font-semibold"
                style={{ color: colors.primary }}
                numberOfLines={1}
              >
                {authorLabel}
              </Text>
            </Pressable>
          ) : (
            <Text
              className="text-xs font-semibold mb-1 ml-0.5"
              style={{ color: colors.primary }}
              numberOfLines={1}
            >
              {authorLabel}
            </Text>
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
              className="mb-2 rounded-lg px-2.5 py-1.5 border-l-2"
              style={{
                backgroundColor: isOwn && !isQuestion ? 'rgba(255,255,255,0.15)' : colors.backgroundSecondary,
                borderLeftColor: isOwn && !isQuestion ? '#fff' : colors.primary,
              }}
            >
              <Text
                className="text-[11px] font-semibold"
                numberOfLines={1}
                style={{ color: isOwn && !isQuestion ? colors.textInverse : colors.primary }}
              >
                {message.replyTo.senderName || 'Message'}
              </Text>
              <Text
                className="text-xs"
                numberOfLines={1}
                style={{ color: isOwn && !isQuestion ? '#c7d2fe' : colors.textSecondary }}
              >
                {message.replyTo.isRemoved
                  ? 'Message removed'
                  : (message.replyTo.questionStem || message.replyTo.text || 'Original message').slice(0, 100)}
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

              <Text
                className="text-sm leading-relaxed"
                style={{ color: isOwn ? colors.text : colors.text }}
              >
                {message.questionStem || message.text}
              </Text>

              {questionImageUri && !imageFailed ? (
                <Image
                  source={{ uri: questionImageUri }}
                  accessibilityLabel="Question visual"
                  resizeMode="contain"
                  onError={() => setImageFailed(true)}
                  style={{
                    width: '100%',
                    maxHeight: 200,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
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
            <VoiceNotePlayer url={audioUrl} isOwn={isOwn} colors={colors} />
          ) : (
            (() => {
              const imageMatch = message.text?.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
              const imageUri = imageMatch?.[1] ? normalizeStorageUrl(imageMatch[1]) : undefined;
              const textWithoutImage = message.text?.replace(/!\[.*?\]\(https?:\/\/[^)]+\)/, '').trim();
              return (
                <View className="gap-2">
                  {imageUri && !imageFailed ? (
                    <Image
                      source={{ uri: imageUri }}
                      accessibilityLabel="Shared image"
                      resizeMode="cover"
                      onError={() => setImageFailed(true)}
                      style={{ width: 220, height: 180, borderRadius: 10 }}
                    />
                  ) : null}
                  {textWithoutImage ? (
                    <MentionText
                      text={textWithoutImage}
                      color={isOwn ? colors.textInverse : colors.text}
                      mentionColor={isOwn ? '#fff' : colors.primary}
                    />
                  ) : null}
                </View>
              );
            })()
          )}

          <View className="flex-row items-center justify-end mt-1.5 gap-0.5">
            <Text
              className="text-[10px]"
              style={{
                color: isOwn
                  ? isQuestion
                    ? colors.textTertiary
                    : '#c7d2fe'
                  : colors.textTertiary,
              }}
            >
              {timeLabel}
            </Text>
            {message.editedAt ? (
              <Text
                className="text-[10px] ml-1"
                style={{ color: isOwn && !isQuestion ? '#c7d2fe' : colors.textTertiary }}
              >
                edited
              </Text>
            ) : null}
            {isOwn ? (
              <ReceiptTicks
                status={message.receiptStatus || 'sent'}
                seenByCount={message.seenByCount}
                seenByTotal={message.seenByTotal}
                isGroupChat
                onPrimary={!isQuestion}
              />
            ) : null}
          </View>
        </View>

        {(message.replyCount ?? 0) > 0 && onOpenThread ? (
          <Pressable
            onPress={() => onOpenThread(message.threadRootId || message.id)}
            className="mt-1.5"
            accessibilityLabel={`${message.replyCount} replies`}
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
